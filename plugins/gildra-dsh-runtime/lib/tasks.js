// Минимальная модель Task: логическая единица работы, связывающая сессии,
// агентов и воркспейсы. Не Jira: ровно столько, чтобы UI мог показать
// «Task → Plan → Implementation → Tests → Review → Merge» и чтобы работа ИИ
// перестала быть россыпью несвязанных чатов. Название задачи — данные
// (хранится как есть), в имена веток/путей попадают только безопасные id.

import { RuntimeError } from './errors.js'
import { assertId, generateId } from './ids.js'
import { appendAudit } from './audit.js'

const TASKS = 'tasks'

export const TASK_STATUSES = Object.freeze([
  'PLANNED', 'IN_PROGRESS', 'TESTING', 'REVIEW', 'READY', 'MERGED', 'FAILED',
])

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
      rows.push(record)
    }
    return rows
  }

  async function createTask({ projectId, title, baseBranch, owner }) {
    const project = await projects.get(projectId)
    if (typeof title !== 'string' || title.trim() === '' || title.length > 300) {
      throw new RuntimeError('INVALID_INPUT', 'Название задачи должно быть непустой строкой до 300 символов.')
    }
    const taskId = generateId('task')
    const record = {
      schemaVersion: 1,
      taskId,
      projectId,
      title: title.trim(),
      baseBranch: baseBranch ?? project.defaultBranch,
      owner: owner ? String(owner).slice(0, 100) : undefined,
      status: 'PLANNED',
      sessions: [],
      agents: [],
      workspaces: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await store.write(TASKS, taskId, record)
    await appendAudit(roots.stateRoot, 'task.created', { taskId, projectId })
    return record
  }

  async function updateTask(taskId, { status, linkSession, linkWorkspace, linkAgent, result } = {}) {
    const record = await getTask(taskId)
    if (status !== undefined) {
      if (!TASK_STATUSES.includes(status)) {
        throw new RuntimeError('INVALID_INPUT', `Недопустимый статус задачи «${String(status)}».`, { allowed: TASK_STATUSES })
      }
      record.status = status
    }
    if (linkSession) record.sessions = [...new Set([...record.sessions, assertId(linkSession, 'sessionId')])]
    if (linkWorkspace) record.workspaces = [...new Set([...record.workspaces, assertId(linkWorkspace, 'workspaceId')])]
    if (linkAgent) record.agents = [...new Set([...record.agents, String(linkAgent).slice(0, 100)])]
    if (result !== undefined) record.result = String(result).slice(0, 2000)
    record.updatedAt = new Date().toISOString()
    await store.write(TASKS, record.taskId, record)
    return record
  }

  return { createTask, getTask, listTasks, updateTask }
}
