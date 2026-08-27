// Task: инженерная единица работы (docs/ai-quality.md).
//
// Не Jira и не chat-лог: задача связывает критерии приёмки, ожидаемый scope,
// claims, workspace/ветку с immutable baseSha, provenance (кто владелец, кто
// writer, кто reviewer), evidence и доставку. Три правила, на которых держится
// весь слой качества:
//   1. READY_FOR_HUMAN_REVIEW НЕЛЬЗЯ выставить транзишеном — только
//      quality-gate (quality.js) после проверки Definition of Done;
//   2. сигналы diff-анализа (TEST_WEAKENING и т.п.) не гасятся молча — только
//      явным acknowledgment с объяснением;
//   3. FAILED всегда несёт failureKind: «что именно сломалось» — данные, а не
//      один слепой статус (§70).

import { RuntimeError } from './errors.js'
import { assertId, generateId } from './ids.js'
import { appendAudit } from './audit.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import { detectOverlaps, detectSemanticOverlaps, normalizeClaims } from './claims.js'
import { sanitizeTaskSummary } from './team.js'
import { signalFingerprint } from './provenance.js'

const TASKS = 'tasks'

export const TASK_STATUSES = Object.freeze([
  'PLANNED', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING', 'FIXING_REVIEW',
  'READY_FOR_HUMAN_REVIEW', 'MERGED', 'BLOCKED', 'CANCELLED', 'FAILED',
])

// Статусы, в которых задача считается активной для claims/overlap.
export const ACTIVE_TASK_STATUSES = Object.freeze([
  'PLANNED', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING', 'FIXING_REVIEW', 'READY_FOR_HUMAN_REVIEW', 'BLOCKED',
])

export const FAILURE_KINDS = Object.freeze([
  'IMPLEMENTATION', 'VERIFICATION', 'REVIEW', 'CI', 'MERGE_CONFLICT',
])

export const TASK_KINDS = Object.freeze(['feature', 'bugfix', 'refactor', 'docs', 'chore'])

// Сигналы, чьё объяснение обязан дать reviewer или человек, а не сам writer
// (§15): ослабление тестов, protected-области, зависимости и публичный API.
export const REVIEWER_ACK_SIGNALS = Object.freeze([
  'TEST_WEAKENING', 'PROTECTED_AREA_CHANGE', 'DEPENDENCY_CHANGE', 'BACKWARD_COMPATIBILITY',
])

// Сигналы diff-анализа, требующие явного объяснения (§37, §19, §21, §12).
export const ACKNOWLEDGEABLE_SIGNALS = Object.freeze([
  'TEST_WEAKENING', 'UNEXPECTED_CHANGE', 'PROTECTED_AREA_CHANGE',
  'DEPENDENCY_CHANGE', 'GENERATED_FILE_EDIT', 'BACKWARD_COMPATIBILITY',
  'UPSTREAM_RELEVANT',
  // Modularity Analyzer (§7): REVIEW-сигналы гасятся объяснением, BLOCK-коды
  // (циклы, cross-layer) объяснением не гасятся вовсе — только устранением.
  'DEEP_INTERNAL_IMPORT', 'OVERSIZED_MODULE_GROWTH', 'OVERSIZED_FUNCTION_GROWTH',
  'NEW_GLOBAL_MUTABLE_STATE', 'DUPLICATED_DOMAIN_LOGIC', 'MIXED_RESPONSIBILITIES',
  'UNEXPECTED_MODULE_CHANGE',
])

const MAX_CRITERIA = 20
const MAX_CRITERION_LENGTH = 300
const MAX_AREAS = 50
const MAX_AREA_LENGTH = 200
const DEFAULT_CI_FIX_LIMIT = 3

function trimmedList(raw, { max, maxLength, label }) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new RuntimeError('INVALID_INPUT', `${label} должен быть массивом строк.`)
  if (raw.length > max) throw new RuntimeError('LIMIT_EXCEEDED', `${label}: не больше ${String(max)} элементов.`)
  return raw.map(item => {
    if (typeof item !== 'string' || item.trim() === '' || item.length > maxLength) {
      throw new RuntimeError('INVALID_INPUT', `${label}: каждый элемент — непустая строка до ${String(maxLength)} символов.`)
    }
    return item.trim()
  })
}

function actor(raw) {
  return raw === undefined || raw === null ? undefined : String(raw).slice(0, 100)
}

export const OVERLAP_DECISIONS = Object.freeze(['COORDINATE', 'CONTINUE', 'WAIT', 'TRANSFER_OWNERSHIP'])

const TEAM_SYNC = 'team-sync'

export function createTaskManager({ store, roots, projects, team, repoIntel }) {
  // Реальное состояние синхронизации (§15): UI не имеет права показывать
  // claims «актуальными», если последняя публикация провалилась.
  async function recordTeamSync(projectId, patch) {
    const current = (await store.read(TEAM_SYNC, projectId)) ?? { schemaVersion: CURRENT_SCHEMA_VERSION, projectId }
    const next = { ...current, ...patch, provider: team?.backend, updatedAt: new Date().toISOString() }
    await store.write(TEAM_SYNC, projectId, next)
    return next
  }

  async function teamSyncState(projectId) {
    if (!team) return { status: 'DISABLED', provider: undefined }
    return (await store.read(TEAM_SYNC, projectId)) ?? { status: 'HEALTHY', provider: team.backend }
  }

  // Публикация в командную координацию. Возвращает исход, а решение —
  // best-effort или strict — принимает вызывающий по team-политике (§12).
  async function publishToTeam(record) {
    if (!team) return { ok: true, disabled: true }
    try {
      const summary = sanitizeTaskSummary(record)
      const existing = (await team.listProjectTasks(record.projectId))
        .find(entry => entry.taskId === record.taskId)
      const published = await team.publishTaskSummary(summary, { expectedRevision: existing?.revision ?? 0 })
      await recordTeamSync(record.projectId, { status: 'HEALTHY', lastRevision: published.revision, lastSuccessAt: new Date().toISOString(), lastError: undefined })
      return { ok: true, revision: published.revision }
    } catch (error) {
      const status = error?.code === 'TEAM_STATE_CONFLICT' ? 'CONFLICT' : 'DEGRADED'
      await recordTeamSync(record.projectId, { status, lastError: String(error?.code ?? error).slice(0, 120) })
      await appendAudit(roots.stateRoot, 'team.publish.failed', { taskId: record.taskId, code: error?.code ?? 'ERROR' })
      return { ok: false, status, error }
    }
  }
  async function getTask(taskId) {
    const record = await store.read(TASKS, assertId(taskId, 'taskId'))
    if (!record) throw new RuntimeError('TASK_NOT_FOUND', `Задача «${taskId}» не найдена.`, { taskId })
    return record
  }

  async function listTasks(filter = {}) {
    const rows = []
    for (const id of await store.list(TASKS)) {
      const record = await store.read(TASKS, id)
      if (!record) continue
      if (filter.projectId && record.projectId !== filter.projectId) continue
      if (filter.activeOnly && !ACTIVE_TASK_STATUSES.includes(record.status)) continue
      if (filter.owner && record.owner !== filter.owner) continue
      rows.push(record)
    }
    return rows
  }

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

  async function createTask({ projectId, title, kind = 'feature', baseBranch, owner, acceptanceCriteria, expectedAreas, claims, confirmExclusiveOverlap = false }) {
    const project = await projects.get(projectId)
    if (typeof title !== 'string' || title.trim() === '' || title.length > 300) {
      throw new RuntimeError('INVALID_INPUT', 'Название задачи должно быть непустой строкой до 300 символов.')
    }
    if (!TASK_KINDS.includes(kind)) {
      throw new RuntimeError('INVALID_INPUT', `Недопустимый тип задачи «${String(kind)}».`, { allowed: TASK_KINDS })
    }
    const normalizedClaims = normalizeClaims(claims)
    const overlaps = await overlapsFor(projectId, { claims: normalizedClaims })
    // EXCLUSIVE-чужой claim — единственный блокирующий случай; обычный
    // CLAIMED-пересечение возвращается как предупреждение (§30).
    const exclusive = overlaps.filter(overlap => overlap.mode === 'EXCLUSIVE')
    if (exclusive.length > 0 && !confirmExclusiveOverlap) {
      throw new RuntimeError('CLAIM_CONFLICT', 'Область эксклюзивно занята другой задачей. Скоординируйтесь или подтвердите пересечение явно.', { overlaps: exclusive })
    }
    const taskId = generateId('task')
    const record = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      taskId,
      projectId,
      title: title.trim(),
      kind,
      baseBranch: baseBranch ?? project.defaultBranch,
      owner: actor(owner),
      status: 'PLANNED',
      acceptanceCriteria: trimmedList(acceptanceCriteria, { max: MAX_CRITERIA, maxLength: MAX_CRITERION_LENGTH, label: 'acceptanceCriteria' }),
      expectedAreas: trimmedList(expectedAreas, { max: MAX_AREAS, maxLength: MAX_AREA_LENGTH, label: 'expectedAreas' }),
      claims: normalizedClaims,
      acknowledgments: [],
      sessions: [],
      agents: [],
      workspaces: [],
      reviews: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await store.write(TASKS, taskId, record)
    await appendAudit(roots.stateRoot, 'task.created', { taskId, projectId, kind, claims: normalizedClaims.length })
    return { task: record, overlaps }
  }

  async function saveTask(record) {
    const updated = { ...record, updatedAt: new Date().toISOString() }
    await store.write(TASKS, record.taskId, updated)
    return updated
  }

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
      if ((overlaps.length > 0 || semantic.length > 0) && !record.overlapDecision) {
        throw new RuntimeError('OVERLAP_DECISION_REQUIRED', 'Работа пересекается с активными задачами команды — зафиксируйте решение (COORDINATE/CONTINUE/WAIT/TRANSFER_OWNERSHIP) прежде чем писать код.', {
          taskId, overlaps, semantic,
        })
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
  async function attachWorkspace(taskId, { workspaceId, sessionId, branch, baseSha, dirtyFiles = [], acceptDirty = false }) {
    const record = await getTask(taskId)
    if (Array.isArray(dirtyFiles) && dirtyFiles.length > 0 && !acceptDirty) {
      throw new RuntimeError('WORKSPACE_DIRTY', `В workspace уже есть ${String(dirtyFiles.length)} незакоммиченных файлов. Подтвердите явно (acceptDirty), что задача принимает их как свои, или начните с чистого workspace.`, {
        taskId, dirtyFiles: dirtyFiles.length,
      })
    }
    record.workspaceId = assertId(workspaceId, 'workspaceId')
    if (sessionId) record.sessions = [...new Set([...record.sessions, assertId(sessionId, 'sessionId')])]
    if (branch) record.branch = String(branch).slice(0, 200)
    if (baseSha) record.baseSha = String(baseSha).slice(0, 64)
    record.workspaces = [...new Set([...record.workspaces, record.workspaceId])]
    if (dirtyFiles.length > 0) {
      record.preexistingDirty = dirtyFiles.slice(0, 100).map(file => String(file).slice(0, 300))
    }
    return saveTask(record)
  }

  async function updateTask(taskId, { linkSession, linkAgent, writerAgent, reviewerAgent, humanReviewer, result, acceptanceCriteria, expectedAreas } = {}) {
    const record = await getTask(taskId)
    if (linkSession) record.sessions = [...new Set([...record.sessions, assertId(linkSession, 'sessionId')])]
    if (linkAgent) record.agents = [...new Set([...record.agents, String(linkAgent).slice(0, 100)])]
    if (writerAgent !== undefined) record.writerAgent = actor(writerAgent)
    if (reviewerAgent !== undefined) record.reviewerAgent = actor(reviewerAgent)
    if (humanReviewer !== undefined) record.humanReviewer = actor(humanReviewer)
    if (result !== undefined) record.result = String(result).slice(0, 2000)
    if (acceptanceCriteria !== undefined) {
      record.acceptanceCriteria = trimmedList(acceptanceCriteria, { max: MAX_CRITERIA, maxLength: MAX_CRITERION_LENGTH, label: 'acceptanceCriteria' })
    }
    if (expectedAreas !== undefined) {
      record.expectedAreas = trimmedList(expectedAreas, { max: MAX_AREAS, maxLength: MAX_AREA_LENGTH, label: 'expectedAreas' })
    }
    return saveTask(record)
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
  async function setModulePlan(taskId, plan) {
    const record = await getTask(taskId)
    if (!plan || typeof plan !== 'object') throw new RuntimeError('INVALID_INPUT', 'Ожидался Module Change Plan.')
    const changes = Array.isArray(plan.modulesToChange) ? plan.modulesToChange : []
    const created = Array.isArray(plan.newModules) ? plan.newModules : []
    if (changes.length + created.length === 0) {
      throw new RuntimeError('INVALID_INPUT', 'План обязан называть хотя бы один изменяемый или новый модуль.')
    }
    const normalizedChanges = changes.slice(0, 30).map(entry => {
      if (typeof entry?.module !== 'string' || entry.module === '' || entry.module.length > 120) {
        throw new RuntimeError('INVALID_INPUT', 'modulesToChange: у каждой записи обязан быть module.')
      }
      if (typeof entry?.reason !== 'string' || entry.reason.trim().length < 5) {
        throw new RuntimeError('INVALID_INPUT', `modulesToChange: объясните, почему меняется «${entry.module}».`)
      }
      return { module: entry.module, reason: entry.reason.trim().slice(0, 300) }
    })
    const normalizedNew = created.slice(0, 10).map(entry => {
      if (typeof entry?.id !== 'string' || entry.id === '' || entry.id.length > 120) {
        throw new RuntimeError('INVALID_INPUT', 'newModules: у нового модуля обязан быть id.')
      }
      if (typeof entry?.responsibility !== 'string' || entry.responsibility.trim().length < 10) {
        throw new RuntimeError('INVALID_INPUT', `newModules: назовите ответственность модуля «${entry.id}» — модуль без ответственности это и есть будущая свалка.`)
      }
      return { id: entry.id, responsibility: entry.responsibility.trim().slice(0, 300) }
    })
    record.modulePlan = {
      modulesToChange: normalizedChanges,
      newModules: normalizedNew,
      publicContractsChanged: (plan.publicContractsChanged ?? []).slice(0, 20).map(String),
      dependenciesAdded: (plan.dependenciesAdded ?? []).slice(0, 20).map(String),
      testsRequired: (plan.testsRequired ?? []).slice(0, 20).map(String),
      risks: (plan.risks ?? []).slice(0, 20).map(String),
      createdAt: new Date().toISOString(),
    }
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.module-plan', { taskId, modules: normalizedChanges.length, newModules: normalizedNew.length })
    return updated
  }

  // §28: явная фиксация решения по пересечению.
  async function recordOverlapDecision(taskId, { decision, note }) {
    const record = await getTask(taskId)
    if (!OVERLAP_DECISIONS.includes(decision)) {
      throw new RuntimeError('INVALID_INPUT', `Решение по пересечению: ${OVERLAP_DECISIONS.join('/')}.`, { allowed: OVERLAP_DECISIONS })
    }
    record.overlapDecision = {
      decision,
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
  async function acknowledgeSignal(taskId, { signal, explanation, verifiedActor }) {
    const record = await getTask(taskId)
    if (!ACKNOWLEDGEABLE_SIGNALS.includes(signal)) {
      throw new RuntimeError('INVALID_INPUT', `Неизвестный сигнал «${String(signal)}».`, { allowed: ACKNOWLEDGEABLE_SIGNALS })
    }
    if (typeof explanation !== 'string' || explanation.trim().length < 10) {
      throw new RuntimeError('INVALID_INPUT', 'Объяснение сигнала обязано быть содержательным (минимум 10 символов).')
    }
    const actorInfo = verifiedActor && typeof verifiedActor === 'object'
      ? { type: String(verifiedActor.type ?? 'AI_WRITER'), id: actor(verifiedActor.id) }
      : { type: 'AI_WRITER' }
    if (REVIEWER_ACK_SIGNALS.includes(signal) && actorInfo.type !== 'AI_REVIEWER' && actorInfo.type !== 'HUMAN') {
      throw new RuntimeError('ACK_REQUIRES_REVIEWER', `Сигнал ${signal} гасится только reviewer'ом или человеком: объяснение writer'а — не приёмка собственной работы.`, { signal })
    }
    // Отпечаток: все текущие сигналы этого kind из последнего анализа. Для
    // UPSTREAM_RELEVANT привязка — к targetSha upstream-оценки.
    const matching = (record.analysis?.signals ?? []).filter(entry => entry.kind === signal)
    const fingerprint = signal === 'UPSTREAM_RELEVANT'
      ? signalFingerprint(signal, { targetSha: record.upstream?.targetSha })
      : signalFingerprint(signal, matching.map(entry => entry.fingerprint).sort())
    record.acknowledgments = [
      ...record.acknowledgments.filter(entry => entry.signal !== signal),
      {
        signal,
        fingerprint,
        headSha: record.analysis?.headSha,
        analysisHash: record.analysis?.analysisHash,
        ...(signal === 'UPSTREAM_RELEVANT' ? { targetSha: record.upstream?.targetSha } : {}),
        actorType: actorInfo.type,
        ...(actorInfo.id ? { actorId: actorInfo.id } : {}),
        explanation: explanation.trim().slice(0, 1000),
        createdAt: new Date().toISOString(),
      },
    ]
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.signal.acknowledged', { taskId, signal, actorType: actorInfo.type })
    return updated
  }

  // Доставка: PR-факты. CI-статус сюда НЕ принимается (§32) — только через
  // recordCiEvidence со структурной привязкой к commit SHA.
  async function recordDelivery(taskId, { mode, prUrl, prNumber, ciStatus, branchPushed }) {
    if (ciStatus !== undefined) {
      throw new RuntimeError('INVALID_INPUT', 'ciStatus в delivery не принимается: CI-доказательство передаётся через /tasks/ci-evidence с commitSha и workflowRunId (§32).')
    }
    const record = await getTask(taskId)
    const delivery = { ...(record.delivery ?? { ciFixAttempts: 0 }) }
    if (mode !== undefined) {
      if (!['PR', 'LOCAL_MERGE'].includes(mode)) {
        throw new RuntimeError('INVALID_INPUT', 'delivery.mode: PR или LOCAL_MERGE.')
      }
      delivery.mode = mode
    }
    if (prUrl !== undefined) {
      let parsed
      try {
        parsed = new URL(String(prUrl))
      } catch {
        throw new RuntimeError('INVALID_INPUT', 'prUrl должен быть корректным https-URL.')
      }
      if (parsed.protocol !== 'https:') throw new RuntimeError('INVALID_INPUT', 'prUrl должен быть https.')
      delivery.prUrl = parsed.href
    }
    if (prNumber !== undefined) {
      if (!Number.isInteger(prNumber) || prNumber <= 0) throw new RuntimeError('INVALID_INPUT', 'prNumber — положительное целое.')
      delivery.prNumber = prNumber
    }
    if (branchPushed !== undefined) delivery.branchPushed = branchPushed === true
    record.delivery = delivery
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.delivery', { taskId, ...(delivery.prNumber ? { prNumber: delivery.prNumber } : {}) })
    return updated
  }

  // Доверенное CI-evidence (§32): произвольный {"ciStatus":"PASSED"} не
  // принимается. Обязательны commitSha (== headSha задачи), workflowRunId и
  // источник; новый коммит протухает доказательство сам собой (проверка в
  // readiness по commitSha).
  async function recordCiEvidence(taskId, evidence) {
    const record = await getTask(taskId)
    // §7: наличие полей в JSON — не доверие. Evidence принимается только от
    // слоя, проверившего TRUSTED_INTEGRATION-capability предъявителя.
    if (evidence?.verifiedIntegration?.provider === undefined) {
      throw new RuntimeError('CAPABILITY_REQUIRED', 'CI-evidence принимается только от доверенной интеграции (TRUSTED_INTEGRATION capability): поля source/workflowRunId сами по себе ничего не доказывают.', { taskId })
    }
    const commitSha = typeof evidence?.commitSha === 'string' ? evidence.commitSha : ''
    const conclusion = String(evidence?.conclusion ?? '')
    if (!/^[0-9a-f]{40}$/.test(commitSha)) {
      throw new RuntimeError('INVALID_INPUT', 'CI-evidence требует полный commitSha (40 hex).')
    }
    if (!['success', 'failure', 'cancelled', 'timed_out', 'neutral'].includes(conclusion)) {
      throw new RuntimeError('INVALID_INPUT', 'CI-evidence: conclusion — success/failure/cancelled/timed_out/neutral.')
    }
    if (typeof evidence?.workflowRunId !== 'string' && !Number.isInteger(evidence?.workflowRunId)) {
      throw new RuntimeError('INVALID_INPUT', 'CI-evidence требует workflowRunId доверенной интеграции.')
    }
    const currentHead = record.analysis?.headSha
    if (currentHead && commitSha !== currentHead) {
      throw new RuntimeError('CI_EVIDENCE_MISMATCH', `CI-evidence относится к ${commitSha.slice(0, 12)}, а HEAD задачи — ${String(currentHead).slice(0, 12)}: доказательство чужого коммита не принимается.`, {
        taskId, commitSha, headSha: currentHead,
      })
    }
    const delivery = { ...(record.delivery ?? { ciFixAttempts: 0 }) }
    delivery.ci = {
      commitSha,
      conclusion,
      workflowRunId: String(evidence.workflowRunId),
      ...(evidence.checkSuiteId ? { checkSuiteId: String(evidence.checkSuiteId).slice(0, 60) } : {}),
      ...(evidence.repository ? { repository: String(evidence.repository).slice(0, 200) } : {}),
      provider: String(evidence.verifiedIntegration.provider).slice(0, 60),
      verifiedBy: `${String(evidence.verifiedIntegration.provider).slice(0, 60)}-integration`,
      verifiedAt: new Date().toISOString(),
    }
    if (conclusion !== 'success') {
      delivery.ciFixAttempts = (delivery.ciFixAttempts ?? 0) + 1
      record.failureKind = 'CI'
      // Ограниченный CI-цикл: после лимита задача останавливается и ждёт
      // человека, а не чинит CI вечно.
      if (delivery.ciFixAttempts > DEFAULT_CI_FIX_LIMIT) {
        record.status = 'BLOCKED'
        record.blockReason = `CI падал ${String(delivery.ciFixAttempts)} раз подряд — автоматические починки исчерпаны, нужен человек.`
      }
    } else {
      delete record.failureKind
    }
    record.delivery = delivery
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.ci-evidence', { taskId, conclusion, workflowRunId: delivery.ci.workflowRunId })
    return updated
  }

  // Human-approval (§6 плана authority): фиксируется ТОЛЬКО после расхода
  // одноразовой HumanActionCapability, выданной интерактивным каналом
  // приложения. Флаг {"human": true} доказательством не является и не
  // принимается. verifiedHuman обязан прийти от слоя, который расходовал
  // capability (API/host) — сама задача ей не управляет.
  async function recordHumanApproval(taskId, { kind, actorId, note, verifiedHuman }) {
    const record = await getTask(taskId)
    const approvalKind = String(kind ?? '').slice(0, 60)
    if (approvalKind === '') throw new RuntimeError('INVALID_INPUT', 'Укажите kind human-approval (например CODEOWNERS).')
    if (verifiedHuman !== true) {
      throw new RuntimeError('CAPABILITY_REQUIRED', 'Human-approval фиксируется только по одноразовой HumanActionCapability из интерактивного канала — слово «я человек» не принимается.', { taskId, kind: approvalKind })
    }
    record.humanApprovals = [
      ...(record.humanApprovals ?? []).filter(entry => entry.kind !== approvalKind),
      {
        kind: approvalKind,
        actorType: 'HUMAN',
        actorId: actor(actorId) ?? 'human',
        headSha: record.analysis?.headSha,
        ...(note ? { note: String(note).slice(0, 500) } : {}),
        createdAt: new Date().toISOString(),
      },
    ]
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.human-approval', { taskId, kind: approvalKind })
    return updated
  }

  // Обзор команды (§29, §47): активные задачи по людям и агентам, пересечения,
  // ожидающие ревью и CI-падения — данные для Team View.
  async function teamOverview(projectId) {
    const active = await listTasks({ projectId, activeOnly: true })
    // Команда — это не только этот Runtime: подмешиваем задачи других
    // участников из провайдера (§34), без секретов по построению.
    const localIds = new Set(active.map(task => task.taskId))
    const remote = team && projectId
      ? (await team.listProjectTasks(projectId).catch(() => []))
        .filter(entry => !localIds.has(entry.taskId) && ACTIVE_TASK_STATUSES.includes(entry.status))
        .map(entry => ({ ...entry, remote: true }))
      : []
    active.push(...remote)
    const byOwner = {}
    for (const task of active) {
      const owner = task.owner ?? '(без владельца)'
      byOwner[owner] = byOwner[owner] ?? []
      byOwner[owner].push({ taskId: task.taskId, title: task.title, status: task.status })
    }
    const overlapPairs = []
    for (let a = 0; a < active.length; a += 1) {
      for (let b = a + 1; b < active.length; b += 1) {
        const found = detectOverlaps(
          { claims: active[a].claims ?? [] },
          [{ taskId: active[b].taskId, owner: active[b].owner, claims: active[b].claims ?? [] }],
        )
        if (found.length > 0) {
          overlapPairs.push({
            tasks: [
              { taskId: active[a].taskId, owner: active[a].owner },
              { taskId: active[b].taskId, owner: active[b].owner },
            ],
            areas: [...new Set(found.map(overlap => overlap.area))],
          })
        }
      }
    }
    return {
      activeTasks: active.length,
      byOwner,
      agents: active.flatMap(task => [
        ...(task.writerAgent ? [{ agent: task.writerAgent, role: 'writer', taskId: task.taskId }] : []),
        ...(task.reviewerAgent ? [{ agent: task.reviewerAgent, role: 'reviewer', taskId: task.taskId }] : []),
      ]),
      overlaps: overlapPairs,
      waitingReview: active.filter(task => task.status === 'REVIEWING').map(task => task.taskId),
      ciFailures: active.filter(task => task.delivery?.ciStatus === 'FAILED').map(task => task.taskId),
    }
  }

  return {
    createTask,
    setModulePlan,
    getTask,
    listTasks,
    updateTask,
    transition,
    attachWorkspace,
    setClaims,
    acknowledgeSignal,
    recordDelivery,
    recordCiEvidence,
    recordHumanApproval,
    recordOverlapDecision,
    overlapsFor,
    semanticOverlapsFor,
    teamOverview,
    teamSyncState,
    saveTask,
  }
}
