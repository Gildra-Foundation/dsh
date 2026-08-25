import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from './lib/index.js'

const sections = []
let guard
let presetRoute
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
      presetRoute = route
      return () => {}
    },
  },
  agentPresets: {},
  effect(callback) {
    callback()
  },
}

apply(ctx)

assert.equal(sections.some((section) => section.name === 'gildra:code-map'), true)
assert.equal(sections.some((section) => section.name === 'gildra:tool-hygiene'), true)
assert.equal(typeof guard, 'function')
assert.equal(presetRoute?.path, '/gildra/agent-presets')
assert.equal(presetRoute?.kind, 'exact')
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

console.log('Gildra UI policy tests passed.')
