// Постановка задачи: создание, критерии, scope, Module Change Plan и
// привязка workspace (§6, §39, §20).
//
// Выделен из tasks.js: только «что делаем и где», без переходов и доставки.

import { RuntimeError } from './errors.js'
import { assertId, generateId } from './ids.js'
import { appendAudit } from './audit.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import { normalizeClaims } from './claims.js'
import { TASKS, TASK_KINDS, actor, trimmedList } from './task-store.js'

const MAX_CRITERIA = 20
const MAX_CRITERION_LENGTH = 300
const MAX_AREAS = 50
const MAX_AREA_LENGTH = 200

export function createTaskPlanning({ store, roots, projects, taskStore, claims: claimsModule }) {
  const { getTask, saveTask } = taskStore
  const { overlapsFor } = claimsModule
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

  return { createTask, attachWorkspace, updateTask, setModulePlan }
}
