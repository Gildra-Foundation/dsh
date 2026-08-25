import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

export const name = 'gildra-ui-compact'
export const inject = ['systemPrompt', 'tools', 'webServer', 'agentPresets', 'autoReviewRuntime']

const PRESET_ROUTE = '/gildra/agent-presets'
const REPOSITORY_ROUTE = '/gildra/workspaces/clone'
const UPDATE_ROUTE = '/gildra/update'
const AGENT_CONTROL_ROUTE = '/gildra/agent-control'
const AGENT_CONTROL_FILE = 'gildra-agent-control.json'
const PRESET_SIDECAR = 'gildra-preset.json'
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const MAX_BODY_BYTES = 96 * 1024
const MAX_PROMPT_CHARS = 32_000
const REPOSITORY_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org'])
const execFileAsync = promisify(execFile)
let updateStatusCache

class RepositoryImportError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'RepositoryImportError'
    this.status = status
  }
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Тело запроса слишком большое.')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('Некорректный JSON в запросе.')
  }
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label}: требуется текстовое значение.`)
  const text = value.trim()
  if (text === '') throw new Error(`${label}: поле не может быть пустым.`)
  if (text.length > maxLength) throw new Error(`${label}: превышен лимит ${String(maxLength)} символов.`)
  if (text.includes('\0')) throw new Error(`${label}: недопустимый нулевой символ.`)
  return text
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, label, maxLength)
}

function repositoryDefinition(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryImportError('Ожидались параметры репозитория.')
  }
  let repositoryUrl
  try {
    repositoryUrl = requiredText(value.url, 'Ссылка на репозиторий', 2048)
  } catch (error) {
    throw new RepositoryImportError(error instanceof Error ? error.message : String(error))
  }
  let parsed
  try {
    parsed = new URL(repositoryUrl)
  } catch {
    throw new RepositoryImportError('Укажите полную HTTPS-ссылку на репозиторий.')
  }
  if (parsed.protocol !== 'https:') {
    throw new RepositoryImportError('Поддерживаются только HTTPS-ссылки.')
  }
  if (!REPOSITORY_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new RepositoryImportError('Поддерживаются ссылки GitHub, GitLab и Bitbucket.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new RepositoryImportError('Ссылка не должна содержать логин, пароль, параметры или фрагмент.')
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) {
    throw new RepositoryImportError('Ссылка должна вести на конкретный репозиторий.')
  }
  let suggestedName
  try {
    suggestedName = decodeURIComponent(segments.at(-1)).replace(/\.git$/i, '')
  } catch {
    throw new RepositoryImportError('Ссылка содержит некорректное имя репозитория.')
  }
  let folderName
  try {
    folderName = optionalText(value.folderName, 'Имя папки', 80) ?? suggestedName
  } catch (error) {
    throw new RepositoryImportError(error instanceof Error ? error.message : String(error))
  }
  if (!folderName || folderName === '.' || folderName === '..' || /[<>:"|?*\\/\0\r\n]/.test(folderName)) {
    throw new RepositoryImportError('Имя папки должно быть одним безопасным сегментом пути.')
  }
  if (folderName.startsWith('.') || folderName.endsWith('.') || folderName.trim() !== folderName) {
    throw new RepositoryImportError('Имя папки не должно начинаться или заканчиваться точкой или пробелом.')
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(folderName)) {
    throw new RepositoryImportError('Это имя папки зарезервировано системой. Выберите другое.')
  }
  return { repositoryUrl: parsed.href, folderName }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function runGitClone(repositoryUrl, target) {
  try {
    await execFileAsync('git', ['clone', '--', repositoryUrl, target], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 2 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
      windowsHide: true,
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new RepositoryImportError('Git не найден. Установите Git и повторите попытку.', 503)
    }
    if (error?.killed || error?.signal) {
      throw new RepositoryImportError('Клонирование заняло слишком много времени и было остановлено.', 504)
    }
    const detail = String(error?.stderr ?? error?.message ?? '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .at(-1)
    throw new RepositoryImportError(
      detail ? `Git не смог клонировать репозиторий: ${detail.slice(0, 500)}` : 'Git не смог клонировать репозиторий.',
      502,
    )
  }
}

async function cloneRepository(raw, options = {}) {
  const definition = repositoryDefinition(raw)
  const projectsRoot = options.projectsRoot ?? join(homedir(), 'Gildra Projects')
  const clone = options.runGitClone ?? runGitClone
  const destination = join(projectsRoot, definition.folderName)
  await mkdir(projectsRoot, { recursive: true })
  if (await pathExists(destination)) {
    throw new RepositoryImportError(`Папка «${definition.folderName}» уже существует в Gildra Projects.`, 409)
  }
  const staging = await mkdtemp(join(projectsRoot, '.gildra-import-'))
  const checkout = join(staging, 'repository')
  try {
    await clone(definition.repositoryUrl, checkout)
    await rename(checkout, destination)
    return { path: destination, name: definition.folderName }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

function presetDefinition(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Ожидался объект с параметрами пресета.')
  }
  const input = value
  const id = requiredText(input.id, 'Идентификатор', 64)
  if (!PRESET_ID.test(id)) {
    throw new Error('Идентификатор должен состоять из строчных латинских букв, цифр и дефисов.')
  }
  return {
    id,
    name: requiredText(input.name, 'Название', 80),
    description: optionalText(input.description, 'Описание', 240),
    systemPrompt: requiredText(input.systemPrompt, 'Системный промпт', MAX_PROMPT_CHARS),
    provider: requiredText(input.provider, 'Провайдер', 120),
    model: requiredText(input.model, 'Модель', 240),
    reasoningEffort: optionalText(input.reasoningEffort, 'Глубина рассуждения', 80),
    source: optionalText(input.source, 'Базовый пресет', 64) ?? 'engineering',
  }
}

function personaRow(systemPrompt) {
  const indented = systemPrompt.replace(/\r\n?/g, '\n').split('\n')
    .map(line => `      ${line}`)
    .join('\n')
  return `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: |-\n${indented}\n\n`
}

function withPersona(composition, systemPrompt) {
  const row = /^- id: persona\s*$/m.exec(composition)
  if (!row) {
    throw new Error('Базовый пресет не содержит нативный модуль persona.')
  }
  const nextRow = composition.indexOf('\n- id: ', row.index + row[0].length)
  const rowEnd = nextRow === -1 ? composition.length : nextRow + 1
  return `${composition.slice(0, row.index)}${personaRow(systemPrompt)}${composition.slice(rowEnd)}`
}

async function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function sidecarOf(definition) {
  return {
    version: 1,
    provider: definition.provider,
    model: definition.model,
    ...definition.reasoningEffort === undefined ? {} : { reasoningEffort: definition.reasoningEffort },
  }
}

async function listGildraPresets(ctx) {
  const rows = []
  for (const preset of await ctx.agentPresets.list()) {
    let data
    try {
      data = JSON.parse(await readFile(join(dirname(preset.path), PRESET_SIDECAR), 'utf8'))
    } catch {
      continue
    }
    if (data?.version !== 1 || typeof data.provider !== 'string' || typeof data.model !== 'string') continue
    rows.push({
      id: preset.id,
      name: preset.name ?? preset.id,
      provider: data.provider,
      model: data.model,
      ...typeof data.reasoningEffort === 'string' ? { reasoningEffort: data.reasoningEffort } : {},
    })
  }
  return rows
}

async function createGildraPreset(ctx, raw) {
  const definition = presetDefinition(raw)
  let copied = false
  try {
    let source = definition.source
    try {
      await ctx.agentPresets.resolve(source)
    } catch {
      source = 'standard'
    }
    await ctx.agentPresets.copy(source, definition.id, definition.name)
    copied = true
    const preset = await ctx.agentPresets.resolve(definition.id)
    const directory = dirname(preset.path)
    const composition = withPersona(await readFile(preset.path, 'utf8'), definition.systemPrompt)
    const description = definition.description
      ?? `Пользовательский агент на модели ${definition.provider}/${definition.model}.`
    await atomicWrite(preset.path, composition)
    await atomicWrite(join(directory, 'preset.yml'), [
      `name: ${JSON.stringify(definition.name)}`,
      `description: ${JSON.stringify(description)}`,
      '',
    ].join('\n'))
    await atomicWrite(
      join(directory, PRESET_SIDECAR),
      `${JSON.stringify(sidecarOf(definition), null, 2)}\n`,
    )
    await ctx.agentPresets.standingKeyFor(definition.id)
    return {
      id: definition.id,
      name: definition.name,
      provider: definition.provider,
      model: definition.model,
      ...definition.reasoningEffort === undefined ? {} : { reasoningEffort: definition.reasoningEffort },
    }
  } catch (error) {
    if (copied) await ctx.agentPresets.remove(definition.id).catch(() => {})
    throw error
  }
}

function registerPresetRoute(ctx) {
  return ctx.webServer.register({
    kind: 'exact',
    path: PRESET_ROUTE,
    async handler(req, res) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const rows = await listGildraPresets(ctx)
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end()
          return
        }
        json(res, 200, { ok: true, presets: rows })
        return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'Метод не поддерживается.' })
        return
      }
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        json(res, 415, { ok: false, error: 'Тело запроса должно иметь тип application/json.' })
        return
      }
      try {
        const preset = await createGildraPreset(ctx, await readJsonBody(req))
        json(res, 201, { ok: true, preset })
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

export function registerRepositoryRoute(ctx, options = {}) {
  return ctx.webServer.register({
    kind: 'exact',
    path: REPOSITORY_ROUTE,
    async handler(req, res) {
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'Метод не поддерживается.' })
        return
      }
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        json(res, 415, { ok: false, error: 'Тело запроса должно иметь тип application/json.' })
        return
      }
      try {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          throw new RepositoryImportError(error instanceof Error ? error.message : String(error))
        }
        const workspace = await cloneRepository(body, options)
        json(res, 201, { ok: true, workspace })
      } catch (error) {
        const status = error instanceof RepositoryImportError ? error.status : 500
        json(res, status, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })
}

function updaterPaths() {
  const dshHome = process.env.DSH_HOME
  const installRoot = dshHome && basename(dshHome) === 'home'
    ? dirname(dshHome)
    : join(homedir(), process.platform === 'win32' ? 'AppData/Local/GildraDSH' : '.gildra-dsh')
  return {
    installRoot,
    script: join(installRoot, 'bin', 'gildra-update.mjs'),
  }
}

async function updateStatus() {
  const now = Date.now()
  if (updateStatusCache?.expiresAt > now) return updateStatusCache.value
  const { installRoot, script } = updaterPaths()
  if (!(await pathExists(script))) throw new RepositoryImportError('Компонент обновления ещё не установлен.', 503)
  const { stdout } = await execFileAsync(process.execPath, [
    script, '--check', '--json', '--install-root', installRoot,
  ], {
    env: process.env,
    maxBuffer: 256 * 1024,
    timeout: 20_000,
    windowsHide: true,
  })
  const value = JSON.parse(stdout)
  let lastUpdate
  try {
    lastUpdate = JSON.parse(await readFile(join(installRoot, 'update-state.json'), 'utf8'))
  } catch {
    // No update attempt has completed on this installation yet.
  }
  const result = { ...value, platform: process.platform, ...(lastUpdate ? { lastUpdate } : {}) }
  updateStatusCache = { expiresAt: now + 5 * 60_000, value: result }
  return result
}

function launchUpdater() {
  const { installRoot, script } = updaterPaths()
  const child = spawn(process.execPath, [
    script, '--apply', '--install-root', installRoot, '--parent-pid', String(process.pid),
  ], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
    windowsHide: true,
  })
  child.unref()
}

function sameOriginRequest(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

export function registerUpdateRoute(ctx, options = {}) {
  return ctx.webServer.register({
    kind: 'exact',
    path: UPDATE_ROUTE,
    async handler(req, res) {
      if (req.method === 'GET') {
        try {
          const status = await (options.getStatus ?? updateStatus)()
          json(res, 200, { ok: true, status })
        } catch (error) {
          json(res, error instanceof RepositoryImportError ? error.status : 502, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'Метод не поддерживается.' })
        return
      }
      if (!sameOriginRequest(req) || req.headers['x-gildra-action'] !== 'install-update') {
        json(res, 403, { ok: false, error: 'Запуск обновления разрешён только из приложения Gildra DSH.' })
        return
      }
      try {
        await (options.launch ?? launchUpdater)()
        updateStatusCache = undefined
        json(res, 202, { ok: true, message: 'Обновление запущено.' })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

function reviewerModelOf(value) {
  if (value === null || value === undefined || value === '') return undefined
  return requiredText(value, 'Модель авто-ревью', 240)
}

function agentControlPath(options = {}) {
  if (options.settingsPath) return options.settingsPath
  const dshHome = process.env.DSH_HOME
    ?? join(updaterPaths().installRoot, 'home')
  return join(dshHome, AGENT_CONTROL_FILE)
}

async function readAgentControl(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (value?.version !== 1) return undefined
    return reviewerModelOf(value.reviewerModel)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function setReviewerModel(runtime, reviewerModel) {
  if (!runtime?.config || typeof runtime.config !== 'object') {
    throw new RepositoryImportError('Авто-ревью ещё не готово. Перезапустите приложение.', 503)
  }
  runtime.config.reviewerModel = reviewerModel
}

export function registerAgentControlRoute(ctx, options = {}) {
  const settingsPath = agentControlPath(options)
  const runtime = options.runtime ?? ctx.autoReviewRuntime
  const ready = readAgentControl(settingsPath).then((reviewerModel) => {
    setReviewerModel(runtime, reviewerModel)
  })
  return ctx.webServer.register({
    kind: 'exact',
    path: AGENT_CONTROL_ROUTE,
    async handler(req, res) {
      try {
        await ready
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        return
      }
      if (req.method === 'GET') {
        json(res, 200, {
          ok: true,
          review: {
            provider: runtime.config.reviewerProvider,
            reviewerModel: runtime.config.reviewerModel ?? null,
          },
        })
        return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'Метод не поддерживается.' })
        return
      }
      if (!sameOriginRequest(req) || req.headers['x-gildra-action'] !== 'save-agent-control') {
        json(res, 403, { ok: false, error: 'Изменять модель ревью можно только из приложения Gildra DSH.' })
        return
      }
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        json(res, 415, { ok: false, error: 'Тело запроса должно иметь тип application/json.' })
        return
      }
      const previous = runtime.config.reviewerModel
      try {
        const body = await readJsonBody(req)
        if (!Object.hasOwn(body ?? {}, 'reviewerModel')) throw new Error('Не указана модель авто-ревью.')
        const reviewerModel = reviewerModelOf(body.reviewerModel)
        setReviewerModel(runtime, reviewerModel)
        await mkdir(dirname(settingsPath), { recursive: true })
        await atomicWrite(settingsPath, `${JSON.stringify({
          version: 1,
          reviewerModel: reviewerModel ?? null,
          updatedAt: new Date().toISOString(),
        }, null, 2)}\n`)
        json(res, 200, {
          ok: true,
          review: {
            provider: runtime.config.reviewerProvider,
            reviewerModel: reviewerModel ?? null,
          },
        })
      } catch (error) {
        setReviewerModel(runtime, previous)
        json(res, error instanceof RepositoryImportError ? error.status : 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })
}

export function apply(ctx) {
  ctx.effect(() => registerPresetRoute(ctx), 'gildra-ui-compact: agent preset studio route')
  ctx.effect(() => registerRepositoryRoute(ctx), 'gildra-ui-compact: repository workspace route')
  ctx.effect(() => registerUpdateRoute(ctx), 'gildra-ui-compact: application update route')
  ctx.effect(() => registerAgentControlRoute(ctx), 'gildra-ui-compact: agent control route')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'gildra:code-map',
    order: 115,
    text: 'When Archify produces a validated HTML diagram, immediately call canvas_preview with mode=render and the local file path so the result appears in the Code Map tab. For an architecture example use examples/web-app.architecture.json from the loaded Archify skill; do not guess a generic examples/architecture.json path. Use canvas_preview file or html input only; never use its url input. Tell the user to open the Code Map tab after the preview succeeds.',
  }), 'gildra-ui-compact: code map guidance')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'gildra:tool-hygiene',
    order: 116,
    text: 'Tool-call hygiene: do not send sandbox_permissions when the requested mode equals the session current permission mode. Include sandbox_permissions only for a strictly broader escalation. Whenever a tool accepts justification, provide a non-empty complete sentence that explains why the escalation is necessary.',
  }), 'gildra-ui-compact: tool-call hygiene')

  ctx.effect(() => ctx.tools.guard((exec) => {
    if (exec.name !== 'canvas_preview') return undefined
    const args = exec.arguments
    if (args && typeof args === 'object' && typeof args.url === 'string' && args.url.trim()) {
      return 'Remote URL preview is disabled in Gildra DSH. Fetch the page with web_fetch or save a reviewed HTML file inside the workspace, then preview that local file.'
    }
    return undefined
  }), 'gildra-ui-compact: block remote canvas fetch')
}
