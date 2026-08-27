// Маршруты слоя AI-качества поверх каркаса route() из api.js.
//
// Выделены из api.js по результату Modularity Analyzer на самом Gildra:
// fan-out 22 и «сборка Runtime + 30 маршрутов» в одном файле. api.js остаётся
// владельцем каркаса (guard'ы, идемпотентность, lifecycle-gate) и core-
// маршрутов; этот модуль знает только СВОИ маршруты качества/команды и
// получает менеджеры явно (§38: узкие зависимости, не общий context).

import { RuntimeError } from './errors.js'
import { dirtyFiles } from './gitx.js'

export function registerQualityRoutes(route, { projects, workspaces, tasks, repoIntel, quality, reviews, upstream, contextBuilder, team, capabilities }) {
  return [
  // --- Слой AI-качества (§65): repository intelligence, quality, review --

  route('/gildra/v1/repo/profile', {
    GET: async ({ query }) => ({ payload: { profile: await repoIntel.getProfile(query.get('projectId') ?? '', { refresh: query.get('refresh') === '1' }) } }),
  }),

  route('/gildra/v1/repo/commands/approve', {
    POST: async ({ body }) => ({ payload: { approved: await repoIntel.approveCommands(body.projectId, body.commands) } }),
  }),

  route('/gildra/v1/quality/policy', {
    POST: async ({ body }) => ({ payload: { policy: await quality.setPolicy(body.projectId, body.policy) } }),
    GET: async ({ query }) => ({ payload: { policy: quality.qualityPolicyOf(await projects.get(query.get('projectId') ?? '')) } }),
  }),

  route('/gildra/v1/tasks/attach', {
    POST: async ({ body }) => {
      const workspace = await workspaces.getRecord(body.workspaceId)
      // Dirty precondition (§39) считает сервер, а не доверяет клиенту.
      const dirty = await dirtyFiles(workspace.path)
      return {
        payload: {
          task: await tasks.attachWorkspace(body.taskId, {
            workspaceId: workspace.workspaceId,
            sessionId: workspace.sessionId,
            branch: workspace.branch,
            baseSha: workspace.baseSha,
            dirtyFiles: dirty,
            acceptDirty: body.acceptDirty === true,
          }),
        },
      }
    },
  }),

  route('/gildra/v1/repo/module-map', {
    GET: async ({ query }) => ({ payload: { moduleMap: await repoIntel.getModuleMap(query.get('projectId') ?? '', { refresh: query.get('refresh') === '1' }) } }),
  }),

  route('/gildra/v1/tasks/overlap-decision', {
    POST: async ({ body }) => ({ payload: { task: await tasks.recordOverlapDecision(body.taskId, body) } }),
  }),

  route('/gildra/v1/tasks/module-plan', {
    POST: async ({ body }) => ({ payload: { task: await tasks.setModulePlan(body.taskId, body.plan ?? body) } }),
  }),

  route('/gildra/v1/tasks/claims', {
    POST: async ({ body }) => ({ payload: await tasks.setClaims(body.taskId, body.claims, { confirmExclusiveOverlap: body.confirmExclusiveOverlap === true }) }),
  }),

  route('/gildra/v1/tasks/acknowledge', {
    POST: async ({ body }) => {
      // Актор проверяется ЗДЕСЬ: capability ревьюера → AI_REVIEWER;
      // явный human-флаг → HUMAN (внутри Unix-границы доверия);
      // иначе — writer, которому строгие сигналы гасить нельзя.
      let verifiedActor
      if (typeof body.capability === 'string') {
        // Сначала пробуем как reviewer-capability, затем как human-capability
        // на acknowledgment; слово «human: true» не значит ничего.
        verifiedActor = await reviews.actorForCapability(body.taskId, body.capability)
        if (!verifiedActor) {
          const human = await capabilities.consume(body.capability, {
            role: 'HUMAN_ADMIN', scope: 'human:ACKNOWLEDGE', taskId: body.taskId,
          }).catch(() => undefined)
          if (human) verifiedActor = { type: 'HUMAN', id: body.actorId }
        }
        if (!verifiedActor) {
          throw new RuntimeError('CAPABILITY_INVALID', 'Capability не соответствует ни review этой задачи, ни human-каналу.', { reason: 'SCOPE', taskId: body.taskId })
        }
      }
      return { payload: { task: await tasks.acknowledgeSignal(body.taskId, { ...body, verifiedActor }) } }
    },
  }),

  route('/gildra/v1/tasks/verify', {
    POST: async ({ body }) => ({ payload: { run: await quality.runVerification(body.taskId, { checkIds: body.checkIds }) } }),
    GET: async ({ query }) => ({ payload: { run: await quality.getVerification(query.get('runId') ?? '') } }),
  }),

  route('/gildra/v1/tasks/verify/cancel', {
    POST: async ({ body }) => ({ payload: { run: await quality.cancelVerification(body.runId) } }),
  }),

  route('/gildra/v1/tasks/regression', {
    POST: async ({ body }) => ({ payload: { task: await quality.recordRegression(body.taskId, body) } }),
  }),

  // Definition of Done: факты и блокеры (§49, §66).
  route('/gildra/v1/tasks/quality', {
    GET: async ({ query }) => ({ payload: { quality: await quality.readiness(query.get('taskId') ?? '') } }),
  }),

  // Единственный путь в READY_FOR_HUMAN_REVIEW.
  route('/gildra/v1/tasks/promote', {
    POST: async ({ body }) => ({ payload: { task: await quality.promoteIfReady(body.taskId) } }),
  }),

  route('/gildra/v1/tasks/context', {
    GET: async ({ query }) => ({ payload: { context: await contextBuilder.buildTaskContext(query.get('taskId') ?? '') } }),
  }),

  route('/gildra/v1/tasks/upstream', {
    POST: async ({ body }) => ({ payload: { upstream: await upstream.assessUpstream(body.taskId) } }),
  }),

  route('/gildra/v1/tasks/delivery', {
    POST: async ({ body }) => ({ payload: { task: await tasks.recordDelivery(body.taskId, body) } }),
  }),

  // CI-факты — только от доверенной интеграции (§7 плана authority):
  // многоразовая TRUSTED_INTEGRATION-capability выдаётся при настройке
  // интеграции интерактивным каналом; JSON-поля сами ничего не доказывают.
  route('/gildra/v1/tasks/ci-evidence', {
    POST: async ({ body }) => {
      const task = await tasks.getTask(body.taskId)
      const integration = await capabilities.verify(body.capability, {
        role: 'TRUSTED_INTEGRATION',
        scope: 'ci-evidence',
        projectId: task.projectId,
      })
      return {
        payload: {
          task: await tasks.recordCiEvidence(body.taskId, {
            ...body,
            verifiedIntegration: { provider: integration.entityId ?? 'github' },
          }),
        },
      }
    },
  }),

  route('/gildra/v1/tasks/human-approval', {
    POST: async ({ body }) => {
      // §6: одноразовая HumanActionCapability, scoped на действие и задачу,
      // привязанная к текущему HEAD. Issue-канала в /gildra/v1 нет — его
      // вызывает интерактивный слой приложения.
      const current = await tasks.getTask(body.taskId)
      await capabilities.consume(body.capability, {
        role: 'HUMAN_ADMIN',
        scope: `human:${String(body.kind ?? '')}`,
        taskId: body.taskId,
        ...(current.analysis?.headSha ? { headSha: current.analysis.headSha } : {}),
      })
      return { payload: { task: await tasks.recordHumanApproval(body.taskId, { ...body, verifiedHuman: true }) } }
    },
  }),

  route('/gildra/v1/reviews/request', {
    POST: async ({ body }) => ({ statusCode: 201, payload: await reviews.requestReview(body.taskId, body) }),
  }),

  // Claim: capability получает только держатель owner-token reviewer-сессии.
  route('/gildra/v1/reviews/claim', {
    POST: async ({ body }) => ({ payload: await reviews.claimReview(body.reviewId, { sessionId: body.sessionId, ownerToken: body.ownerToken }) }),
  }),

  route('/gildra/v1/reviews/submit', {
    POST: async ({ body }) => ({ payload: { review: await reviews.submitReview(body.reviewId, body) } }),
  }),

  route('/gildra/v1/reviews', {
    GET: async ({ query }) => ({ payload: { review: await reviews.getReview(query.get('reviewId') ?? '') } }),
  }),

  route('/gildra/v1/team', {
    GET: async ({ query }) => ({
      payload: {
        team: await tasks.teamOverview(query.get('projectId') ?? undefined),
        provider: team?.backend,
      },
    }),
  }),
  ]
}
