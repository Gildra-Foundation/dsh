#!/usr/bin/env node
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoDir = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = resolve(repoDir, 'config', 'kit.json')

async function fetchJson(url) {
  const headers = { accept: 'application/json', 'user-agent': 'Gildra-DSH-Upstream-Check' }
  if (process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com/')) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    headers['x-github-api-version'] = '2022-11-28'
  }
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Upstream check failed for ${url}: HTTP ${String(response.status)}`)
  return response.json()
}

export async function upstreamCandidate(manifest) {
  const npm = await fetchJson('https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest')
  if (typeof npm.version !== 'string') throw new Error('npm latest metadata has no version')
  if (npm.version === manifest.runtime.dshVersion) {
    return { changed: false, version: npm.version, commit: manifest.runtime.dshCommit }
  }
  const branch = await fetchJson('https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/heads/master')
  const commit = branch.object?.sha
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('GitHub master metadata has no commit SHA')
  return { changed: true, version: npm.version, commit }
}

async function main() {
  const write = process.argv.includes('--write')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const candidate = await upstreamCandidate(manifest)
  if (candidate.changed && write) {
    manifest.runtime.dshVersion = candidate.version
    manifest.runtime.dshCommit = candidate.commit
    const temporary = `${manifestPath}.tmp-${process.pid}`
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
    await rename(temporary, manifestPath)
  }
  process.stdout.write(`${JSON.stringify(candidate)}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
