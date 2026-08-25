#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  atomicWrite,
  copyLocalPlugins,
  desiredPlugins,
  freshProfilePackage,
  readManifest,
  renderWorkspace,
  run,
} from './kit-config.mjs'

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
