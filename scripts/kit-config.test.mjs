import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  desiredPlugins,
  dependencyValue,
  freshProfilePackage,
  managedAgentPresets,
  patchDshTopClient,
  patchWorkspaceFilesExplorerClient,
  pluginsMissingFromLock,
  readManagedPackages,
  reconcileBundleOrder,
  repairNodePtySpawnHelpers,
  renderProfilePatch,
  renderWorkspace,
  validateManifest,
  withPersona,
} from './kit-config.mjs'

const repoDir = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(repoDir, 'config', 'kit.json'), 'utf8'))
validateManifest(manifest)
assert.equal(manifest.distribution.version, '0.1.15')
assert.equal(manifest.runtime.ollamaVersion, '0.32.14')
assert.equal(manifest.runtime.ollamaModel, 'nomic-embed-text')
assert.equal(manifest.distribution.repository, 'Gildra-Foundation/dsh')
const serverLauncherSource = await readFile(join(repoDir, 'install', 'Start-GildraDSH.server.sh'), 'utf8')
assert.match(serverLauncherSource, /export GILDRA_DSH_SERVER=1/)
assert.match(serverLauncherSource, /GILDRA_DSH_PERMISSION_MODE:-workspace-write/)
assert.doesNotMatch(serverLauncherSource, /GILDRA_DSH_PERMISSION_MODE:-danger-full-access/)
const plugins = desiredPlugins(manifest, '/opt/gildra', 'darwin', (command) => command !== 'python3')
assert.equal(plugins.find((plugin) => plugin.package === 'dsh-codegraph').active, false)
assert.equal(plugins.find((plugin) => plugin.package === '@deepseek-ai/dsh-subagent-codex').expandedSpec, '@deepseek-ai/dsh-subagent-codex@0.1.1-rc.2')
assert.equal(dependencyValue(plugins.find((plugin) => plugin.package === '@deepseek-ai/dsh-subagent-codex')), '0.1.1-rc.2')
assert.equal(freshProfilePackage(plugins).dependencies['@deepseek-ai/dsh-subagent-codex'], '0.1.1-rc.2')
const patchedExplorerClient = patchWorkspaceFilesExplorerClient([
  'const store = {',
  '        open: true,',
  '        toggle() {',
  '        },',
  '}',
].join('\n'))
assert.match(patchedExplorerClient, /open: false/)
assert.doesNotMatch(patchedExplorerClient, /open: true/)
assert.equal(patchWorkspaceFilesExplorerClient(patchedExplorerClient), patchedExplorerClient)
const patchedTopClient = patchDshTopClient('const [open, setOpen] = useState(true);')
assert.equal(patchedTopClient, 'const [open, setOpen] = useState(false);')
assert.equal(patchDshTopClient(patchedTopClient), patchedTopClient)
assert.deepEqual(pluginsMissingFromLock(plugins, await readFile(join(repoDir, 'config', 'profile', 'pnpm-lock.yaml'), 'utf8')), [])
assert.deepEqual(
  pluginsMissingFromLock([{ package: 'new-plugin', expandedSpec: 'new-plugin@1.2.3' }], 'specifier: 1.2.2\n')
    .map((plugin) => plugin.package),
  ['new-plugin'],
)
// Совпадение версии с ЧУЖИМ пакетом не должно скрывать новый плагин от
// sentinel-преаудита: specifier обязан стоять под именем самого пакета.
assert.deepEqual(
  pluginsMissingFromLock(
    [{ package: 'new-plugin', expandedSpec: 'new-plugin@0.2.0' }],
    '      dsh-context7:\n        specifier: 0.2.0\n        version: 0.2.0\n',
  ).map((plugin) => plugin.package),
  ['new-plugin'],
)
assert.deepEqual(
  pluginsMissingFromLock(
    [{ package: 'new-plugin', expandedSpec: 'new-plugin@0.2.0' }],
    '      new-plugin:\n        specifier: 0.2.0\n        version: 0.2.0\n',
  ),
  [],
)
assert.deepEqual(
  pluginsMissingFromLock(
    [{ package: '@scope/quoted-plugin', expandedSpec: '@scope/quoted-plugin@1.0.0' }],
    "      '@scope/quoted-plugin':\n        specifier: 1.0.0\n        version: 1.0.0\n",
  ),
  [],
)
// CRLF-вариант lock-файла (Windows-checkout/правка) тоже распознаётся.
assert.deepEqual(
  pluginsMissingFromLock(
    [{ package: 'new-plugin', expandedSpec: 'new-plugin@0.2.0' }],
    '      new-plugin:\r\n        specifier: 0.2.0\r\n        version: 0.2.0\r\n',
  ),
  [],
)
assert.match(renderWorkspace(manifest, plugins), /dsh-doublecheck@0\.8\.0/)
for (const packageName of [
  'dsh-context7',
  'dsh-mcp-panel',
  'dsh-plugin-terminal',
  '@anweat/dsh-browser',
  'dsh-notification',
  '@dsh-so/dsh-plugins-finder',
  'dsh-plugin-ssh',
  'deepseek-harness-sentinel',
  'dsh-plugin-rag',
  'dsh-docker',
  'dsh-top',
]) {
  assert.ok(plugins.some((plugin) => plugin.package === packageName), `Missing managed plugin: ${packageName}`)
}
const renderedProfilePatch = await renderProfilePatch(repoDir)
assert.match(renderedProfilePatch, /id: checkpoint-rewind/)
assert.match(renderedProfilePatch, /automationMode: standard/)
assert.match(renderedProfilePatch, /opencliEnabled: false/)
assert.match(renderedProfilePatch, /passiveProbeEnabled: false/)
assert.match(renderedProfilePatch, /webhookUrl: ""/)
assert.match(renderedProfilePatch, /title: Gildra Coding/)
const presets = await managedAgentPresets(repoDir, manifest)
assert.deepEqual(
  presets.map((preset) => preset.id),
  ['engineering', 'gildra-architecture', 'gildra-clean-code', 'gildra-code-review', 'gildra-performance-audit'],
)
for (const preset of presets) {
  assert.match(preset.metadata, /^name: /m)
  assert.match(preset.metadata, /^description: /m)
  assert.match(preset.composition, /^- id: persona$/m)
  assert.match(preset.composition, /^- id: tool-fs$/m)
  assert.equal((preset.composition.match(/^- id: persona$/gm) ?? []).length, 1)
}
const personalized = withPersona(
  "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'\n",
  'Первая строка\nВторая строка',
)
assert.match(personalized, /text: \|-\n      Первая строка\n      Вторая строка/)
assert.match(personalized, /- id: tool-fs/)
const profileLock = await readFile(join(repoDir, 'config', 'profile', 'pnpm-lock.yaml'), 'utf8')
for (const plugin of plugins) {
  assert.match(profileLock, new RegExp(`specifier: ${dependencyValue(plugin).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
}
assert.doesNotMatch(profileLock, /\/Users\/|\/tmp\/gildra|[A-Z]:\\/)

const hostCapabilitiesSource = await readFile(
  join(repoDir, 'desktop', 'macos', 'Host', 'HostCapabilities.swift'),
  'utf8',
)
const implementedRPCMethods = [...hostCapabilitiesSource.matchAll(/^\s*case\s+\w+\s*=\s*"([^"]+)"/gm)]
  .map((match) => match[1])
assert.deepEqual(implementedRPCMethods, manifest.desktopHost.rpc.allowedMethods)

const overlayClientSource = await readFile(
  join(repoDir, 'plugins', 'gildra-dsh-ui-compact', 'lib', 'client.js'),
  'utf8',
)
const overlayRegistry = overlayClientSource.slice(
  overlayClientSource.indexOf('const OVERLAY_FEATURES'),
  overlayClientSource.indexOf('function applyUiEnhancements'),
)
const implementedOverlayFeatures = [...overlayRegistry.matchAll(/^\s*id:\s*'([^']+)'/gm)]
  .map((match) => match[1])
assert.deepEqual(implementedOverlayFeatures, manifest.overlay.features)

const temporary = await mkdtemp(join(tmpdir(), 'gildra-managed-state-'))
try {
  await mkdir(temporary, { recursive: true })
  await writeFile(join(temporary, '.gildra-managed-plugins.json'), JSON.stringify({
    schemaVersion: 1,
    packages: ['old-managed', 'still-managed'],
  }))
  const previous = await readManagedPackages(temporary, { ...manifest, legacyManagedPackages: ['legacy-managed'] })
  assert.deepEqual([...previous].sort(), ['legacy-managed', 'old-managed', 'still-managed'])
  assert.deepEqual(
    reconcileBundleOrder(
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'old-managed', 'user-bundle'],
      ['still-managed', 'new-managed'],
      previous,
      new Set(['user-bundle', 'still-managed', 'new-managed']),
    ),
    ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'still-managed', 'new-managed', 'user-bundle'],
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}

const terminalProfile = await mkdtemp(join(tmpdir(), 'gildra-terminal-helper-'))
try {
  const helper = join(terminalProfile, 'node_modules', 'dsh-plugin-terminal', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper')
  await mkdir(join(helper, '..'), { recursive: true })
  await writeFile(helper, 'helper', { mode: 0o644 })
  assert.deepEqual(await repairNodePtySpawnHelpers(terminalProfile, 'darwin'), [helper])
  assert.equal((await stat(helper)).mode & 0o111, 0o111)
} finally {
  await rm(terminalProfile, { recursive: true, force: true })
}

console.log('Unified kit configuration tests passed.')
