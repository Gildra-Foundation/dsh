import { randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const name = 'gildra-ui-compact'
export const inject = ['systemPrompt', 'tools', 'webServer', 'agentPresets']

const PRESET_ROUTE = '/gildra/agent-presets'
const PRESET_SIDECAR = 'gildra-preset.json'
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const MAX_BODY_BYTES = 96 * 1024
const MAX_PROMPT_CHARS = 32_000

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

export function apply(ctx) {
  ctx.effect(() => registerPresetRoute(ctx), 'gildra-ui-compact: agent preset studio route')

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
