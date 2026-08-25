import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  desiredPlugins,
  dependencyValue,
  freshProfilePackage,
  managedAgentPresets,
  patchWorkspaceFilesExplorerClient,
  readManagedPackages,
  reconcileBundleOrder,
  renderProfilePatch,
  renderWorkspace,
  validateManifest,
  withPersona,
} from './kit-config.mjs'

const repoDir = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(repoDir, 'config', 'kit.json'), 'utf8'))
validateManifest(manifest)
assert.equal(manifest.distribution.version, '0.1.11')
assert.equal(manifest.distribution.repository, 'Gildra-Foundation/dsh')
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
assert.match(renderWorkspace(manifest, plugins), /dsh-doublecheck@0\.8\.0/)
assert.match(await renderProfilePatch(repoDir), /id: checkpoint-rewind/)
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

console.log('Unified kit configuration tests passed.')
