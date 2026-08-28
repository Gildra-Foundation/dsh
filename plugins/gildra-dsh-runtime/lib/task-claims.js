// Claims задач: пересечения (path/module/semantic), их решения и отпечатки
// (§14, §26–§28, §20).
//
// Выделен из tasks.js. Работа с чужими задачами (локальными и командными),
// установка claims и фиксация overlap-решения с fingerprint'ом контекста.

import { RuntimeError } from './errors.js'
import { appendAudit } from './audit.js'
import { detectOverlaps, detectSemanticOverlaps, normalizeClaims } from './claims.js'
import { stableHash } from './provenance.js'
import { ACTIVE_TASK_STATUSES } from './task-store.js'

export const OVERLAP_DECISIONS = Object.freeze(['COORDINATE', 'CONTINUE', 'WAIT', 'TRANSFER_OWNERSHIP'])

// Отпечаток КОНТЕКСТА пересечения (§14): сами пересечения + свои claims и
// план + ревизии чужих задач. Решение COORDINATE действительно ровно для
// этого отпечатка.
export function overlapContextFingerprint({ overlaps, semantic, record, others }) {
  return stableHash({
    overlaps: overlaps.map(entry => ({ taskId: entry.taskId, area: entry.area, mode: entry.mode, kind: entry.kind })),
    semantic: semantic.map(entry => ({ taskId: entry.taskId, sharedModules: entry.sharedModules })),
    claims: record.claims ?? [],
    plan: record.modulePlan ?? null,
    relatedTaskRevisions: Object.fromEntries(others.map(entry => [entry.taskId, entry.revision ?? entry.updatedAt ?? null])),
  })
}

export function createTaskClaims({ roots, team, repoIntel, taskStore, teamView }) {
  const { getTask, listTasks, saveTask } = taskStore
  const { teamSyncState } = teamView
  // Чужие активные задачи: локальные + командные (другие Runtime через
  // провайдера). Дедупликация по taskId — свои публикации не «чужие».
  async function foreignTasks(projectId, excludeTaskId) {
    const local = (await listTasks({ projectId, activeOnly: true }))
      .filter(record => record.taskId !== excludeTaskId)
      .map(record => ({
        taskId: record.taskId,
        owner: record.owner,
        claims: record.claims ?? [],
        affectedModules: record.analysis?.modularity?.changedModules ?? [],
      }))
    const localIds = new Set([...local.map(entry => entry.taskId), excludeTaskId])
    const remote = team
      ? (await team.listProjectTasks(projectId).catch(() => []))
        .filter(entry => !localIds.has(entry.taskId) && ACTIVE_TASK_STATUSES.includes(entry.status))
        .map(entry => ({ ...entry, remote: true }))
      : []
    return [...local, ...remote]
  }

  // Пересечение claims/файлов/модулей кандидата с чужими активными задачами —
  // включая задачи ДРУГИХ Runtime (§27): path + module уровни.
  async function overlapsFor(projectId, { claims = [], files = [], modules = [], excludeTaskId } = {}) {
    return detectOverlaps({ claims, files, modules }, await foreignTasks(projectId, excludeTaskId))
  }

  // Семантический уровень (§27): по рёбрам module-графа проекта.
  async function semanticOverlapsFor(projectId, { modules = [], excludeTaskId } = {}) {
    if (!repoIntel || modules.length === 0) return []
    const map = await repoIntel.getModuleMap(projectId).catch(() => undefined)
    if (!map) return []
    const moduleEdges = new Map(Object.entries(map.moduleEdges ?? {}).map(([from, targets]) => [from, new Set(targets)]))
    return detectSemanticOverlaps({
      myModules: modules,
      others: await foreignTasks(projectId, excludeTaskId),
      moduleEdges,
    })
  }

  // Обновление claims задачи возвращает свежие пересечения — UI показывает
  // их сразу, не дожидаясь чужого diff.
  async function setClaims(taskId, claims, { confirmExclusiveOverlap = false } = {}) {
    const record = await getTask(taskId)
    const normalized = normalizeClaims(claims)
    const overlaps = await overlapsFor(record.projectId, { claims: normalized, excludeTaskId: taskId })
    const exclusive = overlaps.filter(overlap => overlap.mode === 'EXCLUSIVE')
    if (exclusive.length > 0 && !confirmExclusiveOverlap) {
      throw new RuntimeError('CLAIM_CONFLICT', 'Область эксклюзивно занята другой задачей.', { overlaps: exclusive })
    }
    record.claims = normalized
    const updated = await saveTask(record)
    return { task: updated, overlaps }
  }

  // Module Change Plan (§6): структурный план изменения ДО кода. Валидация
  // держит план осмысленным (модуль + причина), но не бюрократичным: для
  // мелкой правки достаточно одной записи.
  // §28: явная фиксация решения по пересечению.
  async function recordOverlapDecision(taskId, { decision, note }) {
    const record = await getTask(taskId)
    if (!OVERLAP_DECISIONS.includes(decision)) {
      throw new RuntimeError('INVALID_INPUT', `Решение по пересечению: ${OVERLAP_DECISIONS.join('/')}.`, { allowed: OVERLAP_DECISIONS })
    }
    // Решение привязывается к ТЕКУЩЕМУ контексту пересечения (§14).
    const plannedModules = [
      ...(record.modulePlan?.modulesToChange ?? []).map(entry => entry.module),
      ...(record.modulePlan?.newModules ?? []).map(entry => entry.id),
    ]
    const overlaps = await overlapsFor(record.projectId, { claims: record.claims ?? [], modules: plannedModules, excludeTaskId: taskId })
    const semantic = await semanticOverlapsFor(record.projectId, { modules: plannedModules, excludeTaskId: taskId })
    const others = await foreignTasks(record.projectId, taskId)
    record.overlapDecision = {
      decision,
      overlapFingerprint: overlapContextFingerprint({ overlaps, semantic, record, others }),
      teamRevision: (await teamSyncState(record.projectId))?.lastRevision,
      claimsHash: stableHash(record.claims ?? []),
      modulePlanHash: stableHash(record.modulePlan ?? null),
      ...(note ? { note: String(note).slice(0, 500) } : {}),
      createdAt: new Date().toISOString(),
    }
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.overlap-decision', { taskId, decision })
    return updated
  }

  // Явное объяснение сигнала diff-анализа (§37, §15): молча сигнал не гаснет,
  // и объяснение привязывается к ОТПЕЧАТКУ текущего сигнала — прошлогоднее
  // объяснение TEST_WEAKENING не покрывает новое ослабление после следующего
  // коммита. verifiedActor обязан быть УЖЕ проверен вызывающим слоем
  // (capability ревьюера проверяет review-модуль/API).

  return { foreignTasks, overlapsFor, semanticOverlapsFor, setClaims, recordOverlapDecision }
}
