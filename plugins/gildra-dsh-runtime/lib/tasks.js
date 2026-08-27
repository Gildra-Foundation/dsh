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
import { detectOverlaps, normalizeClaims } from './claims.js'

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

// Сигналы diff-анализа, требующие явного объяснения (§37, §19, §21, §12).
export const ACKNOWLEDGEABLE_SIGNALS = Object.freeze([
  'TEST_WEAKENING', 'UNEXPECTED_CHANGE', 'PROTECTED_AREA_CHANGE',
  'DEPENDENCY_CHANGE', 'GENERATED_FILE_EDIT', 'BACKWARD_COMPATIBILITY',
  'UPSTREAM_RELEVANT',
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

export function createTaskManager({ store, roots, projects }) {
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

  // Пересечение claims/файлов кандидата с чужими активными задачами проекта.
  async function overlapsFor(projectId, { claims = [], files = [], excludeTaskId } = {}) {
    const others = (await listTasks({ projectId, activeOnly: true }))
      .filter(record => record.taskId !== excludeTaskId)
      .map(record => ({ taskId: record.taskId, owner: record.owner, claims: record.claims ?? [] }))
    return detectOverlaps({ claims, files }, others)
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
    // Возврат в работу очищает причины прошлой остановки.
    if (status === 'IMPLEMENTING' || status === 'FIXING_REVIEW') {
      delete record.blockReason
      delete record.failureKind
    }
    record.status = status
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.transition', { taskId, status, ...(failureKind ? { failureKind } : {}) })
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

  // Явное объяснение сигнала diff-анализа (§37): молча сигнал не гаснет.
  async function acknowledgeSignal(taskId, { signal, explanation }) {
    const record = await getTask(taskId)
    if (!ACKNOWLEDGEABLE_SIGNALS.includes(signal)) {
      throw new RuntimeError('INVALID_INPUT', `Неизвестный сигнал «${String(signal)}».`, { allowed: ACKNOWLEDGEABLE_SIGNALS })
    }
    if (typeof explanation !== 'string' || explanation.trim().length < 10) {
      throw new RuntimeError('INVALID_INPUT', 'Объяснение сигнала обязано быть содержательным (минимум 10 символов).')
    }
    record.acknowledgments = [
      ...record.acknowledgments.filter(entry => entry.signal !== signal),
      { signal, explanation: explanation.trim().slice(0, 1000), at: new Date().toISOString() },
    ]
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.signal.acknowledged', { taskId, signal })
    return updated
  }

  // Доставка (§42–§44): PR и CI-факты. Runtime не ходит в GitHub сам — он
  // валидирует и хранит то, что сообщает агент/интеграция, и ограничивает
  // число CI-автопочинок, чтобы не было бесконечного цикла.
  async function recordDelivery(taskId, { mode, prUrl, prNumber, ciStatus, branchPushed }) {
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
    if (ciStatus !== undefined) {
      if (!['PENDING', 'PASSED', 'FAILED'].includes(ciStatus)) {
        throw new RuntimeError('INVALID_INPUT', 'ciStatus: PENDING, PASSED или FAILED.')
      }
      delivery.ciStatus = ciStatus
      if (ciStatus === 'FAILED') {
        delivery.ciFixAttempts = (delivery.ciFixAttempts ?? 0) + 1
        record.failureKind = 'CI'
        // Ограниченный CI-цикл (§44): после лимита задача останавливается и
        // ждёт человека, а не чинит CI вечно.
        if (delivery.ciFixAttempts > DEFAULT_CI_FIX_LIMIT) {
          record.status = 'BLOCKED'
          record.blockReason = `CI падал ${String(delivery.ciFixAttempts)} раз подряд — автоматические починки исчерпаны, нужен человек.`
        }
      }
      if (ciStatus === 'PASSED') delete record.failureKind
    }
    record.delivery = delivery
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.delivery', { taskId, ...(ciStatus ? { ciStatus } : {}), ...(delivery.prNumber ? { prNumber: delivery.prNumber } : {}) })
    return updated
  }

  // Обзор команды (§29, §47): активные задачи по людям и агентам, пересечения,
  // ожидающие ревью и CI-падения — данные для Team View.
  async function teamOverview(projectId) {
    const active = await listTasks({ projectId, activeOnly: true })
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
    getTask,
    listTasks,
    updateTask,
    transition,
    attachWorkspace,
    setClaims,
    acknowledgeSignal,
    recordDelivery,
    overlapsFor,
    teamOverview,
    saveTask,
  }
}
