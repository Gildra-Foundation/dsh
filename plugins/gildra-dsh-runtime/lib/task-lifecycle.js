// Жизненный цикл задачи: переходы с guard'ами (§13, §28, §20).
//
// Выделен из tasks.js. Здесь живут ТРИ правила, держащие конвейер:
// READY_FOR_HUMAN_REVIEW не назначается транзишеном; MERGED — только из
// готовности; FAILED всегда несёт failureKind. Плюс gates write-фазы:
// Module Change Plan, strict-синхронизация команды и fingerprint
// overlap-решения.

import { RuntimeError } from './errors.js'
import { appendAudit } from './audit.js'
import { TASK_STATUSES, FAILURE_KINDS } from './task-store.js'
import { overlapContextFingerprint } from './task-claims.js'

export function createTaskLifecycle({ roots, projects, team, taskStore, claims: claimsModule, teamView }) {
  const { getTask, saveTask } = taskStore
  const { overlapsFor, semanticOverlapsFor, foreignTasks } = claimsModule
  const { publishToTeam, recordTeamSync } = teamView
  // Смена статуса с guard'ами. READY_FOR_HUMAN_REVIEW сюда не пускаем ни при
  // каких условиях: этот статус ставит только quality-gate, у которого есть
  // evidence (promoteIfReady в quality.js) — иначе «готово» снова стало бы
  // словом, а не фактом.
  async function transition(taskId, status, { reason, failureKind } = {}) {
    const record = await getTask(taskId)
    if (!TASK_STATUSES.includes(status)) {
      throw new RuntimeError('INVALID_INPUT', `Недопустимый статус задачи «${String(status)}».`, { allowed: TASK_STATUSES })
    }
    if (status === 'READY_FOR_HUMAN_REVIEW') {
      throw new RuntimeError('READINESS_REQUIRED', 'READY_FOR_HUMAN_REVIEW нельзя назначить напрямую: статус вычисляется quality-gate по evidence (POST /gildra/v1/tasks/promote).', { taskId })
    }
    if (status === 'MERGED' && record.status !== 'READY_FOR_HUMAN_REVIEW') {
      throw new RuntimeError('READINESS_REQUIRED', 'MERGED допустим только из READY_FOR_HUMAN_REVIEW: сначала пройдите quality-gate.', { taskId, currentStatus: record.status })
    }
    if (status === 'FAILED') {
      if (!FAILURE_KINDS.includes(failureKind)) {
        throw new RuntimeError('INVALID_INPUT', 'FAILED требует failureKind: что именно сломалось.', { allowed: FAILURE_KINDS })
      }
      record.failureKind = failureKind
    }
    if ((status === 'BLOCKED' || status === 'CANCELLED') && typeof reason === 'string') {
      record.blockReason = reason.slice(0, 500)
    }
    // Module Change Plan (§6): write-фаза не начинается без структурного
    // плана «в каком модуле живёт ответственность». Для мелкой правки план
    // короткий, но он обязан существовать — иначе логика ложится в случайный
    // «удобный» файл. Задачи без workspace (чистое планирование) не трогаем.
    if (status === 'IMPLEMENTING' && record.workspaceId && !record.modulePlan) {
      throw new RuntimeError('MODULE_PLAN_REQUIRED', 'Перед реализацией зафиксируйте Module Change Plan: какие модули меняются и почему (POST /gildra/v1/tasks/module-plan).', { taskId })
    }
    // §28: до write-фазы claims публикуются команде, пересечения (path/
    // module/semantic — включая другие Runtime) вычисляются, и при их наличии
    // требуется ЯВНОЕ зафиксированное решение — молча игнорировать нельзя.
    if (status === 'IMPLEMENTING' && record.workspaceId) {
      const project = await projects.get(record.projectId)
      const teamMode = project.qualityPolicy?.team?.mode ?? (team ? 'best-effort' : 'solo')
      const sync = await publishToTeam(record)
      // §12 strict: без успешной публикации claims и живого чтения командного
      // состояния write-фаза не начинается — молчаливый fail-open запрещён.
      if (teamMode === 'strict') {
        if (!team) {
          throw new RuntimeError('TEAM_SYNC_REQUIRED', 'Проект в strict-режиме командной синхронизации, но Team Provider не настроен.', { taskId })
        }
        if (!sync.ok) {
          throw new RuntimeError(sync.status === 'CONFLICT' ? 'TEAM_STATE_CONFLICT' : 'TEAM_SYNC_DEGRADED', 'Команду не удалось синхронизировать — в strict-режиме работа не начинается, пока claims не опубликованы и не прочитано актуальное состояние.', { taskId, status: sync.status })
        }
      }
      let plannedModules = [
        ...(record.modulePlan?.modulesToChange ?? []).map(entry => entry.module),
        ...(record.modulePlan?.newModules ?? []).map(entry => entry.id),
      ]
      let overlaps
      let semantic
      try {
        overlaps = await overlapsFor(record.projectId, { claims: record.claims ?? [], modules: plannedModules, excludeTaskId: taskId })
        semantic = await semanticOverlapsFor(record.projectId, { modules: plannedModules, excludeTaskId: taskId })
      } catch (error) {
        if (teamMode === 'strict') {
          await recordTeamSync(record.projectId, { status: 'DEGRADED', lastError: String(error?.code ?? error).slice(0, 120) })
          throw new RuntimeError('TEAM_SYNC_DEGRADED', 'Не удалось прочитать командные claims — в strict-режиме это блокирует начало работы.', { taskId })
        }
        overlaps = []
        semantic = []
      }
      if (overlaps.length > 0 || semantic.length > 0) {
        const others = await foreignTasks(record.projectId, taskId)
        const fingerprint = overlapContextFingerprint({ overlaps, semantic, record, others })
        if (!record.overlapDecision) {
          throw new RuntimeError('OVERLAP_DECISION_REQUIRED', 'Работа пересекается с активными задачами команды — зафиксируйте решение (COORDINATE/CONTINUE/WAIT/TRANSFER_OWNERSHIP) прежде чем писать код.', {
            taskId, overlaps, semantic, overlapFingerprint: fingerprint,
          })
        }
        // §14: старое решение не действует бессрочно — только для ТОГО
        // контекста, в котором принималось.
        if (record.overlapDecision.overlapFingerprint !== fingerprint) {
          throw new RuntimeError('STALE_OVERLAP_DECISION', 'Командный контекст изменился после решения по пересечению (новая задача, чужая claim или новый план) — примите решение заново.', {
            taskId, overlaps, semantic, overlapFingerprint: fingerprint,
          })
        }
      }
    }
    // Возврат в работу очищает причины прошлой остановки.
    if (status === 'IMPLEMENTING' || status === 'FIXING_REVIEW') {
      delete record.blockReason
      delete record.failureKind
    }
    record.status = status
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.transition', { taskId, status, ...(failureKind ? { failureKind } : {}) })
    await publishToTeam(updated)
    return updated
  }

  // Привязка workspace/сессии. Dirty precondition (§39): существующие
  // незакоммиченные изменения фиксируются ЯВНО — задача не присваивает себе
  // чужой diff молча.

  return { transition }
}
