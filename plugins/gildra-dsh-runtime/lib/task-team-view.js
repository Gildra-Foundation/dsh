// Team view и синхронизация с провайдером (§12, §15, §20).
//
// Выделен из tasks.js: публикация санитизированных сводок, durable
// teamSync-состояние и объединённый обзор команды. Про переходы задач и
// claims здесь ничего нет.

import { appendAudit } from './audit.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import { sanitizeTaskSummary } from './team.js'
import { detectOverlaps } from './claims.js'
import { ACTIVE_TASK_STATUSES } from './task-store.js'

const TEAM_SYNC = 'team-sync'

export function createTaskTeamView({ store, roots, team, taskStore }) {
  const { listTasks } = taskStore
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
      ciFailures: active.filter(task => task.delivery?.ci?.conclusion === 'failure' || task.delivery?.ciConclusion === 'failure').map(task => task.taskId),
    }
  }

  return { recordTeamSync, teamSyncState, publishToTeam, teamOverview }
}
