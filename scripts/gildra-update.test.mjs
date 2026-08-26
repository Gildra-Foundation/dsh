import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CHECK_PROCESS_SCRIPT,
  CLEANUP_RUNTIME_SCRIPT,
  EXTRACT_ARCHIVE_SCRIPT,
  STOP_PROCESS_SCRIPT,
  archiveNameForPlatform,
  acquireUpdateLock,
  applyUpdate,
  checkForUpdate,
  compareVersions,
  parseVersion,
  releaseStatus,
  runPowerShellFile,
  validateStopTarget,
} from './gildra-update.mjs'

assert.deepEqual(parseVersion('v1.2.3-rc.4'), {
  major: 1,
  minor: 2,
  patch: 3,
  prerelease: ['rc', '4'],
})
assert.equal(compareVersions('0.1.12', '0.1.11'), 1)
assert.equal(compareVersions('0.1.11', '0.1.11'), 0)
assert.equal(compareVersions('0.1.11-rc.2', '0.1.11'), -1)
assert.equal(compareVersions('0.1.11-rc.10', '0.1.11-rc.2'), 1)
assert.equal(compareVersions('invalid', '0.1.11'), null)
assert.equal(archiveNameForPlatform('darwin'), 'Gildra-DSH-macOS.zip')
assert.equal(archiveNameForPlatform('win32'), 'Gildra-DSH-Windows.zip')

const release = {
  tag_name: 'v0.1.12',
  html_url: 'https://github.com/Gildra-Foundation/dsh/releases/tag/v0.1.12',
  published_at: '2026-08-25T00:00:00Z',
  assets: [
    { name: 'Gildra-DSH-macOS.zip', browser_download_url: 'https://example.test/mac.zip' },
    { name: 'Gildra-DSH-Windows.zip', browser_download_url: 'https://example.test/win.zip' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt' },
  ],
}
assert.equal(releaseStatus('0.1.11', release, 'darwin').updateAvailable, true)
assert.equal(releaseStatus('0.1.13', release, 'darwin').updateAvailable, false)

const root = await mkdtemp(join(tmpdir(), 'gildra-update-check-'))
try {
  await mkdir(join(root, 'config'), { recursive: true })
  await writeFile(join(root, '.gildra-kit-version'), '0.1.11\n')
  await writeFile(join(root, 'config', 'kit.json'), JSON.stringify({
    distribution: { repository: 'Gildra-Foundation/dsh' },
  }))
  let requestedUrl
  const status = await checkForUpdate({
    installRoot: root,
    targetPlatform: 'darwin',
    async fetchImpl(url) {
      requestedUrl = url
      return new Response(JSON.stringify(release), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.equal(requestedUrl, 'https://api.github.com/repos/Gildra-Foundation/dsh/releases/latest')
  assert.equal(status.currentVersion, '0.1.11')
  assert.equal(status.latestVersion, '0.1.12')
  assert.equal(status.updateAvailable, true)
  assert.equal(status.assetAvailable, true)
} finally {
  await rm(root, { recursive: true, force: true })
}

// --- Безопасный слой PowerShell-вызовов ---

// validateStopTarget: остановка процессов допустима только для bin.js внутри
// известного install root; всё остальное — ошибка до любого вызова PowerShell.
assert.equal(
  validateStopTarget('/opt/gildra-dsh/source/apps/cli/lib/bin.js', '/opt/gildra-dsh'),
  '/opt/gildra-dsh/source/apps/cli/lib/bin.js',
)
assert.throws(() => validateStopTarget('', '/opt/gildra-dsh'))
assert.throws(() => validateStopTarget('/opt/gildra-dsh/source/apps/cli/lib/bin.js', ''))
assert.throws(() => validateStopTarget('/other/place/source/apps/cli/lib/bin.js', '/opt/gildra-dsh'))
assert.throws(() => validateStopTarget('/opt/gildra-dsh/evil.exe', '/opt/gildra-dsh'))
assert.throws(() => validateStopTarget('C:\\source\\apps\\cli\\lib\\bin.js', 'C:\\'))

// Инварианты PS-скриптов: guard пустого аргумента и литеральный Contains
// вместо -like (пустой needle в -like давал бы совпадение с любым процессом,
// а [] в пути трактуется -like как wildcard-класс).
for (const script of [STOP_PROCESS_SCRIPT, CHECK_PROCESS_SCRIPT]) {
  assert.match(script, /IsNullOrWhiteSpace/)
  assert.match(script, /\.Contains\(\$needle\)/)
  assert.doesNotMatch(script, /-like/)
}
assert.match(EXTRACT_ARCHIVE_SCRIPT, /IsNullOrWhiteSpace/)
assert.match(EXTRACT_ARCHIVE_SCRIPT, /Expand-Archive -LiteralPath/)
assert.match(CLEANUP_RUNTIME_SCRIPT, /IsNullOrWhiteSpace/)

// runPowerShellFile: аргументы уходят отдельными argv через -File, скрипт
// существует на момент запуска и удаляется после синхронного выполнения.
{
  let captured
  const result = await runPowerShellFile('exit 0\n', ['first arg', 'C:\\path with spaces\\x.zip'], {
    spawnSyncImpl(command, argv) {
      captured = {
        command,
        argv,
        scriptExisted: existsSync(argv[4]),
        scriptSource: readFileSync(argv[4], 'utf8'),
      }
      return { status: 0, stdout: '', stderr: '' }
    },
  })
  assert.equal(result.status, 0)
  assert.equal(captured.command, 'powershell.exe')
  assert.deepEqual(captured.argv.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'])
  assert.ok(captured.argv[4].endsWith('task.ps1'))
  assert.equal(captured.scriptExisted, true)
  assert.equal(captured.scriptSource, 'exit 0\n')
  assert.deepEqual(captured.argv.slice(5), ['first arg', 'C:\\path with spaces\\x.zip'])
  assert.equal(existsSync(captured.argv[4]), false)
}

// Ненулевой код без allowExitCodes — ошибка; allowExitCodes возвращает статус.
await assert.rejects(
  runPowerShellFile('exit 1\n', ['x'.repeat(20)], {
    spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: 'boom' }),
  }),
  /кодом 1/,
)
{
  const allowed = await runPowerShellFile('exit 1\n', ['x'.repeat(20)], {
    allowExitCodes: [0, 1],
    spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: '' }),
  })
  assert.equal(allowed.status, 1)
}

// Пустой аргумент отклоняется до spawn.
await assert.rejects(
  runPowerShellFile('exit 0\n', [''], { spawnSyncImpl: () => ({ status: 0 }) }),
  /non-empty/,
)

// Detached-режим: скрипт должен пережить возврат функции (его удаляет сам
// CLEANUP_RUNTIME_SCRIPT), spawn получает detached: true.
{
  let captured
  const result = await runPowerShellFile(CLEANUP_RUNTIME_SCRIPT, ['C:\\temp\\gildra-runtime'], {
    detached: true,
    spawnImpl(command, argv, options) {
      captured = { command, argv, options }
      return { unref() {} }
    },
  })
  assert.equal(result.detached, true)
  assert.equal(captured.options.detached, true)
  assert.ok(captured.argv.includes('-File'))
  assert.equal(existsSync(result.scriptPath), true)
  await rm(dirname(result.scriptPath), { recursive: true, force: true })
}

// --- Эксклюзивная блокировка обновления ---
{
  const lockRoot = await mkdtemp(join(tmpdir(), 'gildra-lock-'))
  const lockDir = join(lockRoot, '.gildra-update.lock')
  const helper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  try {
    // Живой чужой владелец: второй updater получает понятную ошибку.
    await mkdir(lockDir)
    await writeFile(join(lockDir, 'meta.json'), JSON.stringify({ pid: helper.pid }))
    await assert.rejects(acquireUpdateLock(lockRoot), /уже выполняется/)

    // release() никогда не удаляет чужой живой лок.
    await rm(lockDir, { recursive: true, force: true })
    const own = await acquireUpdateLock(lockRoot)
    await writeFile(join(lockDir, 'meta.json'), JSON.stringify({ pid: helper.pid }))
    await own.release()
    assert.equal(existsSync(lockDir), true)
    await rm(lockDir, { recursive: true, force: true })

    // Обычный цикл: захват создаёт лок, освобождение удаляет.
    const first = await acquireUpdateLock(lockRoot)
    assert.equal(existsSync(first.path), true)
    await first.release()
    assert.equal(existsSync(first.path), false)

    // Stale-лок мёртвого процесса перехватывается новым updater'ом.
    const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    const deadPid = deadChild.pid
    await new Promise(resolveExit => deadChild.on('exit', resolveExit))
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'meta.json'), JSON.stringify({ pid: deadPid }))
    const takeover = await acquireUpdateLock(lockRoot)
    assert.equal(JSON.parse(readFileSync(join(takeover.path, 'meta.json'), 'utf8')).pid, process.pid)
    await takeover.release()

    // Брошенный лок без meta.json тоже перехватывается.
    await mkdir(lockDir)
    const orphanTakeover = await acquireUpdateLock(lockRoot)
    assert.equal(existsSync(join(orphanTakeover.path, 'meta.json')), true)
    await orphanTakeover.release()
  } finally {
    helper.kill('SIGKILL')
    await rm(lockRoot, { recursive: true, force: true })
  }
}

// --- Жизненный цикл applyUpdate ---
// Сеть, распаковка, остановка, установка и перезапуск инжектируются, чтобы
// покрыть все переходы state-файла и инварианты сохранности без Windows и
// без реальных архивов.

const archiveBytes = Buffer.from('gildra fake update archive')
const archiveSha = createHash('sha256').update(archiveBytes).digest('hex')
const goodChecksums = `${archiveSha}  Gildra-DSH-macOS.zip\n${'b'.repeat(64)}  Gildra-DSH-Windows.zip\n`
const applyRelease = {
  tag_name: 'v0.1.12',
  html_url: 'https://github.com/Gildra-Foundation/dsh/releases/tag/v0.1.12',
  published_at: '2026-08-26T00:00:00Z',
  assets: [
    { name: 'Gildra-DSH-macOS.zip', browser_download_url: 'https://assets.test/Gildra-DSH-macOS.zip' },
    { name: 'Gildra-DSH-Windows.zip', browser_download_url: 'https://assets.test/Gildra-DSH-Windows.zip' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://assets.test/SHA256SUMS.txt' },
  ],
}

async function makeInstallRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gildra-apply-'))
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'home'), { recursive: true })
  await mkdir(join(root, 'source'), { recursive: true })
  await writeFile(join(root, '.gildra-kit-version'), '0.1.11')
  await writeFile(join(root, 'config', 'kit.json'), JSON.stringify({
    distribution: { repository: 'Gildra-Foundation/dsh' },
  }))
  await writeFile(join(root, 'home', 'user-data.txt'), 'precious user data\n')
  await writeFile(join(root, 'source', 'existing.js'), 'previous install\n')
  return root
}

function makeFetch({ release = applyRelease, shaText = goodChecksums } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    const text = String(url)
    if (text.includes('/releases/latest')) return new Response(JSON.stringify(release), { status: 200 })
    if (text.endsWith('SHA256SUMS.txt')) return new Response(shaText, { status: 200 })
    if (text.endsWith('.zip')) return new Response(archiveBytes, { status: 200 })
    return new Response('not found', { status: 404 })
  }
  return { fetchImpl, calls }
}

function makeSeams() {
  const log = { extracts: [], stops: 0, installs: [], restarts: 0 }
  return {
    log,
    seams: {
      async extractArchiveImpl(archive, destination) {
        log.extracts.push({ archive, destination })
        await mkdir(join(destination, 'kit', 'install'), { recursive: true })
        await writeFile(join(destination, 'kit', 'install', 'macos-install.command'), '#!/bin/zsh\n')
      },
      async stopApplicationImpl() {
        log.stops += 1
      },
      runInstallerImpl(installer, repoDir, environment) {
        log.installs.push({ installer, repoDir, environment })
        // Реальный установщик пишет маркер версии — имитируем через env,
        // чтобы проверить корректность окружения установки.
        const target = environment.GILDRA_DSH_INSTALL_ROOT
        assert.equal(environment.GILDRA_DSH_NO_LAUNCH, '1')
        writeFileSyncMarker(target, '0.1.12')
      },
      restartApplicationImpl() {
        log.restarts += 1
      },
    },
  }
}

function writeFileSyncMarker(root, version) {
  const { writeFileSync } = fsSyncModule
  writeFileSync(join(root, '.gildra-kit-version'), version)
}
const fsSyncModule = await import('node:fs')

const readState = root => JSON.parse(readFileSync(join(root, 'update-state.json'), 'utf8'))
const assertUserDataIntact = (root) => {
  assert.equal(readFileSync(join(root, 'home', 'user-data.txt'), 'utf8'), 'precious user data\n')
  assert.equal(readFileSync(join(root, 'source', 'existing.js'), 'utf8'), 'previous install\n')
}

// S1: успешное обновление — переходы state, окружение установщика,
// сохранность user home, очистка temp, снятый лок.
{
  const root = await makeInstallRoot()
  const { fetchImpl } = makeFetch()
  const { log, seams } = makeSeams()
  const result = await applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams })
  assert.equal(result.applied, true)
  assert.equal(readState(root).status, 'success')
  assert.equal(readState(root).version, '0.1.12')
  assert.equal(log.stops, 1)
  assert.equal(log.installs.length, 1)
  assert.equal(log.restarts, 1)
  assert.equal(log.installs[0].environment.GILDRA_DSH_INSTALL_ROOT, root)
  assert.ok(log.installs[0].repoDir.endsWith('kit'))
  assert.equal(readFileSync(join(root, '.gildra-kit-version'), 'utf8'), '0.1.12')
  assertUserDataIntact(root)
  assert.equal(existsSync(dirname(log.extracts[0].destination)), false)
  assert.equal(existsSync(join(root, '.gildra-update.lock')), false)
  await rm(root, { recursive: true, force: true })
}

// S2: неверная контрольная сумма — ошибка до распаковки/остановки/установки.
{
  const root = await makeInstallRoot()
  const { fetchImpl } = makeFetch({ shaText: `${'a'.repeat(64)}  Gildra-DSH-macOS.zip\n` })
  const { log, seams } = makeSeams()
  await assert.rejects(
    applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams }),
    /Контрольная сумма/,
  )
  assert.equal(readState(root).status, 'error')
  assert.equal(log.extracts.length, 0)
  assert.equal(log.stops + log.installs.length + log.restarts, 0)
  assert.equal(readFileSync(join(root, '.gildra-kit-version'), 'utf8'), '0.1.11')
  assertUserDataIntact(root)
  assert.equal(existsSync(join(root, '.gildra-update.lock')), false)
  await rm(root, { recursive: true, force: true })
}

// S3: в релизе нет платформенного архива — ошибка до записи state-файла.
{
  const root = await makeInstallRoot()
  const releaseWithoutAsset = { ...applyRelease, assets: applyRelease.assets.filter(a => a.name !== 'Gildra-DSH-macOS.zip') }
  const { fetchImpl } = makeFetch({ release: releaseWithoutAsset })
  const { log, seams } = makeSeams()
  await assert.rejects(
    applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams }),
    /нет архива/,
  )
  assert.equal(existsSync(join(root, 'update-state.json')), false)
  assert.equal(log.extracts.length + log.stops + log.installs.length + log.restarts, 0)
  await rm(root, { recursive: true, force: true })
}

// S4: сбой распаковки — state=error, приложение не останавливалось и не
// перезапускалось.
{
  const root = await makeInstallRoot()
  const { fetchImpl } = makeFetch()
  const { log, seams } = makeSeams()
  seams.extractArchiveImpl = async () => { throw new Error('extract boom') }
  await assert.rejects(
    applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams }),
    /extract boom/,
  )
  assert.equal(readState(root).status, 'error')
  assert.match(readState(root).error, /extract boom/)
  assert.equal(log.stops + log.installs.length + log.restarts, 0)
  assertUserDataIntact(root)
  await rm(root, { recursive: true, force: true })
}

// S5: сбой установщика — state=error, приложение перезапущено обратно,
// прежняя установка и данные пользователя целы, temp очищен.
{
  const root = await makeInstallRoot()
  const { fetchImpl } = makeFetch()
  const { log, seams } = makeSeams()
  seams.runInstallerImpl = () => { throw new Error('installer boom') }
  await assert.rejects(
    applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams }),
    /installer boom/,
  )
  assert.equal(readState(root).status, 'error')
  assert.equal(log.restarts, 1)
  assert.equal(readFileSync(join(root, '.gildra-kit-version'), 'utf8'), '0.1.11')
  assertUserDataIntact(root)
  assert.equal(existsSync(dirname(log.extracts[0].destination)), false)
  assert.equal(existsSync(join(root, '.gildra-update.lock')), false)
  await rm(root, { recursive: true, force: true })
}

// S6: сбой остановки приложения — установка не запускается вовсе.
{
  const root = await makeInstallRoot()
  const { fetchImpl } = makeFetch()
  const { log, seams } = makeSeams()
  seams.stopApplicationImpl = async () => { throw new Error('still running') }
  await assert.rejects(
    applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams }),
    /still running/,
  )
  assert.equal(readState(root).status, 'error')
  assert.equal(log.installs.length + log.restarts, 0)
  assert.equal(readFileSync(join(root, '.gildra-kit-version'), 'utf8'), '0.1.11')
  await rm(root, { recursive: true, force: true })
}

// S7: сбой перезапуска после успешной установки — статус остаётся success.
{
  const root = await makeInstallRoot()
  const { fetchImpl } = makeFetch()
  const { seams } = makeSeams()
  seams.restartApplicationImpl = () => { throw new Error('restart boom') }
  const result = await applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams })
  assert.equal(result.applied, true)
  assert.equal(readState(root).status, 'success')
  assert.match(readState(root).restartError, /restart boom/)
  await rm(root, { recursive: true, force: true })
}

// S8: обновление не требуется — ничего не скачивается и не меняется.
{
  const root = await makeInstallRoot()
  await writeFile(join(root, '.gildra-kit-version'), '0.1.13')
  const { fetchImpl, calls } = makeFetch()
  const { log, seams } = makeSeams()
  const result = await applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams })
  assert.equal(result.applied, false)
  assert.equal(calls.length, 1)
  assert.equal(existsSync(join(root, 'update-state.json')), false)
  assert.equal(log.extracts.length + log.stops + log.installs.length + log.restarts, 0)
  assert.equal(existsSync(join(root, '.gildra-update.lock')), false)
  await rm(root, { recursive: true, force: true })
}

// S9: параллельный updater — второй запуск отклоняется до любых действий.
{
  const root = await makeInstallRoot()
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  try {
    await mkdir(join(root, '.gildra-update.lock'))
    await writeFile(join(root, '.gildra-update.lock', 'meta.json'), JSON.stringify({ pid: holder.pid }))
    const { fetchImpl, calls } = makeFetch()
    const { log, seams } = makeSeams()
    await assert.rejects(
      applyUpdate({ installRoot: root, targetPlatform: 'darwin', fetchImpl, ...seams }),
      /уже выполняется/,
    )
    assert.equal(calls.length, 0)
    assert.equal(existsSync(join(root, 'update-state.json')), false)
    assert.equal(log.extracts.length + log.stops + log.installs.length + log.restarts, 0)
  } finally {
    holder.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
  }
}

console.log('Gildra updater tests passed.')
