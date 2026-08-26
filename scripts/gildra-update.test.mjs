import assert from 'node:assert/strict'
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

console.log('Gildra updater tests passed.')
