// Process Manager: процессы, привязанные к сессии.
//
// Git worktree решает только файлы; dev-серверы и тесты, запущенные сессией,
// регистрируются здесь с реальными PID/PGID. Cleanup сессии завершает ТОЛЬКО
// зарегистрированные за ней процессы — никогда поиском по подстроке командной
// строки или пути (architecture.md 0а.6): такой поиск однажды убьёт чужой
// процесс пользователя, случайно содержащий похожий аргумент. Инвариант
// закреплён тестом, который читает исходник этого файла.
//
// Завершение вынесено в явную абстракцию ProcessBackend (§22, §23): POSIX
// работает с process group (TERM → ожидание → KILL → verify), Windows — через
// taskkill /PID <pid> /T /F. Платформенная разница не спрятана внутри if в
// terminate, а описана двумя объектами с одинаковым контрактом
// (spawnOptions/identify/isAlive/verifyOwnership/terminate) — так ограничение
// Windows видно, документировано и проверяемо тестом.
//
// ОГРАНИЧЕНИЕ Windows (осознанное, MVP): Job Objects здесь не реализуются —
// они требуют нативного addon, а у локальных плагинов инвариант «только
// node:-модули». taskkill /T завершает дерево по СНИМКУ родительских связей:
// процесс, успевший отвязаться от родителя, в снимок не попадёт и переживёт
// cleanup. Это best-effort, а не гарантия — см. docs/runtime-reliability.md,
// «Известные ограничения».

import { execFile, spawn } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'

import { appendAudit } from './audit.js'
import { RuntimeError } from './errors.js'
import { generateId, sanitizeSegment } from './ids.js'

const execFileAsync = promisify(execFile)

const PROCESSES = 'processes'

// Шаг ожидания «процесс уже исчез?». Мелкий, чтобы terminate завершался по
// факту, а не «спал и надеялся»; не нулевой, чтобы не жечь CPU.
const POLL_MS = 25
const DEFAULT_GRACE_MS = 3000
const DEFAULT_KILL_TIMEOUT_MS = 2000
const DEFAULT_MAX_PROCESSES_PER_SESSION = 16
const IDENTITY_TIMEOUT_MS = 2000

// Результат проверки «этот PID всё ещё наш процесс?».
export const PROCESS_OWNERSHIP = Object.freeze({
  OURS: 'OURS',
  GONE: 'GONE',
  FOREIGN: 'FOREIGN',
})

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM = процесс существует, но принадлежит другому пользователю.
    return error?.code === 'EPERM'
  }
}

function groupAlive(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 1) return false
  try {
    process.kill(-pgid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// Ожидание условия с дедлайном: никаких «подождём 100 мс и понадеемся».
async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  for (;;) {
    if (predicate()) return true
    if (Date.now() >= deadline) return false
    await new Promise(resolveTimer => setTimeout(resolveTimer, POLL_MS))
  }
}

// Проверяемый признак идентичности процесса (§2, §22): время старта, каким
// его видит ОС. `ps -o lstart=` есть и в macOS, и в procps-ps (Linux); строку
// («Thu Aug 27 13:59:38 2026») мы НЕ парсим, а сравниваем как непрозрачный
// токен — поэтому локаль и формат неважны. `etimes` намеренно не используется:
// на macOS такого keyword нет. Вызов best-effort: любая ошибка (нет ps, таймаут,
// процесс уже исчез) → undefined, и мы откатываемся на pgid-проверку.
export async function readProcessIdentity(pid, { platform = process.platform, run = execFileAsync } = {}) {
  // Windows: получить StartTime можно только через PowerShell/wmic — отдельный
  // процесс на каждую проверку. Не делаем; ограничение задокументировано ниже.
  if (platform === 'win32') return undefined
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  try {
    const { stdout } = await run('ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: IDENTITY_TIMEOUT_MS })
    const value = String(stdout ?? '').trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

// POSIX-бэкенд: единица завершения — process group, а не одиночный PID.
// Каждый управляемый процесс становится лидером собственной группы (detached),
// поэтому потомки dev-сервера не осиротевают при cleanup.
export function createPosixBackend({ readIdentity = readProcessIdentity } = {}) {
  function groupIdOf(record) {
    const raw = Number.isInteger(record?.pgid) ? record.pgid : record?.pid
    return Number.isInteger(raw) ? raw : undefined
  }

  function isAlive(record) {
    if (pidAlive(record?.pid)) return true
    // Лидер группы мог умереть, оставив в группе своих детей. Для нас процесс
    // жив, пока жива группа: иначе осиротевший dev-сервер выпал бы из реестра
    // и остался бы висеть навсегда.
    return groupAlive(groupIdOf(record))
  }

  async function verifyOwnership(record, { trustedOurs } = {}) {
    const groupId = groupIdOf(record)
    // Самозащита: сигнал в собственную группу убил бы сам Runtime вместе с
    // Harness. Такая запись может появиться только из повреждённого state —
    // трактуем её как чужую и не трогаем.
    if (groupId === undefined || groupId <= 1 || groupId === process.pid) return PROCESS_OWNERSHIP.FOREIGN
    if (!isAlive(record)) return PROCESS_OWNERSHIP.GONE
    // Открытый ChildProcess-хендл — сильнейшее доказательство: пока процесс не
    // reaped, ОС не может переиспользовать его PID.
    if (trustedOurs === true) return PROCESS_OWNERSHIP.OURS
    if (pidAlive(record.pid) && typeof record.identity === 'string') {
      const current = await readIdentity(record.pid)
      // Токен читается — сравниваем. Не читается (нет ps/нет прав) — не
      // выдумываем вердикт и идём дальше по pgid-проверке.
      if (typeof current === 'string' && current !== record.identity) return PROCESS_OWNERSHIP.FOREIGN
    }
    return PROCESS_OWNERSHIP.OURS
  }

  function signalGroup(groupId, signal) {
    try {
      process.kill(-groupId, signal)
      return true
    } catch {
      // ESRCH: группа исчезла между проверкой и сигналом — это успех, а не сбой.
      return false
    }
  }

  async function terminate(record, { graceMs = DEFAULT_GRACE_MS, killTimeoutMs = DEFAULT_KILL_TIMEOUT_MS, trustedOurs } = {}) {
    const ownership = await verifyOwnership(record, { trustedOurs })
    if (ownership !== PROCESS_OWNERSHIP.OURS) {
      return {
        backend: 'posix',
        ownership,
        alive: ownership === PROCESS_OWNERSHIP.FOREIGN,
        signalled: false,
        escalated: false,
        ok: ownership === PROCESS_OWNERSHIP.GONE,
      }
    }
    const groupId = groupIdOf(record)
    // Жизненный цикл (§22): TERM группы → ожидание → KILL группы → verify.
    const signalled = signalGroup(groupId, 'SIGTERM')
    let dead = await waitUntil(() => !isAlive(record), graceMs)
    let escalated = false
    if (!dead) {
      escalated = true
      signalGroup(groupId, 'SIGKILL')
      dead = await waitUntil(() => !isAlive(record), killTimeoutMs)
    }
    return { backend: 'posix', ownership, alive: !dead, signalled, escalated, ok: dead }
  }

  return {
    name: 'posix',
    supportsProcessGroups: true,
    // detached делает процесс лидером собственной группы — иначе завершать
    // было бы нечего, кроме одиночного PID.
    spawnOptions: () => ({ detached: true }),
    identify: async child => ({ pgid: child.pid, identity: await readIdentity(child.pid) }),
    isAlive,
    verifyOwnership,
    terminate,
  }
}

// Windows-бэкенд: process group в POSIX-смысле нет, Job Objects недоступны без
// нативного addon (инвариант «только node:-модули»), поэтому единственный
// доступный инструмент — taskkill /T по снимку дерева процессов.
export function createWindowsBackend({ run = execFileAsync } = {}) {
  function isAlive(record) {
    return pidAlive(record?.pid)
  }

  async function verifyOwnership(record, { trustedOurs } = {}) {
    if (!Number.isInteger(record?.pid) || record.pid <= 1 || record.pid === process.pid) return PROCESS_OWNERSHIP.FOREIGN
    if (!isAlive(record)) return PROCESS_OWNERSHIP.GONE
    if (trustedOurs === true) return PROCESS_OWNERSHIP.OURS
    // ОСТАТОЧНЫЙ РИСК (документирован): вне процесса-родителя PID reuse на
    // Windows не проверяется — время старта достаётся только через
    // PowerShell/wmic, то есть отдельным процессом на каждую проверку. Окно
    // риска — между смертью процесса и ближайшим cleanup; внутри Runtime,
    // который его порождал, защищает удержанный ChildProcess-хендл.
    return PROCESS_OWNERSHIP.OURS
  }

  async function terminate(record, { killTimeoutMs = DEFAULT_KILL_TIMEOUT_MS, trustedOurs } = {}) {
    const ownership = await verifyOwnership(record, { trustedOurs })
    if (ownership !== PROCESS_OWNERSHIP.OURS) {
      return {
        backend: 'windows',
        ownership,
        alive: ownership === PROCESS_OWNERSHIP.FOREIGN,
        signalled: false,
        escalated: false,
        ok: ownership === PROCESS_OWNERSHIP.GONE,
      }
    }
    // Graceful-фазы нет: taskkill без /F просит закрыться только оконные
    // приложения, консольный dev-сервер отвечает «can only be terminated
    // forcefully». Поэтому сразу /T /F, а verify мы делаем сами.
    let signalled = true
    try {
      await run('taskkill', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true })
    } catch {
      // Ненулевой код = процесс уже исчез либо недоступен; решает verify ниже.
      signalled = false
    }
    const dead = await waitUntil(() => !isAlive(record), killTimeoutMs)
    return { backend: 'windows', ownership, alive: !dead, signalled, escalated: true, ok: dead }
  }

  return {
    name: 'windows',
    supportsProcessGroups: false,
    spawnOptions: () => ({ detached: false }),
    // Ни pgid, ни проверяемого identity-токена на Windows нет — см. выше.
    identify: async () => ({ pgid: undefined, identity: undefined }),
    isAlive,
    verifyOwnership,
    terminate,
  }
}

export function createProcessBackend({ platform = process.platform } = {}) {
  return platform === 'win32' ? createWindowsBackend() : createPosixBackend()
}

function positiveInt(raw, fallback) {
  const value = Number(raw)
  // Пусто/ноль/отрицательное/дробное/NaN не должны молча отключать лимит —
  // падаем в дефолт.
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function createProcessManager({ store, roots, env = process.env, backend = createProcessBackend() }) {
  const maxProcessesPerSession = positiveInt(env.GILDRA_DSH_MAX_PROCESSES_PER_SESSION, DEFAULT_MAX_PROCESSES_PER_SESSION)
  // Живые ChildProcess-хендлы ЭТОГО Runtime. Пока хендл открыт (процесс не
  // reaped), ОС не может переиспользовать его PID — самая надёжная защита от
  // PID reuse. Действует только внутри процесса, который порождал; после
  // рестарта Runtime остаётся identity-токен + проверка группы.
  const children = new Map()

  // Имя лока — сегмент store, поэтому санитизируем и подрезаем длину.
  function sessionLock(sessionId) {
    return `procs-${sanitizeSegment(sessionId, 'session').slice(0, 50)}`
  }

  // `aliveOnly` сохранён в сигнатуре ради вызывающих (workspaces.js), но
  // подразумевается всегда: запись без живого процесса — мусор после краха
  // Runtime, отдавать её наружу незачем.
  async function listForSession(sessionId, { aliveOnly = false } = {}) {
    const rows = []
    for (const id of await store.list(PROCESSES)) {
      const record = await store.read(PROCESSES, id)
      if (!record || record.sessionId !== sessionId) continue
      if (!backend.isAlive(record)) {
        // Запись пережила процесс (крах Runtime): выпалываем на чтении.
        await store.delete(PROCESSES, id).catch(() => {})
        continue
      }
      rows.push(record)
    }
    return rows
  }

  async function spawnInSession({ sessionId, workspaceId, cwd, env: childEnv, role = 'task' }, command, args = []) {
    // Лимит (§35) проверяется под локом сессии: два параллельных spawn иначе
    // прошли бы проверку одновременно и вместе перевалили бы за лимит.
    return store.withLock(sessionLock(sessionId), async () => {
      const running = await listForSession(sessionId)
      if (running.length >= maxProcessesPerSession) {
        throw new RuntimeError(
          'LIMIT_EXCEEDED',
          `Сессия уже держит ${String(running.length)} процессов при лимите ${String(maxProcessesPerSession)} (GILDRA_DSH_MAX_PROCESSES_PER_SESSION). Завершите лишние.`,
          { sessionId, limit: maxProcessesPerSession, running: running.length },
        )
      }
      const procId = generateId('proc')
      const child = spawn(command, args, {
        cwd,
        env: childEnv,
        stdio: 'ignore',
        windowsHide: true,
        ...backend.spawnOptions(),
      })
      child.unref()
      // Обработчик вешаем сразу после spawn: короткоживущий процесс успел бы
      // выстрелить 'exit' до того, как мы допишем запись, и запись осталась бы
      // сиротой.
      let exited = false
      child.once('exit', () => {
        exited = true
        children.delete(procId)
        void store.delete(PROCESSES, procId).catch(() => {})
      })
      if (!Number.isInteger(child.pid)) {
        // Ошибка запуска придёт событием error; регистрировать нечего.
        await new Promise((resolveSpawn, rejectSpawn) => {
          child.once('error', rejectSpawn)
          child.once('spawn', resolveSpawn)
        })
      }
      const identity = await backend.identify(child)
      const record = {
        schemaVersion: 1,
        procId,
        sessionId,
        workspaceId,
        pid: child.pid,
        pgid: identity.pgid,
        // startedAt — НАШ момент spawn, он не доказывает идентичность процесса
        // (после PID reuse время осталось бы тем же). Доказательство — identity:
        // время старта глазами ОС; на Windows его нет (см. бэкенд).
        identity: identity.identity,
        spawnerPid: process.pid,
        // Только имя команды и роль: аргументы могут содержать чувствительные
        // значения и в state/audit не пишутся.
        command: basename(command),
        role,
        cwd,
        startedAt: new Date().toISOString(),
      }
      await store.write(PROCESSES, procId, record)
      children.set(procId, child)
      if (exited) {
        // Процесс умер, пока мы читали identity и писали запись, — 'exit' уже
        // отработал вхолостую, убираем запись сами.
        children.delete(procId)
        await store.delete(PROCESSES, procId).catch(() => {})
      }
      await appendAudit(roots.stateRoot, 'process.started', { procId, sessionId, pid: child.pid, command: record.command, role })
      return { procId, pid: child.pid, child }
    }, { timeoutMs: 15_000 })
  }

  // Завершает ОДИН зарегистрированный процесс и возвращает структурный
  // результат: жив ли он после verify, был ли эскалирован KILL, чей PID.
  async function terminate(record, options = {}) {
    const handle = children.get(record?.procId)
    const trustedOurs = handle ? handle.exitCode === null && handle.signalCode === null : undefined
    const outcome = await backend.terminate(record, { ...options, trustedOurs })
    const result = { procId: record?.procId, pid: record?.pid, ...outcome }
    await appendAudit(roots.stateRoot, 'process.terminated', {
      procId: result.procId,
      sessionId: record?.sessionId,
      pid: result.pid,
      command: record?.command,
      ownership: result.ownership,
      alive: result.alive,
      escalated: result.escalated,
    })
    return result
  }

  // Завершает процессы РОВНО одной сессии; соседние сессии не затрагиваются
  // по построению — выбор идёт по зарегистрированным записям, а не по поиску.
  //
  // Лок сессии здесь намеренно НЕ берётся: терминирование N процессов длится
  // секунды, и удержание лока превратило бы параллельный spawn в WORKSPACE_BUSY
  // вместо осмысленного ответа. Остаточная гонка (spawn ровно во время
  // cleanup) не опасна: новый процесс просто не попадёт в этот список, а
  // cleanup workspace увидит его как LIVE_PROCESSES и остановится.
  async function killSessionProcesses(sessionId, options = {}) {
    const records = await listForSession(sessionId)
    const results = []
    let terminated = 0
    let survived = 0
    let skipped = 0
    for (const record of records) {
      const result = await terminate(record, options)
      results.push(result)
      if (result.ownership === PROCESS_OWNERSHIP.FOREIGN) {
        // На нашем PID уже чужой процесс: убивать его нельзя ни при каких
        // условиях, устаревшую запись просто выбрасываем.
        skipped += 1
        await store.delete(PROCESSES, record.procId).catch(() => {})
        continue
      }
      if (result.alive) {
        // Процесс пережил KILL (uninterruptible sleep и т.п.): запись НЕ
        // удаляем — иначе Runtime потеряет его из виду, а cleanup workspace
        // обязан получить LIVE_PROCESSES, а не «всё чисто».
        survived += 1
        continue
      }
      terminated += 1
      await store.delete(PROCESSES, record.procId).catch(() => {})
    }
    return { terminated, survived, skipped, results }
  }

  return {
    spawnInSession,
    listForSession,
    killSessionProcesses,
    terminate,
    backend,
    limits: Object.freeze({ maxProcessesPerSession }),
  }
}
