// Durable operation journal: crash-consistency для многошаговых операций.
//
// Опасные операции (создание сессии, cleanup, merge, recover, регистрация
// проекта) состоят из шагов state → git → filesystem → lease → process. Если
// процесс упал посередине, recovery не должен ГАДАТЬ, что успело произойти:
// журнал фиксирует последнюю завершённую фазу, и по ней восстановление точно
// знает, что существует на диске, а что нет.
//
// Это НЕ распределённые транзакции: одна запись на операцию, forward-only
// фазы, никакого отката «по журналу» без проверки фактического состояния.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const OPERATION_TYPES = Object.freeze({
  CREATE_SESSION: 'CREATE_SESSION',
  CLEANUP_SESSION: 'CLEANUP_SESSION',
  MERGE: 'MERGE',
  RECOVER_SESSION: 'RECOVER_SESSION',
  REGISTER_PROJECT: 'REGISTER_PROJECT',
})

// Фазы форвард-онли: каждая означает «этот шаг ЗАВЕРШЁН». Recovery смотрит на
// последнюю записанную фазу и знает, какие ресурсы уже существуют.
export const PHASES = Object.freeze({
  STARTED: 'STARTED',
  BRANCH_CREATED: 'BRANCH_CREATED',
  WORKTREE_CREATED: 'WORKTREE_CREATED',
  STATE_WRITTEN: 'STATE_WRITTEN',
  LEASE_ACQUIRED: 'LEASE_ACQUIRED',
  PORTS_ALLOCATED: 'PORTS_ALLOCATED',
  PROCESSES_STOPPED: 'PROCESSES_STOPPED',
  PORTS_RELEASED: 'PORTS_RELEASED',
  WORKTREE_REMOVED: 'WORKTREE_REMOVED',
  MERGING: 'MERGING',
  CONFLICT: 'CONFLICT',
  MERGE_COMMITTED: 'MERGE_COMMITTED',
  FINALIZED: 'FINALIZED',
  FAILED: 'FAILED',
})

export function createJournal({ roots }) {
  const journalRoot = join(roots.stateRoot, 'journal')

  async function writeRecord(record) {
    await mkdir(journalRoot, { recursive: true, mode: 0o700 })
    const path = join(journalRoot, `${record.operationId}.json`)
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }

  // begin() возвращает «ручку» операции: advance фиксирует завершённую фазу,
  // complete удаляет запись (операция целиком доведена), fail оставляет её с
  // причиной — незавершённые и упавшие операции видит reconciliation.
  async function begin(type, entityId, context = {}) {
    const operationId = `op-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    const startedAt = new Date().toISOString()
    let record = {
      schemaVersion: 1,
      operationId,
      type,
      entityId,
      phase: PHASES.STARTED,
      context,
      startedAt,
      updatedAt: startedAt,
    }
    await writeRecord(record)
    return {
      operationId,
      get phase() {
        return record.phase
      },
      async advance(phase, patch = {}) {
        record = {
          ...record,
          phase,
          context: { ...record.context, ...patch },
          updatedAt: new Date().toISOString(),
        }
        await writeRecord(record)
      },
      async complete() {
        await rm(join(journalRoot, `${operationId}.json`), { force: true }).catch(() => {})
      },
      async fail(reason) {
        record = {
          ...record,
          phase: PHASES.FAILED,
          // Сообщение об ошибке — операционная диагностика; секретов в нём
          // быть не должно (их не кладут в тексты ошибок Runtime).
          failure: String(reason ?? '').slice(0, 500),
          updatedAt: new Date().toISOString(),
        }
        await writeRecord(record)
      },
    }
  }

  // Все записи журнала = незавершённые или упавшие операции: успешные
  // удаляются самим complete().
  async function listOpen() {
    let names
    try {
      names = await readdir(journalRoot)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const records = []
    for (const name of names.filter(entry => entry.endsWith('.json'))) {
      try {
        records.push(JSON.parse(await readFile(join(journalRoot, name), 'utf8')))
      } catch {
        // Битая запись журнала не должна ломать восстановление: пропускаем,
        // фактическое состояние всё равно перепроверяется по диску и git.
      }
    }
    return records.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)))
  }

  async function forget(operationId) {
    await rm(join(journalRoot, `${operationId}.json`), { force: true }).catch(() => {})
  }

  return { begin, listOpen, forget, journalRoot }
}
