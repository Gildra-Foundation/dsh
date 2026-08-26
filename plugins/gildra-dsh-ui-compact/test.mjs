import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { apply, registerAgentControlRoute, registerRepositoryRoute, registerUpdateRoute } from './lib/index.js'

const sections = []
let guard
const routes = new Map()
const ctx = {
  systemPrompt: {
    section(value) {
      sections.push(value)
      return () => {}
    },
  },
  tools: {
    guard(value) {
      guard = value
      return () => {}
    },
  },
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => {}
    },
  },
  agentPresets: {},
  autoReviewRuntime: {
    config: { reviewerProvider: 'fork', reviewerModel: undefined },
  },
  effect(callback) {
    callback()
  },
}

apply(ctx)
const presetRoute = routes.get('/gildra/agent-presets')
const repositoryRoute = routes.get('/gildra/workspaces/clone')
const updateRoute = routes.get('/gildra/update')
const agentControlRoute = routes.get('/gildra/agent-control')
const clientSource = await readFile(new URL('./lib/client.js', import.meta.url), 'utf8')

assert.equal(sections.some((section) => section.name === 'gildra:code-map'), true)
assert.equal(sections.some((section) => section.name === 'gildra:tool-hygiene'), true)
assert.equal(typeof guard, 'function')
assert.equal(presetRoute?.path, '/gildra/agent-presets')
assert.equal(presetRoute?.kind, 'exact')
assert.equal(repositoryRoute?.kind, 'exact')
assert.equal(updateRoute?.kind, 'exact')
assert.equal(agentControlRoute?.kind, 'exact')
assert.match(clientSource, /Scheduled agent jobs .*revision/)
assert.match(clientSource, /Задачи ИИ по расписанию/)
assert.match(clientSource, /proxyDialogTitle: 'Настройки прокси'/)
assert.match(clientSource, /Синхронизировать MCP и навыки/)
assert.match(clientSource, /Context7 — документация/)
assert.match(clientSource, /Панель MCP/)
assert.match(clientSource, /Автоматизация браузера/)
assert.match(clientSource, /Поиск плагинов/)
assert.match(clientSource, /Терминал ещё не открыт/)
assert.match(clientSource, /'dsh-browser\.card'/)
assert.match(clientSource, /'settings\.mcpPanel'/)
assert.match(clientSource, /applyManagedPluginInventoryTranslations\(\)/)
assert.match(clientSource, /applyTerminalTranslations\(\)/)
assert.match(clientSource, /applySystemMonitorTranslations\(\)/)
assert.match(clientSource, /applySshRemoteTranslations\(\)/)
assert.match(clientSource, /applyContextDoctorTranslations\(\)/)
assert.match(clientSource, /\.dsh-auto-workspace/)
assert.match(clientSource, /Exit Automations', 'Закрыть автоматизации/)
assert.match(clientSource, /body:has\(\.dsh-auto-workspace\) \.sysmon/)
assert.match(clientSource, /body:has\(\[data-context-doctor\] \[role="dialog"\]\) \.sysmon/)
assert.match(clientSource, /Configured remotes .*Настроенные серверы/)
assert.match(clientSource, /'settings\.sshRemotes'/)
assert.match(clientSource, /'ui-rag'/)
assert.match(clientSource, /Сервер SSH/)
assert.match(clientSource, /Среды выполнения/)
assert.match(clientSource, /Локально/)
assert.match(clientSource, /Серверы/)
assert.match(clientSource, /gildraRemote/)
assert.match(clientSource, /gildraFleet/)
assert.match(clientSource, /function safeHarnessURL/)
assert.match(clientSource, /url\.protocol !== 'http:'/)
assert.match(clientSource, /host\.call\('processes\.status'\)/)
assert.match(clientSource, /action: 'connect'/)
assert.match(clientSource, /action: 'disconnect'/)
assert.match(clientSource, /remote\.tunnel\?\.up && !remote\.connected/)
assert.match(clientSource, /gildra-collapsed-environment/)
assert.match(clientSource, /Сервер · \$\{remote\.name\}/)
assert.match(clientSource, /Память RAG/)
assert.match(clientSource, /СИСТЕМА/)
assert.match(clientSource, /data-gildra-collapsed/)
assert.match(clientSource, /Открыть системный монитор/)
assert.match(clientSource, /root\.dataset\.gildraCollapsed = String\(collapsed\)/)
assert.match(clientSource, /Агенты и авто-ревью/)
assert.match(clientSource, /Модель авто-ревью/)
assert.match(clientSource, /gildra-agent-menu-trigger/)
assert.match(clientSource, /gildra-agent-menu-popover/)
assert.match(clientSource, /Создать сабагента/)
assert.match(clientSource, /Choose your language · Выберите язык/)
assert.match(clientSource, /gildra\.language-choice\.v1/)
assert.match(clientSource, /ctx\.locale\.setLocale\(language\)/)
assert.match(clientSource, /aria-modal/)
assert.match(clientSource, /document\.activeElement === last/)
assert.match(clientSource, /team_spawn/)
assert.match(clientSource, /const OVERLAY_FEATURES = Object\.freeze/)
assert.match(clientSource, /window\.gildraHost\.call\('files\.chooseDirectory'\)/)
assert.match(clientSource, /host\.call\('host\.capabilities'\)/)
assert.match(
  guard({ name: 'canvas_preview', arguments: { mode: 'render', url: 'https://example.com' } }),
  /Remote URL preview is disabled/,
)
assert.equal(guard({ name: 'canvas_preview', arguments: { mode: 'render', file: '/workspace/map.html' } }), undefined)
assert.equal(guard({ name: 'web_fetch', arguments: { url: 'https://example.com' } }), undefined)

const presetRoot = await mkdtemp(join(tmpdir(), 'gildra-preset-test-'))
try {
  const presets = new Map()
  const baseDirectory = join(presetRoot, 'engineering')
  await mkdir(baseDirectory)
  await writeFile(join(baseDirectory, 'agent.cordis.yml'), [
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    text: >-',
    '      Original persona.',
    '',
    '- id: tool-bash',
    "  name: '@deepseek-ai/dsh-tool-bash'",
    '',
  ].join('\n'))
  presets.set('engineering', {
    id: 'engineering',
    name: 'Engineering',
    path: join(baseDirectory, 'agent.cordis.yml'),
  })
  ctx.agentPresets.list = async () => [...presets.values()]
  ctx.agentPresets.resolve = async (id) => {
    const preset = presets.get(id)
    if (!preset) throw new Error(`Unknown preset: ${id}`)
    return preset
  }
  ctx.agentPresets.copy = async (source, id, name) => {
    const sourcePreset = await ctx.agentPresets.resolve(source)
    const targetDirectory = join(presetRoot, id)
    await mkdir(targetDirectory)
    await writeFile(join(targetDirectory, 'agent.cordis.yml'), await readFile(sourcePreset.path))
    presets.set(id, { id, name, path: join(targetDirectory, 'agent.cordis.yml') })
  }
  ctx.agentPresets.standingKeyFor = async (id) => {
    const composition = await readFile((await ctx.agentPresets.resolve(id)).path, 'utf8')
    assert.equal(composition.match(/@deepseek-ai\/dsh-persona/g)?.length, 1)
    assert.equal(composition.match(/^- id: tool-bash$/gm)?.length, 1)
    return `preset:${id}`
  }
  ctx.agentPresets.remove = async (id) => {
    const preset = presets.get(id)
    if (preset) await rm(dirname(preset.path), { recursive: true })
    presets.delete(id)
  }

  const request = Readable.from([JSON.stringify({
    id: 'qa-agent',
    name: 'QA Agent',
    systemPrompt: 'Ты — агент проверки.',
    provider: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'high',
  })])
  request.method = 'POST'
  request.headers = { 'content-type': 'application/json' }
  let responseStatus
  let responseBody = ''
  const response = {
    writeHead(status) { responseStatus = status },
    end(body = '') { responseBody += body },
  }
  await presetRoute.handler(request, response)
  assert.equal(responseStatus, 201)
  assert.equal(JSON.parse(responseBody).preset.model, 'gpt-5.4')
  assert.match(await readFile(join(presetRoot, 'qa-agent', 'agent.cordis.yml'), 'utf8'), /Ты — агент проверки\./)
  assert.deepEqual(
    JSON.parse(await readFile(join(presetRoot, 'qa-agent', 'gildra-preset.json'), 'utf8')),
    { version: 1, provider: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' },
  )
} finally {
  await rm(presetRoot, { recursive: true, force: true })
}

function requestFor(body, method = 'POST') {
  const request = Readable.from([JSON.stringify(body)])
  request.method = method
  request.headers = { 'content-type': 'application/json' }
  return request
}

async function callRoute(route, request) {
  let status
  let body = ''
  await route.handler(request, {
    writeHead(value) { status = value },
    end(value = '') { body += value },
  })
  return { status, body: body ? JSON.parse(body) : undefined }
}

const agentControlRoot = await mkdtemp(join(tmpdir(), 'gildra-agent-control-test-'))
try {
  const settingsPath = join(agentControlRoot, 'agent-control.json')
  const runtime = { config: { reviewerProvider: 'fork', reviewerModel: undefined } }
  let testRoute
  registerAgentControlRoute({
    autoReviewRuntime: runtime,
    webServer: {
      register(route) {
        testRoute = route
        return () => {}
      },
    },
  }, { settingsPath })

  const initial = await callRoute(testRoute, requestFor({}, 'GET'))
  assert.equal(initial.status, 200)
  assert.equal(initial.body.review.provider, 'fork')
  assert.equal(initial.body.review.reviewerModel, null)

  const forbidden = await callRoute(testRoute, requestFor({ reviewerModel: 'gpt-5.6-sol' }))
  assert.equal(forbidden.status, 403)

  const saveRequest = requestFor({ reviewerModel: 'gpt-5.6-sol' })
  saveRequest.headers['x-gildra-action'] = 'save-agent-control'
  const saved = await callRoute(testRoute, saveRequest)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.review.reviewerModel, 'gpt-5.6-sol')
  assert.equal(runtime.config.reviewerModel, 'gpt-5.6-sol')
  assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).reviewerModel, 'gpt-5.6-sol')

  const inheritedRuntime = { config: { reviewerProvider: 'fork', reviewerModel: undefined } }
  registerAgentControlRoute({
    autoReviewRuntime: inheritedRuntime,
    webServer: {
      register(route) {
        testRoute = route
        return () => {}
      },
    },
  }, { settingsPath })
  const restored = await callRoute(testRoute, requestFor({}, 'GET'))
  assert.equal(restored.body.review.reviewerModel, 'gpt-5.6-sol')
  assert.equal(inheritedRuntime.config.reviewerModel, 'gpt-5.6-sol')

  const inheritRequest = requestFor({ reviewerModel: null })
  inheritRequest.headers['x-gildra-action'] = 'save-agent-control'
  const inherited = await callRoute(testRoute, inheritRequest)
  assert.equal(inherited.status, 200)
  assert.equal(inherited.body.review.reviewerModel, null)
  assert.equal(inheritedRuntime.config.reviewerModel, undefined)
} finally {
  await rm(agentControlRoot, { recursive: true, force: true })
}

const repositoryRoot = await mkdtemp(join(tmpdir(), 'gildra-repository-test-'))
try {
  let cloneCalls = 0
  let testRoute
  registerRepositoryRoute({
    webServer: {
      register(route) {
        testRoute = route
        return () => {}
      },
    },
  }, {
    projectsRoot: repositoryRoot,
    async runGitClone(url, target) {
      cloneCalls++
      assert.equal(url, 'https://github.com/Gildra-Foundation/dsh.git')
      await mkdir(target)
      await writeFile(join(target, 'README.md'), '# cloned\n')
    },
  })

  const rejected = await callRoute(testRoute, requestFor({ url: 'http://github.com/Gildra-Foundation/dsh.git' }))
  assert.equal(rejected.status, 400)
  assert.match(rejected.body.error, /HTTPS/)
  assert.equal(cloneCalls, 0)

  const missingUrl = await callRoute(testRoute, requestFor({}))
  assert.equal(missingUrl.status, 400)
  assert.match(missingUrl.body.error, /Ссылка на репозиторий/)
  assert.equal(cloneCalls, 0)

  const imported = await callRoute(testRoute, requestFor({
    url: 'https://github.com/Gildra-Foundation/dsh.git',
    folderName: 'dsh-test',
  }))
  assert.equal(imported.status, 201)
  assert.equal(imported.body.workspace.path, join(repositoryRoot, 'dsh-test'))
  assert.equal(await readFile(join(repositoryRoot, 'dsh-test', 'README.md'), 'utf8'), '# cloned\n')
  assert.equal(cloneCalls, 1)

  const duplicate = await callRoute(testRoute, requestFor({
    url: 'https://github.com/Gildra-Foundation/dsh.git',
    folderName: 'dsh-test',
  }))
  assert.equal(duplicate.status, 409)
  assert.match(duplicate.body.error, /уже существует/)
  assert.equal(cloneCalls, 1)

  const unsafeName = await callRoute(testRoute, requestFor({
    url: 'https://github.com/Gildra-Foundation/dsh.git',
    folderName: '../outside',
  }))
  assert.equal(unsafeName.status, 400)
  assert.equal(cloneCalls, 1)
} finally {
  await rm(repositoryRoot, { recursive: true, force: true })
}

let launchedUpdates = 0
let testUpdateRoute
registerUpdateRoute({
  webServer: {
    register(route) {
      testUpdateRoute = route
      return () => {}
    },
  },
}, {
  async getStatus() {
    return { currentVersion: '0.1.11', latestVersion: '0.1.12', updateAvailable: true }
  },
  async launch() { launchedUpdates++ },
})

const updateStatusResponse = await callRoute(testUpdateRoute, requestFor({}, 'GET'))
assert.equal(updateStatusResponse.status, 200)
assert.equal(updateStatusResponse.body.status.updateAvailable, true)

const forbiddenUpdate = await callRoute(testUpdateRoute, requestFor({}))
assert.equal(forbiddenUpdate.status, 403)
assert.equal(launchedUpdates, 0)

const allowedRequest = requestFor({})
allowedRequest.headers['x-gildra-action'] = 'install-update'
allowedRequest.headers.origin = 'http://127.0.0.1:3080'
const allowedUpdate = await callRoute(testUpdateRoute, allowedRequest)
assert.equal(allowedUpdate.status, 202)
assert.equal(launchedUpdates, 1)

console.log('Gildra UI policy tests passed.')
