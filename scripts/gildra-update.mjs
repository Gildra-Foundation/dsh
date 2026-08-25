#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const DEFAULT_REPOSITORY = 'Gildra-Foundation/dsh'
const VERSION_MARKER = '.gildra-kit-version'
const STATE_FILE = 'update-state.json'
const CHECKSUM_ASSET = 'SHA256SUMS.txt'

export function parseVersion(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  }
}

export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  if (!left || !right) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1
  if (right.prerelease.length === 0 && left.prerelease.length > 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index++) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === rightPart) continue
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart.localeCompare(rightPart, 'en') > 0 ? 1 : -1
  }
  return 0
}

export function archiveNameForPlatform(targetPlatform) {
  if (targetPlatform === 'darwin') return 'Gildra-DSH-macOS.zip'
  if (targetPlatform === 'win32') return 'Gildra-DSH-Windows.zip'
  throw new Error(`Unsupported update platform: ${targetPlatform}`)
}

export function releaseStatus(currentVersion, release, targetPlatform = platform()) {
  const latestVersion = String(release.tag_name ?? '').replace(/^v/, '')
  const comparison = compareVersions(latestVersion, currentVersion)
  const assetName = archiveNameForPlatform(targetPlatform)
  return {
    currentVersion,
    latestVersion,
    updateAvailable: currentVersion === 'unknown' || comparison === 1,
    releaseUrl: release.html_url,
    publishedAt: release.published_at,
    assetName,
    assetAvailable: Array.isArray(release.assets)
      && release.assets.some(asset => asset?.name === assetName),
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function installationMetadata(installRoot) {
  let repository = DEFAULT_REPOSITORY
  try {
    const manifest = await readJson(join(installRoot, 'config', 'kit.json'))
    if (typeof manifest.distribution?.repository === 'string') repository = manifest.distribution.repository
  } catch {
    // Older installations do not have the copied manifest yet.
  }
  let currentVersion = 'unknown'
  try {
    currentVersion = (await readFile(join(installRoot, VERSION_MARKER), 'utf8')).trim() || 'unknown'
  } catch {
    // The first updater-enabled release writes the marker.
  }
  return { repository, currentVersion }
}

async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'Gildra-DSH-Updater',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`GitHub update check failed: HTTP ${String(response.status)}`)
  return response.json()
}

export async function checkForUpdate({ installRoot, targetPlatform = platform(), fetchImpl = fetch } = {}) {
  const root = installRoot ?? defaultInstallRoot(targetPlatform)
  const metadata = await installationMetadata(root)
  const release = await fetchJson(`https://api.github.com/repos/${metadata.repository}/releases/latest`, fetchImpl)
  return releaseStatus(metadata.currentVersion, release, targetPlatform)
}

function defaultInstallRoot(targetPlatform) {
  if (targetPlatform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'GildraDSH')
  }
  return join(homedir(), '.gildra-dsh')
}

function releaseAsset(release, name) {
  const asset = release.assets?.find(candidate => candidate?.name === name)
  if (!asset?.browser_download_url) throw new Error(`Release asset is missing: ${name}`)
  return asset
}

async function download(url, target, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'Gildra-DSH-Updater' },
    redirect: 'follow',
  })
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${String(response.status)}`)
  await pipeline(Readable.fromWeb(response.body), (await import('node:fs')).createWriteStream(target))
}

async function sha256(path) {
  const hash = createHash('sha256')
  const stream = (await import('node:fs')).createReadStream(path)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

function expectedChecksum(text, assetName) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (match && basename(match[2]) === assetName) return match[1].toLowerCase()
  }
  throw new Error(`Checksum for ${assetName} is missing from ${CHECKSUM_ASSET}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim()
    throw new Error(`${basename(command)} завершился с кодом ${String(result.status)}${detail ? `: ${detail}` : ''}`)
  }
}

async function findFile(root, name) {
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.shift()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isFile() && entry.name === name) return path
      if (entry.isDirectory()) pending.push(path)
    }
  }
  throw new Error(`Installer is missing from the update archive: ${name}`)
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise(resolveTimer => setTimeout(resolveTimer, 250))
  }
}

async function stopApplication(targetPlatform, parentPid, installRoot) {
  if (targetPlatform === 'darwin') {
    spawnSync('/usr/bin/osascript', ['-e', 'tell application id "net.gildra.dsh" to quit'], {
      stdio: 'ignore',
    })
  } else {
    if (processAlive(parentPid)) {
      try { process.kill(parentPid, 'SIGTERM') } catch { /* already stopped */ }
    } else {
      spawnSync('powershell.exe', [
        '-NoProfile', '-Command',
        '$needle = $args[0]; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$needle*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
        join(installRoot, 'source', 'apps', 'cli', 'lib', 'bin.js'),
      ], { stdio: 'ignore', windowsHide: true })
    }
  }
  await waitForExit(parentPid)
}

function restartApplication(targetPlatform, installRoot) {
  if (targetPlatform === 'darwin') {
    const app = join(homedir(), 'Applications', 'Gildra DSH.app')
    if (spawnSync('/usr/bin/open', [app], { stdio: 'ignore' }).status !== 0) {
      throw new Error('Не удалось снова открыть Gildra DSH.')
    }
    return
  }
  const script = join(installRoot, 'bin', 'Start-GildraDSH.ps1')
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
  ], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

async function extractArchive(archive, destination, targetPlatform) {
  if (targetPlatform === 'darwin') {
    run('/usr/bin/ditto', ['-x', '-k', archive, destination])
    return
  }
  run('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', archive, destination,
  ])
}

async function applyUpdate({ installRoot, targetPlatform = platform(), parentPid, force = false, fetchImpl = fetch }) {
  const statePath = join(installRoot, STATE_FILE)
  const metadata = await installationMetadata(installRoot)
  const release = await fetchJson(`https://api.github.com/repos/${metadata.repository}/releases/latest`, fetchImpl)
  const status = releaseStatus(metadata.currentVersion, release, targetPlatform)
  if (!force && !status.updateAvailable) return { ...status, applied: false }
  if (!status.assetAvailable) throw new Error(`В выпуске нет архива ${status.assetName}.`)

  const temporary = await mkdtemp(join(tmpdir(), 'gildra-update-'))
  let stopped = false
  try {
    await atomicJson(statePath, { status: 'downloading', version: status.latestVersion, updatedAt: new Date().toISOString() })
    const archiveAsset = releaseAsset(release, status.assetName)
    const checksumAsset = releaseAsset(release, CHECKSUM_ASSET)
    const archive = join(temporary, status.assetName)
    const checksumFile = join(temporary, CHECKSUM_ASSET)
    await Promise.all([
      download(archiveAsset.browser_download_url, archive, fetchImpl),
      download(checksumAsset.browser_download_url, checksumFile, fetchImpl),
    ])
    const expected = expectedChecksum(await readFile(checksumFile, 'utf8'), status.assetName)
    const actual = await sha256(archive)
    if (actual !== expected) throw new Error('Контрольная сумма архива обновления не совпадает.')

    const extracted = join(temporary, 'extracted')
    await mkdir(extracted)
    await extractArchive(archive, extracted, targetPlatform)
    const installerName = targetPlatform === 'darwin' ? 'macos-install.command' : 'windows-install.ps1'
    const installer = await findFile(extracted, installerName)
    const repoDir = dirname(dirname(installer))
    await atomicJson(statePath, { status: 'installing', version: status.latestVersion, updatedAt: new Date().toISOString() })
    await stopApplication(targetPlatform, parentPid, installRoot)
    stopped = true
    const environment = {
      ...process.env,
      GILDRA_DSH_INSTALL_ROOT: installRoot,
      GILDRA_DSH_NO_LAUNCH: '1',
    }
    if (targetPlatform === 'darwin') {
      run('/bin/zsh', [installer], { cwd: repoDir, env: environment, inherit: true })
    } else {
      run('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer,
      ], { cwd: repoDir, env: environment, inherit: true })
    }
    await atomicJson(statePath, { status: 'success', version: status.latestVersion, updatedAt: new Date().toISOString() })
    restartApplication(targetPlatform, installRoot)
    return { ...status, applied: true }
  } catch (error) {
    await atomicJson(statePath, {
      status: 'error',
      version: status.latestVersion,
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    }).catch(() => {})
    if (stopped) {
      try { restartApplication(targetPlatform, installRoot) } catch { /* preserve the original failure */ }
    }
    throw error
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
  }
}

function parseArgs(argv) {
  const result = { mode: 'check', json: false, force: false }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value === '--check') result.mode = 'check'
    else if (value === '--apply') result.mode = 'apply'
    else if (value === '--json') result.json = true
    else if (value === '--force') result.force = true
    else if (value === '--install-root') result.installRoot = resolve(argv[++index])
    else if (value === '--parent-pid') result.parentPid = Number(argv[++index])
    else if (value === '--temporary-runtime') result.temporaryRuntime = resolve(argv[++index])
    else throw new Error(`Unknown argument: ${value}`)
  }
  result.installRoot ??= defaultInstallRoot(platform())
  return result
}

async function relaunchOutsideWindowsInstall(args) {
  const runtime = await mkdtemp(join(tmpdir(), 'gildra-updater-runtime-'))
  const executable = join(runtime, 'node.exe')
  await copyFile(process.execPath, executable)
  const child = spawn(executable, [
    fileURLToPath(import.meta.url),
    '--apply', '--install-root', args.installRoot,
    ...(args.parentPid ? ['--parent-pid', String(args.parentPid)] : []),
    ...(args.force ? ['--force'] : []),
    '--temporary-runtime', runtime,
  ], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env })
  child.unref()
  return { scheduled: true }
}

function scheduleTemporaryRuntimeCleanup(path) {
  if (!path || platform() !== 'win32') return
  const child = spawn('powershell.exe', [
    '-NoProfile', '-Command',
    'Start-Sleep -Seconds 2; Remove-Item -LiteralPath $args[0] -Recurse -Force -ErrorAction SilentlyContinue',
    path,
  ], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'apply' && platform() === 'win32' && !args.temporaryRuntime) {
    const result = await relaunchOutsideWindowsInstall(args)
    process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${JSON.stringify(result, null, 2)}\n`)
    return
  }
  try {
    const result = args.mode === 'apply'
      ? await applyUpdate(args)
      : await checkForUpdate(args)
    process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${JSON.stringify(result, null, 2)}\n`)
  } finally {
    scheduleTemporaryRuntimeCleanup(args.temporaryRuntime)
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`Gildra DSH update failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
