// Жизненный цикл Runtime: BOOTING → RECOVERING → READY | DEGRADED | FAILED.
//
// Мутационный API не принимается, пока не завершено первичное сверение
// durable-state с фактическим состоянием диска, git и процессов: иначе
// решения (создать workspace, удалить, перехватить lease) принимались бы по
// заведомо неполной картине. Read-only health доступен всегда — именно по
// нему desktop/SSH понимает, что происходит, вместо косвенных признаков.

import { RuntimeError } from './errors.js'
import { appendAudit } from './audit.js'
import { assertMinimumGitVersion } from './gitx.js'

export const RUNTIME_STATES = Object.freeze({
  BOOTING: 'BOOTING',
  RECOVERING: 'RECOVERING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
})

export function createLifecycle({ roots, store, sessions, projects }) {
  let state = RUNTIME_STATES.BOOTING
  let startedAt = new Date().toISOString()
  let lastReport
  let lastError
  let gitInfo
  let bootPromise

  function snapshot() {
    return {
      state,
      startedAt,
      ...(gitInfo ? { git: gitInfo.raw } : {}),
      ...(lastReport ? { reconciliation: lastReport } : {}),
      ...(lastError ? { error: lastError } : {}),
    }
  }

  // DEGRADED — это не «сломалось», а «работать можно, но создавать новое
  // опасно»: повреждён критический state или canonical-репозиторий.
  function assertReady() {
    if (state === RUNTIME_STATES.READY) return
    if (state === RUNTIME_STATES.DEGRADED) {
      throw new RuntimeError('PROJECT_DEGRADED', 'Runtime работает в ограниченном режиме: обнаружено повреждение состояния. Проверьте диагностику перед изменениями.', snapshot())
    }
    throw new RuntimeError('RUNTIME_NOT_READY', `Runtime ещё не готов (${state}). Повторите запрос после завершения восстановления.`, { state })
  }

  async function boot() {
    // Идемпотентно: несколько параллельных запросов не запускают несколько
    // reconciliation-проходов.
    bootPromise ??= (async () => {
      state = RUNTIME_STATES.RECOVERING
      startedAt = new Date().toISOString()
      try {
        await store.ensureRoot()
        gitInfo = await assertMinimumGitVersion()
        lastReport = await sessions.scanForRecovery()
        const criticalCorruption = typeof store.hasCriticalCorruption === 'function'
          ? store.hasCriticalCorruption()
          : false
        state = criticalCorruption ? RUNTIME_STATES.DEGRADED : RUNTIME_STATES.READY
        await appendAudit(roots.stateRoot, 'runtime.started', {
          state,
          orphaned: lastReport.orphaned.length,
          unfinishedOperations: lastReport.unfinishedOperations?.length ?? 0,
        })
      } catch (error) {
        // Нет git нужной версии или нечитаемый state — это FAILED: молча
        // притворяться готовым нельзя.
        state = RUNTIME_STATES.FAILED
        lastError = { code: error?.code ?? 'INTERNAL', message: error instanceof Error ? error.message : String(error) }
        await appendAudit(roots.stateRoot, 'runtime.failed', lastError).catch(() => {})
      }
      return snapshot()
    })()
    return bootPromise
  }

  // Read-only самопроверка (§68): ничего не меняет, годится для диагностики.
  async function selfCheck() {
    const checks = []
    const record = (name, ok, detail) => checks.push({ name, ok, ...(detail ? { detail } : {}) })
    try {
      await store.ensureRoot()
      record('state.writable', true)
    } catch (error) {
      record('state.writable', false, error instanceof Error ? error.message : String(error))
    }
    try {
      const version = gitInfo ?? await assertMinimumGitVersion()
      record('git.version', true, version.raw)
    } catch (error) {
      record('git.version', false, error instanceof Error ? error.message : String(error))
    }
    try {
      const list = await projects.list()
      record('projects.readable', true, `${String(list.length)} проект(ов)`)
    } catch (error) {
      record('projects.readable', false, error instanceof Error ? error.message : String(error))
    }
    const corrupt = typeof store.corruptions === 'function' ? store.corruptions() : []
    record('state.intact', corrupt.length === 0, corrupt.length > 0 ? `${String(corrupt.length)} повреждённых записей` : undefined)
    return { ok: checks.every(check => check.ok), state, checks }
  }

  return { boot, snapshot, assertReady, selfCheck, get state() { return state } }
}
