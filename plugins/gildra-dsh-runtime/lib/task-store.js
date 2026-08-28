// Task Store: durable-доступ к записям задач и общие валидаторы полей.
//
// Выделен из tasks.js (§20 плана authority). Узкая ответственность:
// get/list/save и примитивы валидации — никакой бизнес-логики переходов,
// claims или доставки.

import { RuntimeError } from './errors.js'
import { assertId } from './ids.js'

export const TASKS = 'tasks'

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

export function trimmedList(raw, { max, maxLength, label }) {
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

export function actor(raw) {
  return raw === undefined || raw === null ? undefined : String(raw).slice(0, 100)
}

export function createTaskStore({ store }) {
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
  async function saveTask(record) {
    const updated = { ...record, updatedAt: new Date().toISOString() }
    await store.write(TASKS, record.taskId, updated)
    return updated
  }

  // Смена статуса с guard'ами. READY_FOR_HUMAN_REVIEW сюда не пускаем ни при
  // каких условиях: этот статус ставит только quality-gate, у которого есть
  // evidence (promoteIfReady в quality.js) — иначе «готово» снова стало бы
  // словом, а не фактом.

  return { getTask, listTasks, saveTask }
}
