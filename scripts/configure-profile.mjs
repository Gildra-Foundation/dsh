#!/usr/bin/env node
import { cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MANAGED_STATE_FILE,
  PROFILE_PATCH_FILE,
  atomicWrite,
  copyLocalPlugins,
  dependencyValue,
  desiredPlugins,
  freshProfilePackage,
  managedAgentPresets,
  managedState,
  patchDshTopClient,
  packageIsBundle,
  patchWorkspaceFilesExplorerClient,
  packageManagerInvocation,
  pathExists,
  readManagedPackages,
  readManifest,
  reconcileBundleOrder,
  repairNodePtySpawnHelpers,
  renderProfilePatch,
  renderWorkspace,
  run,
} from './kit-config.mjs'

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${name ?? ''}`)
    result[name.slice(2)] = value
  }
  for (const required of ['repo-dir', 'install-root']) {
    if (!result[required]) throw new Error(`Missing --${required}`)
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoDir = resolve(args['repo-dir'])
  const installRoot = resolve(args['install-root'])
  const profileDir = join(installRoot, 'home', 'profiles', 'web')
  const dshHome = join(installRoot, 'home')
  const cli = join(installRoot, 'source', 'apps', 'cli', 'lib', 'bin.js')
  const manifest = await readManifest(repoDir)
  const plugins = desiredPlugins(manifest, installRoot)
  const previousManaged = await readManagedPackages(profileDir, manifest)
  const desiredNames = new Set(plugins.map((plugin) => plugin.package))
  const obsolete = [...previousManaged].filter((name) => !desiredNames.has(name))
  const packagePath = join(profileDir, 'package.json')
  const freshProfile = !(await pathExists(packagePath))

  await mkdir(profileDir, { recursive: true })
  await copyLocalPlugins(repoDir, installRoot, plugins)
  await atomicWrite(join(profileDir, 'pnpm-workspace.yaml'), renderWorkspace(manifest, plugins))

  const environment = {
    ...process.env,
    DSH_HOME: dshHome,
    PATH: [
      join(installRoot, 'lsp', 'node_modules', '.bin'),
      dirname(process.execPath),
      process.env.PATH ?? '',
    ].join(process.platform === 'win32' ? ';' : ':'),
  }
  let profilePackage = freshProfile
    ? freshProfilePackage([])
    : JSON.parse(await readFile(packagePath, 'utf8'))
  const dependencies = { ...profilePackage.dependencies }
  for (const packageName of obsolete) delete dependencies[packageName]
  for (const plugin of plugins) dependencies[plugin.package] = dependencyValue(plugin)
  profilePackage.dependencies = dependencies
  await atomicWrite(packagePath, `${JSON.stringify(profilePackage, null, 2)}\n`)

  const lockTemplate = join(repoDir, 'config', 'profile', 'pnpm-lock.yaml')
  const hasLockTemplate = await pathExists(lockTemplate)
  if (freshProfile && hasLockTemplate) await cp(lockTemplate, join(profileDir, 'pnpm-lock.yaml'))
  const pnpmInstall = packageManagerInvocation('corepack', [
    'pnpm', 'install', freshProfile && hasLockTemplate ? '--frozen-lockfile' : '--no-frozen-lockfile',
  ])
  run(pnpmInstall.command, pnpmInstall.args, {
    cwd: profileDir,
    env: environment,
  })
  await repairNodePtySpawnHelpers(profileDir)
  // pnpm may append a temporary release-age exception while resolving.
  // Restore the deployment-owned workspace policy after package reconciliation.
  await atomicWrite(join(profileDir, 'pnpm-workspace.yaml'), renderWorkspace(manifest, plugins))

  const lspInstall = packageManagerInvocation('npm', [
    'install', '--prefix', join(installRoot, 'lsp'), '--save-exact', '--no-audit', '--no-fund', ...manifest.languageServers,
  ])
  run(lspInstall.command, lspInstall.args, {
    env: environment,
  })

  const explorerTarget = join(profileDir, 'node_modules', 'workspace-files-explorer', 'index.js')
  await cp(join(repoDir, 'patches', 'workspace-files-explorer-index.js'), explorerTarget)
  const explorerClientTarget = join(profileDir, 'node_modules', 'workspace-files-explorer', 'lib', 'client.js')
  await atomicWrite(
    explorerClientTarget,
    patchWorkspaceFilesExplorerClient(await readFile(explorerClientTarget, 'utf8')),
  )
  const topClientTarget = join(profileDir, 'node_modules', 'dsh-top', 'lib', 'client.js')
  await atomicWrite(topClientTarget, patchDshTopClient(await readFile(topClientTarget, 'utf8')))

  for (const preset of await managedAgentPresets(repoDir, manifest)) {
    const presetDir = join(dshHome, '.agent-presets', preset.id)
    await mkdir(presetDir, { recursive: true })
    await atomicWrite(join(presetDir, 'agent.cordis.yml'), preset.composition)
    await atomicWrite(join(presetDir, 'preset.yml'), preset.metadata)
  }
  const settingsPath = join(dshHome, 'settings.yaml')
  if (!(await pathExists(settingsPath))) await cp(join(repoDir, 'config', 'settings.yaml'), settingsPath)
  await atomicWrite(join(profileDir, PROFILE_PATCH_FILE), await renderProfilePatch(repoDir))

  profilePackage = JSON.parse(await readFile(packagePath, 'utf8'))
  const desiredBundles = []
  for (const plugin of plugins) {
    if (plugin.active && await packageIsBundle(profileDir, plugin.package)) desiredBundles.push(plugin.package)
  }
  const installedDependencies = new Set(Object.keys(profilePackage.dependencies ?? {}))
  const currentBundles = profilePackage.dsh?.profile?.bundles ?? []
  profilePackage.dsh = {
    ...profilePackage.dsh,
    profile: {
      ...profilePackage.dsh?.profile,
      bundles: reconcileBundleOrder(currentBundles, desiredBundles, previousManaged, installedDependencies),
    },
  }
  await atomicWrite(packagePath, `${JSON.stringify(profilePackage, null, 2)}\n`)

  const dump = run(process.execPath, [cli, '--profile', 'web', '--dump-config'], {
    cwd: repoDir,
    env: environment,
    capture: true,
  })
  if (!dump.stdout.includes('id: gildra-ui-compact') || !dump.stdout.includes('id: lsp-actions')
    || !dump.stdout.includes('id: gildra-runtime')) {
    throw new Error('Composed profile is missing required Gildra rows')
  }
  await atomicWrite(join(profileDir, MANAGED_STATE_FILE), managedState(manifest, plugins))

  process.stdout.write(`Configured ${plugins.length} managed plugins in ${profileDir}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`Gildra DSH configuration failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
