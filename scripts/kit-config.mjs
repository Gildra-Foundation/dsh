import { createHash } from 'node:crypto'
import { access, chmod, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export const MANAGED_STATE_FILE = '.gildra-managed-plugins.json'
export const PROFILE_PATCH_FILE = 'cordis.patch.yml'

export async function repairNodePtySpawnHelpers(profileDir, platform = process.platform) {
  if (platform !== 'darwin') return []
  const repaired = []
  const roots = [
    join(profileDir, 'node_modules', 'node-pty', 'prebuilds'),
    join(profileDir, 'node_modules', 'dsh-plugin-terminal', 'node_modules', 'node-pty', 'prebuilds'),
  ]
  for (const root of roots) {
    for (const architecture of ['darwin-arm64', 'darwin-x64']) {
      const helper = join(root, architecture, 'spawn-helper')
      if (!(await pathExists(helper))) continue
      await chmod(helper, 0o755)
      repaired.push(helper)
    }
  }
  return repaired
}

export async function readManifest(repoDir) {
  const path = join(repoDir, 'config', 'kit.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  validateManifest(manifest)
  return manifest
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error('Unsupported config/kit.json schemaVersion')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.distribution?.version ?? '')) {
    throw new Error('config/kit.json distribution.version must be a semantic version')
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.distribution?.repository ?? '')) {
    throw new Error('config/kit.json distribution.repository must be an owner/repository pair')
  }
  if (manifest.distribution?.channel !== 'stable') {
    throw new Error('config/kit.json distribution.channel must be stable')
  }
  for (const key of ['dshCommit', 'dshVersion', 'nodeVersion', 'pnpmVersion', 'ollamaVersion', 'ollamaModel', 'codegraphCommit']) {
    if (typeof manifest.runtime?.[key] !== 'string' || manifest.runtime[key].length === 0) {
      throw new Error(`config/kit.json runtime.${key} must be a non-empty string`)
    }
  }
  for (const key of ['darwinArm64', 'darwinX64', 'linuxArm64', 'linuxX64', 'winX64']) {
    if (!/^[a-f0-9]{64}$/.test(manifest.runtime.nodeSha256?.[key] ?? '')) {
      throw new Error(`config/kit.json runtime.nodeSha256.${key} must be a SHA-256 digest`)
    }
  }
  for (const key of ['linuxArm64', 'linuxX64']) {
    if (!/^[a-f0-9]{64}$/.test(manifest.runtime.ollamaSha256?.[key] ?? '')) {
      throw new Error(`config/kit.json runtime.ollamaSha256.${key} must be a SHA-256 digest`)
    }
  }
  if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
    throw new Error('config/kit.json plugins must be a non-empty array')
  }
  if (!Array.isArray(manifest.languageServers) || manifest.languageServers.length === 0) {
    throw new Error('config/kit.json languageServers must be a non-empty array')
  }
  const names = new Set()
  for (const plugin of manifest.plugins) {
    if (typeof plugin.package !== 'string' || typeof plugin.spec !== 'string') {
      throw new Error('Every managed plugin needs package and spec strings')
    }
    if (names.has(plugin.package)) throw new Error(`Duplicate managed plugin: ${plugin.package}`)
    names.add(plugin.package)
  }

  const presetConfig = manifest.product?.presets
  if (typeof presetConfig?.root !== 'string' || presetConfig.root.startsWith('/') || presetConfig.root.includes('..')) {
    throw new Error('config/kit.json product.presets.root must be a safe repository-relative path')
  }
  if (!Array.isArray(presetConfig.managedIds) || presetConfig.managedIds.length === 0) {
    throw new Error('config/kit.json product.presets.managedIds must be a non-empty array')
  }
  const presetIds = new Set()
  for (const id of presetConfig.managedIds) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new Error(`Invalid managed preset id: ${String(id)}`)
    }
    if (presetIds.has(id)) throw new Error(`Duplicate managed preset id: ${id}`)
    presetIds.add(id)
  }

  const productPackages = [
    manifest.product?.skills?.managerPackage,
    manifest.product?.skills?.installerPackage,
    manifest.product?.skills?.importPackage,
    manifest.product?.mcp?.importPackage,
    manifest.product?.mcp?.bridgePackage,
    manifest.product?.automations?.package,
  ]
  for (const packageName of productPackages) {
    if (typeof packageName !== 'string' || !names.has(packageName)) {
      throw new Error(`Product capability references an unmanaged plugin: ${String(packageName)}`)
    }
  }
  if (typeof manifest.product?.automations?.templatesRoot !== 'string') {
    throw new Error('config/kit.json product.automations.templatesRoot must be a string')
  }

  if (manifest.desktopHost?.schemaVersion !== 1 || manifest.desktopHost?.rpc?.version !== 1) {
    throw new Error('config/kit.json desktopHost and RPC schema versions must be 1')
  }
  const rpcMethods = manifest.desktopHost?.rpc?.allowedMethods
  if (!Array.isArray(rpcMethods) || rpcMethods.length === 0 || new Set(rpcMethods).size !== rpcMethods.length) {
    throw new Error('config/kit.json desktopHost.rpc.allowedMethods must be a non-empty unique array')
  }
  for (const method of rpcMethods) {
    if (typeof method !== 'string' || !/^[a-z][a-zA-Z0-9-]*\.[a-z][a-zA-Z0-9-]*$/.test(method)) {
      throw new Error(`Invalid desktop host RPC method: ${String(method)}`)
    }
  }

  if (typeof manifest.overlay?.package !== 'string' || !names.has(manifest.overlay.package)) {
    throw new Error('config/kit.json overlay.package must reference a managed plugin')
  }
  if (!Array.isArray(manifest.overlay.features) || manifest.overlay.features.length === 0
      || new Set(manifest.overlay.features).size !== manifest.overlay.features.length) {
    throw new Error('config/kit.json overlay.features must be a non-empty unique array')
  }
}

export function manifestTokens(manifest, installRoot) {
  return {
    DSH_VERSION: manifest.runtime.dshVersion,
    INSTALL_ROOT: installRoot,
    VENDOR_DIR: join(installRoot, 'vendor'),
  }
}

export function expand(value, tokens) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    if (!(name in tokens)) throw new Error(`Unknown manifest token: ${name}`)
    return tokens[name]
  })
}

export function dependencyValue(plugin) {
  const prefix = `${plugin.package}@`
  return plugin.expandedSpec.startsWith(prefix)
    ? plugin.expandedSpec.slice(prefix.length)
    : plugin.expandedSpec
}

export function pluginsMissingFromLock(plugins, lockText) {
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return plugins.filter((plugin) => {
    const specifier = dependencyValue(plugin)
    // Specifier привязан к имени пакета: голый substring-поиск считал новый
    // плагин «уже в lock», если та же версия встречалась у другого пакета,
    // и sentinel-преаудит нового пакета молча пропускался.
    // \r-толерантность: lock, прочитанный с Windows-машины пользователя,
    // может содержать CRLF независимо от нормализации в самом репозитории.
    const entry = new RegExp(
      `^ {6}'?${escapeRegExp(plugin.package)}'?:\\r?\\n {8}specifier: ${escapeRegExp(specifier)}\\r?$`,
      'm',
    )
    return !entry.test(lockText)
  })
}

export function patchWorkspaceFilesExplorerClient(source) {
  const openMarker = '        open: true,\n        toggle() {'
  const closedMarker = '        open: false,\n        toggle() {'
  const openMatches = source.split(openMarker).length - 1
  const closedMatches = source.split(closedMarker).length - 1
  if (openMatches === 0 && closedMatches === 1) return source
  if (openMatches !== 1 || closedMatches !== 0) {
    throw new Error(`workspace-files-explorer startup marker changed: open=${String(openMatches)}, closed=${String(closedMatches)}`)
  }
  return source.replace(openMarker, closedMarker)
}

export function patchDshTopClient(source) {
  const openMarker = 'const [open, setOpen] = useState(true);'
  const closedMarker = 'const [open, setOpen] = useState(false);'
  const openMatches = source.split(openMarker).length - 1
  const closedMatches = source.split(closedMarker).length - 1
  if (openMatches === 0 && closedMatches === 1) return source
  if (openMatches !== 1 || closedMatches !== 0) {
    throw new Error(`dsh-top startup marker changed: open=${String(openMatches)}, closed=${String(closedMatches)}`)
  }
  return source.replace(openMarker, closedMarker)
}

export function freshProfilePackage(plugins) {
  return {
    name: 'dsh-profile-web',
    private: true,
    dependencies: Object.fromEntries(plugins.map((plugin) => [plugin.package, dependencyValue(plugin)])),
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      },
    },
  }
}

export function commandAvailable(command) {
  if (!command) return true
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  return result.status === 0
}

export function desiredPlugins(manifest, installRoot, platform = process.platform, hasCommand = commandAvailable) {
  const tokens = manifestTokens(manifest, installRoot)
  return manifest.plugins
    .map((plugin) => {
      const required = plugin.activateRequiresCommand?.[platform]
      return {
        ...plugin,
        active: required === undefined || hasCommand(required),
        expandedSpec: expand(plugin.spec, tokens),
      }
    })
}

function yamlScalar(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function renderWorkspace(manifest, plugins) {
  const lines = [
    'packages:',
    '  - .',
    '',
    `nodeLinker: ${manifest.profilePnpm.nodeLinker}`,
    `autoInstallPeers: ${String(manifest.profilePnpm.autoInstallPeers)}`,
    'allowBuilds:',
  ]
  for (const [name, allowed] of Object.entries(manifest.profilePnpm.allowBuilds)) {
    lines.push(`  ${yamlScalar(name)}: ${String(allowed)}`)
  }
  const exclusions = plugins.filter((plugin) => plugin.minimumReleaseAgeExclude)
  if (exclusions.length > 0) {
    lines.push('minimumReleaseAgeExclude:')
    for (const plugin of exclusions) lines.push(`  - ${yamlScalar(plugin.expandedSpec)}`)
  }
  return `${lines.join('\n')}\n`
}

export async function renderProfilePatch(repoDir) {
  const fragmentDir = join(repoDir, 'config', 'profile', 'fragments')
  const names = (await readdir(fragmentDir))
    .filter((name) => name.endsWith('.yml'))
    .sort((left, right) => left.localeCompare(right, 'en'))
  if (names.length === 0) throw new Error('No profile fragments found')
  const sections = []
  for (const name of names) sections.push((await readFile(join(fragmentDir, name), 'utf8')).trim())
  return [
    '# Generated from config/profile/fragments by scripts/configure-profile.mjs.',
    '# Edit the fragments, not this installed file.',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n')
}

function personaRow(systemPrompt) {
  const indented = systemPrompt.replace(/\r\n?/g, '\n').trim().split('\n')
    .map((line) => `      ${line}`)
    .join('\n')
  return `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: |-\n${indented}\n\n`
}

export function withPersona(composition, systemPrompt) {
  const row = /^- id: persona\s*$/m.exec(composition)
  if (!row) throw new Error('Base agent preset does not contain a persona row')
  const nextRow = composition.indexOf('\n- id: ', row.index + row[0].length)
  const rowEnd = nextRow === -1 ? composition.length : nextRow + 1
  return `${composition.slice(0, row.index)}${personaRow(systemPrompt)}${composition.slice(rowEnd)}`
}

export async function managedAgentPresets(repoDir, manifest = undefined) {
  const kit = manifest ?? await readManifest(repoDir)
  const root = join(repoDir, kit.product.presets.root)
  const baseComposition = await readFile(join(root, 'engineering', 'agent.cordis.yml'), 'utf8')
  const presets = []
  for (const id of kit.product.presets.managedIds) {
    const directory = join(root, id)
    const metadata = await readFile(join(directory, 'preset.yml'), 'utf8')
    const promptPath = join(directory, 'system-prompt.md')
    const composition = await pathExists(promptPath)
      ? withPersona(baseComposition, await readFile(promptPath, 'utf8'))
      : await readFile(join(directory, 'agent.cordis.yml'), 'utf8')
    presets.push({ id, metadata, composition })
  }
  return presets
}

export function managedState(manifest, plugins) {
  const payload = {
    schemaVersion: 1,
    manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    packages: plugins.map((plugin) => plugin.package),
    specs: Object.fromEntries(plugins.map((plugin) => [plugin.package, plugin.expandedSpec])),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export async function readManagedPackages(profileDir, manifest) {
  const statePath = join(profileDir, MANAGED_STATE_FILE)
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    if (state.schemaVersion !== 1 || !Array.isArray(state.packages)) throw new Error('invalid state')
    return new Set([...state.packages, ...(manifest.legacyManagedPackages ?? [])])
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.message !== 'invalid state') throw error
    return new Set([
      ...manifest.plugins.map((plugin) => plugin.package),
      ...(manifest.legacyManagedPackages ?? []),
    ])
  }
}

export function reconcileBundleOrder(currentBundles, desiredBundleNames, previouslyManaged, userDependencies) {
  const core = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  const desired = new Set(desiredBundleNames)
  const userBundles = currentBundles.filter((name) =>
    !core.includes(name)
    && !desired.has(name)
    && !previouslyManaged.has(name)
    && userDependencies.has(name))
  return [...core, ...desiredBundleNames, ...userBundles]
}

export async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, content)
  await rename(temporary, path)
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ''}` : ''
    throw new Error(`${command} exited with code ${String(result.status)}${detail}`)
  }
  return result
}

export async function copyLocalPlugins(repoDir, installRoot, plugins) {
  const vendorDir = join(installRoot, 'vendor')
  await mkdir(vendorDir, { recursive: true })
  for (const plugin of plugins.filter((item) => item.localSource)) {
    const source = resolve(repoDir, plugin.localSource)
    const target = join(vendorDir, plugin.localTarget ?? plugin.package.split('/').at(-1))
    await rm(target, { recursive: true, force: true })
    await cp(source, target, { recursive: true })
  }
}

export async function packageIsBundle(profileDir, packageName) {
  const packagePath = join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json')
  try {
    const value = JSON.parse(await readFile(packagePath, 'utf8'))
    return typeof value.dsh?.bundle?.patch === 'string'
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}
