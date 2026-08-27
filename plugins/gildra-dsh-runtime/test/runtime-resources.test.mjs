// Тесты ресурсного слоя Runtime: процессы сессии (§22, §23, §35) и порты
// (§24, §25). Все процессы и порты здесь настоящие — mock'ов нет, потому что
// проверяемые инварианты («сосед не убит», «группа умерла целиком», «занятый
// порт не переиспользован») существуют только на уровне ОС.
//
// Детерминизм: ни одного «поспим и понадеемся» — ожидание всегда через
// waitFor() с дедлайном, а terminate сам verify'ит смерть процесса.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { JsonStore } from '../lib/store.js'
import { runtimeRoots } from '../lib/paths.js'
import {
  PROCESS_OWNERSHIP,
  createProcessBackend,
  createProcessManager,
  readProcessIdentity,
} from '../lib/processes.js'
import { createPortAllocator, probePortFree } from '../lib/ports.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const IDLE = 'setInterval(() => {}, 1000)'
const POSIX = process.platform !== 'win32'

// Каталог с пробелом в имени — тот же инвариант, что и в остальных тестах
// Runtime: пути с пробелами не должны ломать spawn.
const base = await mkdtemp(join(tmpdir(), 'gildra res '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// Ожидание условия с дедлайном вместо фиксированной паузы.
async function waitFor(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    assert.ok(Date.now() < deadline, `не дождались условия: ${label}`)
    await new Promise(resolveTimer => setTimeout(resolveTimer, 20))
  }
}

// Тестовые диапазоны портов подбираются на живой машине: жёсткие номера
// сделали бы тест флаки на любом хосте, где такой порт уже занят.
async function pickFreeRange(from, size) {
  for (let start = from; start + size <= 65_000; start += size) {
    let allFree = true
    for (let port = start; port < start + size; port += 1) {
      if (!(await probePortFree(port))) {
        allFree = false
        break
      }
    }
    if (allFree) return start
  }
  return assert.fail(`не нашли свободного диапазона из ${String(size)} портов начиная с ${String(from)}`)
}

async function listenOn(port) {
  const server = createServer()
  await new Promise(resolveListen => server.listen({ port, host: '127.0.0.1' }, resolveListen))
  return () => new Promise(resolveClose => server.close(resolveClose))
}

function portLease({ port, sessionId, pid, name = 'app' }) {
  return {
    schemaVersion: 1,
    id: `port-${String(port)}`,
    port,
    name,
    sessionId,
    pid,
    acquiredAt: new Date().toISOString(),
  }
}

async function deadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const pid = child.pid
  await new Promise(resolveExit => child.on('exit', resolveExit))
  return pid
}

const processes = createProcessManager({ store, roots, env: {} })

// --- Бэкенд завершения выбран по платформе --------------------------------
{
  const posix = createProcessBackend({ platform: 'linux' })
  const windows = createProcessBackend({ platform: 'win32' })
  assert.equal(posix.name, 'posix')
  assert.equal(posix.supportsProcessGroups, true)
  assert.equal(posix.spawnOptions().detached, true, 'POSIX-процесс становится лидером своей группы')
  assert.equal(windows.name, 'windows')
  assert.equal(windows.supportsProcessGroups, false, 'на Windows process group нет — ограничение явное, а не скрытое')
  assert.equal(windows.spawnOptions().detached, false)
  assert.deepEqual(await windows.identify({ pid: 1234 }), { pgid: undefined, identity: undefined })
  assert.equal(createProcessBackend().name, POSIX ? 'posix' : 'windows')
}

// --- Ключевой инвариант: cleanup сессии A не трогает сессию B --------------
{
  const context = sessionId => ({ sessionId, workspaceId: `w-${sessionId}`, cwd: base, env: process.env, role: 'dev-server' })
  const procA = await processes.spawnInSession(context('sess-a'), process.execPath, ['-e', IDLE])
  const procB = await processes.spawnInSession(context('sess-b'), process.execPath, ['-e', IDLE])
  assert.equal(alive(procA.pid), true)
  assert.equal(alive(procB.pid), true)
  assert.notEqual(procA.pid, procB.pid)
  assert.equal((await processes.listForSession('sess-a')).length, 1)
  assert.equal((await processes.listForSession('sess-b')).length, 1)

  const killed = await processes.killSessionProcesses('sess-a')
  assert.deepEqual(
    { terminated: killed.terminated, survived: killed.survived, skipped: killed.skipped },
    { terminated: 1, survived: 0, skipped: 0 },
    'структурный результат killSessionProcesses',
  )
  assert.equal(killed.results[0].ownership, PROCESS_OWNERSHIP.OURS)
  assert.equal(killed.results[0].alive, false, 'terminate verify\'ит, что процесса действительно нет')
  assert.equal(killed.results[0].pid, procA.pid)
  // terminate уже дождался исчезновения процесса — проверяем без ожиданий.
  assert.equal(alive(procA.pid), false, 'процесс сессии A завершён')
  assert.equal(alive(procB.pid), true, 'процесс соседней сессии B остался жив')
  assert.equal((await processes.listForSession('sess-a')).length, 0, 'запись завершённого процесса удалена')
  assert.equal((await processes.listForSession('sess-b')).length, 1, 'реестр соседа не тронут')

  await processes.killSessionProcesses('sess-b')
  assert.equal(alive(procB.pid), false)
}

// --- Жизненный цикл TERM → ожидание → KILL → verify ------------------------
{
  // Процесс, глушащий SIGTERM: единственный способ детерминированно проверить
  // эскалацию до SIGKILL. Обработчик ставится ДО файла готовности, иначе TERM
  // мог бы прийти в окно между запуском и установкой обработчика.
  const readyFile = join(base, 'stubborn.ready')
  const stubborn = [
    "process.on('SIGTERM', () => {})",
    "require('node:fs').writeFileSync(process.env.GILDRA_TEST_READY, 'ok')",
    'setInterval(() => {}, 1000)',
  ].join('\n')
  const proc = await processes.spawnInSession(
    { sessionId: 'sess-stubborn', workspaceId: 'w-s', cwd: base, env: { ...process.env, GILDRA_TEST_READY: readyFile }, role: 'dev-server' },
    process.execPath,
    ['-e', stubborn],
  )
  await waitFor(() => existsSync(readyFile), 'процесс установил обработчик SIGTERM')

  const record = (await processes.listForSession('sess-stubborn'))[0]
  const result = await processes.terminate(record, { graceMs: 300, killTimeoutMs: 5000 })
  assert.equal(result.ownership, PROCESS_OWNERSHIP.OURS)
  assert.equal(result.signalled, true, 'SIGTERM отправлен')
  if (POSIX) assert.equal(result.escalated, true, 'процесс пережил SIGTERM → эскалация до SIGKILL')
  assert.equal(result.alive, false, 'после verify процесса действительно нет')
  assert.equal(result.ok, true)
  assert.equal(result.pid, proc.pid)
  assert.equal(alive(proc.pid), false)
  await processes.killSessionProcesses('sess-stubborn')
}

// --- POSIX: завершение группы убивает и потомка ---------------------------
if (POSIX) {
  // Guard по платформе: на Windows process group нет, а taskkill /T работает
  // по СНИМКУ дерева — отвязавшийся потомок его переживёт. Это ограничение
  // задокументировано в processes.js и docs/runtime-reliability.md, поэтому
  // требовать здесь тот же инвариант нельзя.
  const pidFile = join(base, 'grandchild.pid')
  const spawner = [
    "const { spawn } = require('node:child_process')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    "require('node:fs').writeFileSync(process.env.GILDRA_TEST_PIDFILE, String(child.pid))",
    'setInterval(() => {}, 1000)',
  ].join('\n')
  const parent = await processes.spawnInSession(
    { sessionId: 'sess-tree', workspaceId: 'w-t', cwd: base, env: { ...process.env, GILDRA_TEST_PIDFILE: pidFile }, role: 'dev-server' },
    process.execPath,
    ['-e', spawner],
  )
  await waitFor(() => existsSync(pidFile), 'родитель записал PID потомка')
  const grandchild = Number((await readFile(pidFile, 'utf8')).trim())
  assert.ok(Number.isInteger(grandchild) && grandchild > 0, 'PID потомка прочитан')
  await waitFor(() => alive(grandchild), 'потомок запустился')

  const killed = await processes.killSessionProcesses('sess-tree')
  assert.equal(killed.terminated, 1)
  assert.equal(alive(parent.pid), false, 'родитель завершён')
  assert.equal(alive(grandchild), false, 'завершение process group убило и потомка, а не осиротило его')
}

// --- Защита от PID reuse ---------------------------------------------------
{
  // Мёртвый PID: terminate не бросает и честно сообщает GONE, никого не сигналя.
  const gonePid = await deadPid()
  const gone = await processes.terminate({ procId: 'proc-gone', sessionId: 'sess-gone', pid: gonePid, pgid: gonePid })
  assert.equal(gone.ownership, PROCESS_OWNERSHIP.GONE)
  assert.equal(gone.alive, false)
  assert.equal(gone.signalled, false, 'мёртвому процессу сигналы не шлются')
  assert.equal(gone.ok, true)

  const backend = createProcessBackend()
  // Самозащита: запись, указывающая на нас самих, считается чужой — сигнал в
  // собственную группу убил бы Runtime вместе с Harness.
  assert.equal(
    await backend.verifyOwnership({ pid: process.pid, pgid: process.pid }),
    PROCESS_OWNERSHIP.FOREIGN,
    'Runtime никогда не сигналит собственную группу',
  )
  assert.equal(await backend.verifyOwnership({ pid: 1, pgid: 1 }), PROCESS_OWNERSHIP.FOREIGN)
  assert.equal(await backend.verifyOwnership({}), PROCESS_OWNERSHIP.FOREIGN)
}

if (POSIX) {
  const proc = await processes.spawnInSession(
    { sessionId: 'sess-identity', workspaceId: 'w-i', cwd: base, env: process.env, role: 'dev-server' },
    process.execPath,
    ['-e', IDLE],
  )
  const record = (await processes.listForSession('sess-identity'))[0]
  const identityAvailable = typeof (await readProcessIdentity(proc.pid)) === 'string'
  if (identityAvailable) {
    assert.equal(typeof record.identity, 'string', 'при spawn зафиксировано время старта процесса глазами ОС')
    // Так выглядит PID reuse после краха Runtime: PID тот же, а процесс уже
    // чужой. Берём «чистый» бэкенд, а не менеджер: у менеджера остался
    // открытый ChildProcess-хендл, который сам по себе доказывает владение.
    const forged = { ...record, identity: 'Thu Jan  1 00:00:00 1970' }
    const backend = createProcessBackend()
    assert.equal(await backend.verifyOwnership(forged), PROCESS_OWNERSHIP.FOREIGN)
    const refused = await backend.terminate(forged, { graceMs: 100, killTimeoutMs: 100 })
    assert.equal(refused.ownership, PROCESS_OWNERSHIP.FOREIGN)
    assert.equal(refused.signalled, false, 'чужому процессу не отправлено ни одного сигнала')
    assert.equal(alive(proc.pid), true, 'процесс с несовпавшим identity остался жив')

    // А менеджер, породивший процесс, держит открытый хендл: PID заведомо не
    // переиспользован, поэтому подделанный токен не мешает ему убрать своё.
    const forcedRecord = { ...record, identity: 'Thu Jan  1 00:00:00 1970' }
    const forced = await processes.terminate(forcedRecord)
    assert.equal(forced.ownership, PROCESS_OWNERSHIP.OURS, 'открытый ChildProcess-хендл доказывает владение PID')
    assert.equal(forced.alive, false)
  }
  await processes.killSessionProcesses('sess-identity')
  assert.equal(alive(proc.pid), false)
}

// --- Лимит процессов на сессию (§35) --------------------------------------
{
  assert.equal(createProcessManager({ store, roots, env: {} }).limits.maxProcessesPerSession, 16, 'разумный дефолт лимита')
  for (const raw of ['nope', '0', '-3', '2.5', '']) {
    assert.equal(
      createProcessManager({ store, roots, env: { GILDRA_DSH_MAX_PROCESSES_PER_SESSION: raw } }).limits.maxProcessesPerSession,
      16,
      `невалидное значение «${raw}» не отключает лимит`,
    )
  }

  const limitStore = new JsonStore(join(base, 'limit-state'))
  await limitStore.ensureRoot()
  const limited = createProcessManager({ store: limitStore, roots, env: { GILDRA_DSH_MAX_PROCESSES_PER_SESSION: '2' } })
  assert.equal(limited.limits.maxProcessesPerSession, 2)
  const context = sessionId => ({ sessionId, workspaceId: `w-${sessionId}`, cwd: base, env: process.env, role: 'task' })

  await limited.spawnInSession(context('sess-lim'), process.execPath, ['-e', IDLE])
  await limited.spawnInSession(context('sess-lim'), process.execPath, ['-e', IDLE])
  await assert.rejects(
    limited.spawnInSession(context('sess-lim'), process.execPath, ['-e', IDLE]),
    (error) => error.code === 'LIMIT_EXCEEDED' && error.status === 429,
    'превышение лимита процессов — структурный LIMIT_EXCEEDED',
  )
  // Лимит именно на сессию: соседняя сессия по-прежнему может запуститься.
  await limited.spawnInSession(context('sess-lim-2'), process.execPath, ['-e', IDLE])

  // Параллельные spawn не проскакивают мимо лимита (проверка идёт под локом).
  const outcomes = await Promise.allSettled(
    Array.from({ length: 4 }, () => limited.spawnInSession(context('sess-lim-3'), process.execPath, ['-e', IDLE])),
  )
  assert.equal(outcomes.filter(entry => entry.status === 'fulfilled').length, 2, 'конкурентные spawn ограничены тем же лимитом')
  for (const entry of outcomes.filter(item => item.status === 'rejected')) {
    assert.equal(entry.reason.code, 'LIMIT_EXCEEDED')
  }

  for (const sessionId of ['sess-lim', 'sess-lim-2', 'sess-lim-3']) {
    const killed = await limited.killSessionProcesses(sessionId)
    assert.equal(killed.survived, 0, `все процессы сессии ${sessionId} завершены`)
  }
}

// --- Порты: диапазон, уникальность, занятый порт --------------------------
{
  for (const raw of ['nonsense', '31999-31000', '10-20', '31000-99999', '', '31000']) {
    assert.deepEqual(
      createPortAllocator({ store, env: { GILDRA_DSH_PORT_RANGE: raw } }).range,
      { from: 31000, to: 31999 },
      `невалидный диапазон «${raw}» падает в дефолт`,
    )
  }
  assert.deepEqual(createPortAllocator({ store, env: { GILDRA_DSH_PORT_RANGE: '31500-31510' } }).range, { from: 31500, to: 31510 })

  const portStore = new JsonStore(join(base, 'ports-state'))
  await portStore.ensureRoot()
  const start = await pickFreeRange(31600, 8)
  const allocator = createPortAllocator({ store: portStore, env: { GILDRA_DSH_PORT_RANGE: `${String(start)}-${String(start + 7)}` } })
  const closeBusy = await listenOn(start)
  const allocated = await Promise.all(Array.from({ length: 5 }, (_, index) => allocator.allocate({ sessionId: `sess-p${String(index)}` })))
  const numbers = allocated.map(record => record.port)
  assert.equal(new Set(numbers).size, 5, 'конкурентные allocate выдают уникальные порты')
  assert.equal(numbers.includes(start), false, 'реально забинденный порт пропущен')
  for (const port of numbers) assert.ok(port >= start && port <= start + 7, 'порт из настроенного диапазона')
  await closeBusy()
}

// --- Порты: исчерпание пула → PORT_POOL_EXHAUSTED -------------------------
{
  const tinyStore = new JsonStore(join(base, 'ports-tiny'))
  await tinyStore.ensureRoot()
  const start = await pickFreeRange(31700, 2)
  const tiny = createPortAllocator({ store: tinyStore, env: { GILDRA_DSH_PORT_RANGE: `${String(start)}-${String(start + 1)}` } })
  await tiny.allocate({ sessionId: 'sess-t1' })
  await tiny.allocate({ sessionId: 'sess-t2' })
  await assert.rejects(
    tiny.allocate({ sessionId: 'sess-t3' }),
    (error) => error.code === 'PORT_POOL_EXHAUSTED' && error.status === 503 && error.details.heldByLive === 2,
    'исчерпание диапазона — это PORT_POOL_EXHAUSTED, а не PORT_UNAVAILABLE',
  )
}

// --- Порты: конкретный запрошенный порт → PORT_UNAVAILABLE ----------------
{
  const requestStore = new JsonStore(join(base, 'ports-request'))
  await requestStore.ensureRoot()
  const start = await pickFreeRange(31740, 3)
  const allocator = createPortAllocator({ store: requestStore, env: { GILDRA_DSH_PORT_RANGE: `${String(start)}-${String(start + 2)}` } })
  const closeBusy = await listenOn(start)
  await assert.rejects(
    allocator.allocate({ sessionId: 'sess-req', port: start }),
    (error) => error.code === 'PORT_UNAVAILABLE' && error.details.listening === true,
    'занятый конкретный порт — PORT_UNAVAILABLE',
  )
  await assert.rejects(
    allocator.allocate({ sessionId: 'sess-req', port: 80 }),
    (error) => error.code === 'PORT_UNAVAILABLE',
    'порт вне диапазона — тоже PORT_UNAVAILABLE',
  )
  const granted = await allocator.allocate({ sessionId: 'sess-req', port: start + 1 })
  assert.equal(granted.port, start + 1, 'свободный запрошенный порт выдаётся')
  await closeBusy()
}

// --- Порты: лимит на сессию ------------------------------------------------
{
  const cappedStore = new JsonStore(join(base, 'ports-capped'))
  await cappedStore.ensureRoot()
  const start = await pickFreeRange(31780, 6)
  const capped = createPortAllocator({
    store: cappedStore,
    env: { GILDRA_DSH_PORT_RANGE: `${String(start)}-${String(start + 5)}`, GILDRA_DSH_MAX_PORTS_PER_SESSION: '2' },
  })
  assert.equal(capped.limits.maxPortsPerSession, 2)
  assert.equal(createPortAllocator({ store, env: {} }).limits.maxPortsPerSession, 8, 'разумный дефолт лимита портов')
  assert.equal(createPortAllocator({ store, env: { GILDRA_DSH_MAX_PORTS_PER_SESSION: 'nope' } }).limits.maxPortsPerSession, 8)

  await capped.allocate({ sessionId: 'sess-cap', name: 'app' })
  await capped.allocate({ sessionId: 'sess-cap', name: 'debug' })
  await assert.rejects(
    capped.allocate({ sessionId: 'sess-cap', name: 'extra' }),
    (error) => error.code === 'LIMIT_EXCEEDED' && error.status === 429,
    'превышение лимита портов сессии — структурный LIMIT_EXCEEDED',
  )
  const neighbour = await capped.allocate({ sessionId: 'sess-cap-2' })
  assert.ok(Number.isInteger(neighbour.port), 'лимит считается на сессию, а не на весь пул')
}

// --- Порты: reclaimStale ---------------------------------------------------
{
  const staleStore = new JsonStore(join(base, 'ports-stale'))
  await staleStore.ensureRoot()
  const start = await pickFreeRange(31820, 4)
  const allocator = createPortAllocator({ store: staleStore, env: { GILDRA_DSH_PORT_RANGE: `${String(start)}-${String(start + 3)}` } })
  const orphanPid = await deadPid()
  const closeListener = await listenOn(start + 1)

  await staleStore.write('ports', `port-${String(start)}`, portLease({ port: start, sessionId: 'sess-dead-free', pid: orphanPid }))
  await staleStore.write('ports', `port-${String(start + 1)}`, portLease({ port: start + 1, sessionId: 'sess-dead-busy', pid: orphanPid }))
  await staleStore.write('ports', `port-${String(start + 2)}`, portLease({ port: start + 2, sessionId: 'sess-live', pid: process.pid }))

  const report = await allocator.reclaimStale()
  assert.deepEqual(report.reclaimed.map(entry => entry.port), [start], 'освобождён только порт мёртвой сессии, который реально свободен')
  const reasons = new Map(report.retained.map(entry => [entry.port, entry.reason]))
  assert.equal(reasons.get(start + 1), 'PORT_IN_USE', 'реально слушаемый порт не освобождается, даже если его сессия мертва')
  assert.equal(reasons.get(start + 2), 'SESSION_ALIVE', 'порт живой сессии не трогаем')
  assert.equal(await staleStore.read('ports', `port-${String(start)}`), undefined)
  assert.ok(await staleStore.read('ports', `port-${String(start + 1)}`), 'lease занятого порта остался на месте')

  // И сам allocate не отдаст порт, который реально слушается, даже с мёртвым lease.
  const first = await allocator.allocate({ sessionId: 'sess-after' })
  assert.equal(first.port, start, 'возвращённый в пул порт переиспользуется')
  const second = await allocator.allocate({ sessionId: 'sess-after-2' })
  assert.equal(second.port, start + 3, 'занятый порт и порт живой сессии пропущены')
  await closeListener()
}

// --- Инвариант: никакого поиска процессов по подстроке ---------------------
{
  const source = await readFile(join(HERE, '..', 'lib', 'processes.js'), 'utf8')
  const forbidden = [
    [/pkill/i, 'pkill (поиск процессов по подстроке командной строки)'],
    [/killall/i, 'killall (завершение по имени процесса)'],
    [/CommandLine/i, 'WMI/PowerShell-запрос CommandLine'],
    [/Get-Process/i, 'PowerShell Get-Process по имени'],
    [/taskkill[^\n]*\/IM/i, 'taskkill /IM (по имени образа вместо PID)'],
    [/\bps\s+(aux|-ef)\b/i, 'сканирование таблицы процессов (ps aux / ps -ef)'],
    [/\blike\s*'%/i, 'WQL LIKE «%…%» по командной строке'],
    [/\bgrep\b/i, 'grep по списку процессов'],
    [/\bexec\s*\(/, 'exec() с shell-строкой'],
  ]
  for (const [pattern, what] of forbidden) {
    assert.equal(pattern.test(source), false, `processes.js не должен содержать ${what}`)
  }
  // Положительная сторона инварианта: адресация только по PID/PGID.
  assert.match(source, /process\.kill\(-/, 'POSIX-завершение адресуется process group')
  assert.match(source, /'\/PID'/, 'Windows-завершение адресуется по PID')
  assert.match(source, /'-p', String\(pid\)/, 'идентичность читается по конкретному PID')
  assert.match(source, /SIGTERM/, 'есть фаза graceful-завершения')
  assert.match(source, /SIGKILL/, 'есть фаза принудительного завершения')
  assert.match(source, /groupId === process\.pid/, 'есть защита от сигнала в собственную группу')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime process/port resource tests passed.')
