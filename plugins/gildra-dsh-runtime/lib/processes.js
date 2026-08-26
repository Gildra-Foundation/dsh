// Process Manager: процессы, привязанные к сессии.
//
// Git worktree решает только файлы; dev-серверы и тесты, запущенные сессией,
// регистрируются здесь с реальными PID/PGID. Cleanup сессии завершает ТОЛЬКО
// зарегистрированные за ней процессы — никогда по substring-поиску пути
// (architecture.md 0а.6). На POSIX каждый управляемый процесс становится
// лидером собственной process group (detached), и завершение идёт по группе —
// потомки dev-сервера не осиротевают. На Windows — taskkill /T как
// best-effort-аналог Job Objects (задокументированное MVP-ограничение).

import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { generateId } from './ids.js'
import { appendAudit } from './audit.js'

const execFileAsync = promisify(execFile)
const PROCESSES = 'processes'

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function createProcessManager({ store, roots }) {
  async function spawnInSession({ sessionId, workspaceId, cwd, env, role = 'task' }, command, args = []) {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'ignore',
      windowsHide: true,
      // POSIX: собственная process group, чтобы cleanup убивал всё дерево.
      detached: process.platform !== 'win32',
    })
    child.unref()
    if (!Number.isInteger(child.pid)) {
      // Ошибка запуска придёт событием error; регистрировать нечего.
      await new Promise((resolveSpawn, rejectSpawn) => {
        child.once('error', rejectSpawn)
        child.once('spawn', resolveSpawn)
      })
    }
    const procId = generateId('proc')
    const record = {
      schemaVersion: 1,
      procId,
      sessionId,
      workspaceId,
      pid: child.pid,
      pgid: process.platform !== 'win32' ? child.pid : undefined,
      // Только имя команды и роль: аргументы могут содержать чувствительные
      // значения и в state/audit не пишутся.
      command: basename(command),
      role,
      cwd,
      startedAt: new Date().toISOString(),
    }
    await store.write(PROCESSES, procId, record)
    await appendAudit(roots.stateRoot, 'process.started', { procId, sessionId, pid: child.pid, command: record.command, role })
    // Самоочистка записи при штатном завершении процесса в этом же процессе
    // Runtime; после краха Runtime мёртвые записи выпалывает listForSession.
    child.once('exit', () => {
      void store.delete(PROCESSES, procId).catch(() => {})
    })
    return { procId, pid: child.pid, child }
  }

  async function listForSession(sessionId, { aliveOnly = false } = {}) {
    const rows = []
    for (const id of await store.list(PROCESSES)) {
      const record = await store.read(PROCESSES, id)
      if (!record || record.sessionId !== sessionId) continue
      const alive = processAlive(record.pid)
      if (!alive) {
        // Запись пережила процесс (крах Runtime): выпалываем на чтении.
        await store.delete(PROCESSES, id).catch(() => {})
        continue
      }
      if (aliveOnly && !alive) continue
      rows.push(record)
    }
    return rows
  }

  async function terminate(record, { graceMs = 3000 } = {}) {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
      return
    }
    const target = -(record.pgid ?? record.pid)
    try {
      process.kill(target, 'SIGTERM')
    } catch {
      return
    }
    const deadline = Date.now() + graceMs
    while (Date.now() < deadline && processAlive(record.pid)) {
      await new Promise(resolveTimer => setTimeout(resolveTimer, 100))
    }
    if (processAlive(record.pid)) {
      try {
        process.kill(target, 'SIGKILL')
      } catch {
        /* группа уже завершилась */
      }
    }
  }

  // Завершает процессы РОВНО одной сессии; соседние сессии не затрагиваются
  // по построению — выбор идёт по зарегистрированным записям.
  async function killSessionProcesses(sessionId, options = {}) {
    const records = await listForSession(sessionId)
    for (const record of records) {
      await terminate(record, options)
      await store.delete(PROCESSES, record.procId).catch(() => {})
      await appendAudit(roots.stateRoot, 'process.terminated', { procId: record.procId, sessionId, pid: record.pid, command: record.command })
    }
    return { terminated: records.length }
  }

  return { spawnInSession, listForSession, killSessionProcesses }
}
