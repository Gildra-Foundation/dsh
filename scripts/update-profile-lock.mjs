#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  atomicWrite,
  copyLocalPlugins,
  dependencyValue,
  desiredPlugins,
  freshProfilePackage,
  pathExists,
  pluginsMissingFromLock,
  readManifest,
  renderWorkspace,
  run,
} from './kit-config.mjs'

function githubSource(spec) {
  const match = /^github:([^/#]+\/[^#]+)#([a-f0-9]{40})$/i.exec(spec)
  return match ? { repository: match[1], commit: match[2] } : null
}

function scannerCommand(manifest) {
  const scanner = manifest.plugins.find((plugin) => plugin.package === 'deepseek-harness-sentinel')
  if (!scanner) throw new Error('deepseek-harness-sentinel must be managed before updating the profile lock')
  return scanner.spec
}

async function auditNewPlugins(repoDir, manifest, plugins, temporaryRoot) {
  const lockPath = join(repoDir, 'config', 'profile', 'pnpm-lock.yaml')
  const previousLock = await pathExists(lockPath) ? await readFile(lockPath, 'utf8') : ''
  const pending = pluginsMissingFromLock(plugins, previousLock)
    .filter((plugin) => plugin.package !== 'deepseek-harness-sentinel')
  if (pending.length === 0) return

  const scannerSpec = scannerCommand(manifest)
  const auditRoot = join(temporaryRoot, 'sentinel-audit')
  await mkdir(auditRoot, { recursive: true })
  for (const plugin of pending) {
    const github = githubSource(plugin.expandedSpec)
    const args = ['exec', '--yes', '--package', scannerSpec, '--', 'dsh-sentinel']
    if (github) {
      const target = join(auditRoot, plugin.package.replaceAll('/', '__'))
      run('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', `https://github.com/${github.repository}.git`, target])
      run('git', ['-C', target, 'checkout', '--quiet', '--detach', github.commit])
      args.push(target, '--mode', 'package')
    } else if (plugin.localSource) {
      args.push(join(repoDir, plugin.localSource), '--mode', 'package')
    } else if (plugin.expandedSpec.startsWith('link:')) {
      continue
    } else {
      args.push('audit-install', `${plugin.package}@${dependencyValue(plugin)}`)
    }
    args.push('--fail-on', 'high', '--fail-on-incomplete', '--strict-exit-codes', '--redact-paths')
    process.stdout.write(`Sentinel pre-install audit: ${plugin.package}\n`)
    run('npm', args, { cwd: repoDir, env: process.env })
  }
}

function linkPath(spec) {
  if (!spec.startsWith('link:')) throw new Error(`Expected link spec, got ${spec}`)
  return spec.slice('link:'.length)
}

async function main() {
  const repoDir = fileURLToPath(new URL('..', import.meta.url))
  const manifest = await readManifest(repoDir)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'gildra-profile-lock-'))
  const profileDir = join(temporaryRoot, 'home', 'profiles', 'web')
  try {
    const plugins = desiredPlugins(manifest, temporaryRoot, process.platform, () => true)
    await auditNewPlugins(repoDir, manifest, plugins, temporaryRoot)
    await mkdir(profileDir, { recursive: true })
    await copyLocalPlugins(repoDir, temporaryRoot, plugins)
    for (const plugin of plugins.filter((item) => item.localVersion && !item.localSource)) {
      const localDir = resolve(profileDir, linkPath(plugin.expandedSpec))
      await mkdir(localDir, { recursive: true })
      await atomicWrite(join(localDir, 'package.json'), `${JSON.stringify({
        name: plugin.package,
        version: plugin.localVersion,
        private: true,
      }, null, 2)}\n`)
    }
    await atomicWrite(join(profileDir, 'package.json'), `${JSON.stringify(freshProfilePackage(plugins), null, 2)}\n`)
    await atomicWrite(join(profileDir, 'pnpm-workspace.yaml'), renderWorkspace(manifest, plugins))
    run(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', [
      'pnpm',
      'install',
      '--lockfile-only',
      '--no-frozen-lockfile',
    ], {
      cwd: profileDir,
      env: process.env,
    })
    await atomicWrite(
      join(repoDir, 'config', 'profile', 'pnpm-lock.yaml'),
      await readFile(join(profileDir, 'pnpm-lock.yaml')),
    )
    process.stdout.write('Updated config/profile/pnpm-lock.yaml\n')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
