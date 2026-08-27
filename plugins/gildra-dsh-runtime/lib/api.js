// Версионированный loopback-API Gildra Runtime (/gildra/v1/*).
//
// Маршруты exact-типа (path-параметров у ctx.webServer нет): идентификаторы
// передаются в query/body и валидируются менеджерами. Мутации требуют
// same-origin и application/json; операции сессии — её owner-token.
// Произвольные shell-команды через API не выполняются. Ошибки — структурные
// (errors.js); UI никогда не парсит строки сообщений.

import { join } from 'node:path'

import { createLifecycle } from './lifecycle.js'
import { createJournal } from './journal.js'
import {
  assertMutationRequest,
  createIdempotencyCache,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from './http.js'
import { JsonStore } from './store.js'
import { runtimeRoots } from './paths.js'
import { appendAudit } from './audit.js'
import { setManagedHooksPath } from './gitx.js'
import { createProjectRegistry } from './projects.js'
import { createLeaseManager } from './leases.js'
import { createProcessManager } from './processes.js'
import { createPortAllocator } from './ports.js'
import { createWorkspaceManager } from './workspaces.js'
import { createSessionManager } from './sessions.js'
import { createTaskManager } from './tasks.js'
import { createRepoIntel } from './repo-intel.js'
import { createTeamProvider } from './team.js'
import { createQualityManager } from './quality.js'
import { createReviewManager } from './review.js'
import { createUpstreamMonitor } from './upstream.js'
import { createContextBuilder } from './context-builder.js'
import { registerQualityRoutes } from './api-quality-routes.js'
import { createCapabilityStore } from './capabilities.js'
import { agentContextBlock, renderRuntimeProfile, sessionEnvironment } from './runtime-env.js'

export const API_VERSION = 1
// Версия реализации Runtime отдельно от версии API: UI понимает
// совместимость, даже когда контракт не менялся, а поведение — да.
export const RUNTIME_VERSION = 3

function queryOf(req) {
  return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
}

// Собирает менеджеры Runtime поверх одного state-корня. Вынесено из apply(),
// чтобы тесты собирали весь стек без Harness.
export function createRuntime({ env = process.env } = {}) {
  const roots = runtimeRoots(env)
  // Каталог hooks для managed-git внутри нашего 0700 state-корня: подложить
  // туда hook может только сам пользователь, то есть внутри границы доверия.
  setManagedHooksPath(join(roots.stateRoot, 'no-hooks'))
  const store = new JsonStore(roots.stateRoot, {
    onCorrupt: entry => void appendAudit(roots.stateRoot, 'store.corrupt', entry).catch(() => {}),
  })
  const projects = createProjectRegistry({ store, roots })
  const leases = createLeaseManager({ roots, env })
  const processes = createProcessManager({ store, roots })
  const ports = createPortAllocator({ store, env })
  const journal = createJournal({ roots })
  const workspaces = createWorkspaceManager({ store, roots, projects, leases, processes, journal, env })
  const sessions = createSessionManager({ store, roots, projects, workspaces, leases, processes, ports, journal, env })
  // Слой AI-качества (docs/ai-quality.md, docs/modularity.md): порядок
  // создания отражает зависимости — intel и team нужны задачам для overlap.
  const repoIntel = createRepoIntel({ store, roots, projects })
  const team = createTeamProvider({ env, roots })
  const capabilities = createCapabilityStore({ store, roots })
  const tasks = createTaskManager({ store, roots, projects, team, repoIntel })
  const quality = createQualityManager({ store, roots, projects, tasks, workspaces, processes, repoIntel })
  const reviews = createReviewManager({ store, roots, projects, tasks, workspaces, sessions, leases, capabilities, repoIntel })
  const upstream = createUpstreamMonitor({ roots, projects, tasks })
  const contextBuilder = createContextBuilder({ projects, tasks, workspaces, sessions, repoIntel, upstream })
  const lifecycle = createLifecycle({ roots, store, sessions, projects })
  return { roots, store, projects, leases, processes, ports, workspaces, sessions, tasks, repoIntel, team, capabilities, quality, reviews, upstream, contextBuilder, lifecycle }
}

export function registerRuntimeRoutes(ctx, runtime = createRuntime()) {
  const { store, projects, leases, processes, ports, workspaces, sessions, tasks, repoIntel, quality, reviews, upstream, contextBuilder, lifecycle } = runtime
  const idempotency = createIdempotencyCache()

  // Единый каркас маршрута: guard'ы + структурные ошибки в одном месте.
  // mutating: требует loopback-origin, JSON и готовности Runtime.
  // idempotent: повтор с тем же Idempotency-Key возвращает первый результат.
  function route(path, methods, { mutating = true } = {}) {
    return ctx.webServer.register({
      kind: 'exact',
      path,
      async handler(req, res) {
        const handlerFor = methods[req.method]
        if (!handlerFor) {
          jsonResponse(res, 405, { ok: false, error: { code: 'INVALID_INPUT', message: 'Метод не поддерживается.' } })
          return
        }
        try {
          const isRead = req.method === 'GET' || req.method === 'HEAD'
          let body = {}
          if (!isRead) {
            assertMutationRequest(req)
            // Мутации не принимаются, пока не завершено первичное
            // сверение state с диском: иначе решение принималось бы по
            // заведомо неполной картине.
            lifecycle?.assertReady()
            body = await readJsonBody(req)
          }
          const key = isRead ? undefined : idempotency.keyOf(req, path)
          const cached = idempotency.get(key)
          const result = cached
            ? await cached
            : await idempotency.remember(key, handlerFor({ req, body, query: queryOf(req) }))
          jsonResponse(res, result?.statusCode ?? 200, { ok: true, ...result?.payload })
        } catch (error) {
          errorResponse(res, error)
        }
      },
    })
  }

  async function enrichedWorkspaces(projectId) {
    const rows = []
    for (const record of await workspaces.listRecords(projectId ? { projectId } : {})) {
      try {
        rows.push(await workspaces.workspaceStatus(record.workspaceId))
      } catch {
        rows.push({ ...record, worktreePresent: false })
      }
    }
    return rows
  }

  async function operationalMetrics() {
    const allSessions = await sessions.listSessions({})
    const active = allSessions.filter(record => ['ACTIVE', 'IDLE', 'TESTING', 'REVIEWING', 'MERGING'].includes(record.status))
    const orphaned = allSessions.filter(record => record.status === 'ORPHANED')
    let running = 0
    for (const record of active) running += (await processes.listForSession(record.sessionId)).length
    return {
      activeSessions: active.length,
      orphanedSessions: orphaned.length,
      workspaces: (await workspaces.listRecords()).length,
      runningProcesses: running,
    }
  }

  const disposers = [
    route('/gildra/v1/runtime', {
      GET: async () => ({ payload: { runtime: { apiVersion: API_VERSION, runtimeVersion: RUNTIME_VERSION, state: lifecycle?.state, metrics: await operationalMetrics() } } }),
    }),

    // Health доступен всегда, даже пока Runtime восстанавливается: именно по
    // нему клиент отличает «ещё не готов» от «сломан».
    route('/gildra/v1/health', {
      GET: async () => {
        const snapshot = lifecycle?.snapshot() ?? { state: 'READY' }
        return {
          payload: {
            health: {
              runtime: snapshot.state,
              ready: snapshot.state === 'READY',
              apiVersion: API_VERSION,
              runtimeVersion: RUNTIME_VERSION,
              ...(snapshot.error ? { error: snapshot.error } : {}),
            },
          },
        }
      },
    }),

    // Возможности объявляются явно: overlay не должен угадывать их по
    // наличию отдельных маршрутов и ломаться при рассинхроне версий.
    route('/gildra/v1/capabilities', {
      GET: async () => ({
        payload: {
          apiVersion: API_VERSION,
          runtimeVersion: RUNTIME_VERSION,
          features: {
            workspaces: true,
            sessions: true,
            leases: true,
            fencing: true,
            merges: true,
            tasks: true,
            repositoryIntelligence: true,
            qualityPipeline: true,
            reviews: true,
            teamClaims: true,
            upstreamAwareness: true,
            ports: true,
            processes: true,
            recovery: true,
            idempotency: true,
            diagnostics: true,
          },
        },
      }),
    }),

    // Диагностика — только чтение и без секретов: ни owner-token, ни env.
    route('/gildra/v1/diagnostics', {
      GET: async () => {
        const snapshot = lifecycle?.snapshot() ?? {}
        const openOperations = await sessions.operations.listOpen()
        return {
          payload: {
            diagnostics: {
              apiVersion: API_VERSION,
              runtimeVersion: RUNTIME_VERSION,
              state: snapshot.state,
              startedAt: snapshot.startedAt,
              git: snapshot.git,
              metrics: await operationalMetrics(),
              projects: (await projects.list()).map(project => ({
                projectId: project.projectId,
                defaultBranch: project.defaultBranch,
                origin: project.origin?.type,
              })),
              unfinishedOperations: openOperations.map(operation => ({
                operationId: operation.operationId,
                type: operation.type,
                phase: operation.phase,
                startedAt: operation.startedAt,
              })),
              corruptions: typeof store.corruptions === 'function'
                ? store.corruptions().map(entry => ({ collection: entry.collection, id: entry.id, critical: entry.critical }))
                : [],
              selfCheck: await lifecycle?.selfCheck(),
            },
          },
        }
      },
    }),

    route('/gildra/v1/projects', {
      GET: async () => ({ payload: { projects: await projects.list() } }),
      POST: async ({ body }) => ({ statusCode: 201, payload: { project: await projects.register(body) } }),
    }),

    route('/gildra/v1/workspaces', {
      GET: async ({ query }) => ({ payload: { workspaces: await enrichedWorkspaces(query.get('projectId') ?? undefined) } }),
    }),

    route('/gildra/v1/workspaces/plan', {
      GET: async ({ query }) => ({ payload: { plan: await workspaces.cleanupPlan(query.get('id') ?? '') } }),
    }),

    route('/gildra/v1/sessions', {
      GET: async ({ query }) => ({
        payload: {
          sessions: await sessions.listSessions({
            projectId: query.get('projectId') ?? undefined,
            activeOnly: query.get('activeOnly') === '1',
          }),
        },
      }),
      POST: async ({ body }) => {
        const created = await sessions.createSession(body ?? {})
        return { statusCode: 201, payload: { ...created } }
      },
    }),

    route('/gildra/v1/sessions/heartbeat', {
      POST: async ({ body }) => ({ payload: await sessions.heartbeat(body.sessionId, body.ownerToken) }),
    }),

    route('/gildra/v1/sessions/transition', {
      POST: async ({ body }) => ({ payload: await sessions.transition(body.sessionId, body.ownerToken, body.status) }),
    }),

    route('/gildra/v1/sessions/recover', {
      POST: async ({ body }) => ({ payload: await sessions.recoverSession(body.sessionId) }),
    }),

    route('/gildra/v1/sessions/cleanup', {
      POST: async ({ body }) => ({
        payload: await sessions.cleanupSession(body.sessionId, {
          ownerToken: body.ownerToken,
          confirmDirty: body.confirmDirty === true,
          confirmUnmerged: body.confirmUnmerged === true,
        }),
      }),
    }),

    route('/gildra/v1/context', {
      GET: async ({ query }) => {
        const session = await sessions.getSession(query.get('sessionId') ?? '')
        const workspace = session.workspaceId ? await workspaces.getRecord(session.workspaceId) : undefined
        const project = await projects.get(session.projectId)
        const portLeases = await ports.listForSession(session.sessionId)
        const environment = workspace
          ? sessionEnvironment({ session, workspace, ports: portLeases })
          : {}
        return {
          payload: {
            context: workspace ? agentContextBlock({ session, workspace, project }) : undefined,
            environment,
            runtimeProfile: renderRuntimeProfile(project.runtimeProfile, environment),
          },
        }
      },
    }),

    route('/gildra/v1/merges', {
      GET: async ({ query }) => ({ payload: { merge: await workspaces.getMerge(query.get('id') ?? '') } }),
      POST: async ({ body }) => ({ statusCode: 201, payload: { merge: await workspaces.startMerge(body ?? {}) } }),
    }),

    route('/gildra/v1/merges/list', {
      GET: async ({ query }) => ({
        payload: {
          merges: await workspaces.listMerges({
            projectId: query.get('projectId') ?? undefined,
            activeOnly: query.get('activeOnly') === '1',
          }),
        },
      }),
    }),

    route('/gildra/v1/merges/complete', {
      POST: async ({ body }) => ({ payload: { merge: await workspaces.completeMerge(body.mergeId) } }),
    }),

    route('/gildra/v1/merges/abort', {
      POST: async ({ body }) => ({ payload: { merge: await workspaces.abortMerge(body.mergeId) } }),
    }),

    route('/gildra/v1/tasks', {
      GET: async ({ query }) => ({ payload: { tasks: await tasks.listTasks({ projectId: query.get('projectId') ?? undefined }) } }),
      POST: async ({ body }) => {
        const created = await tasks.createTask(body ?? {})
        return { statusCode: 201, payload: { task: created.task, overlaps: created.overlaps } }
      },
    }),

    route('/gildra/v1/tasks/update', {
      POST: async ({ body }) => {
        // Смена статуса идёт через transition с его guard'ами (READY только
        // через quality-gate); остальные поля — обычное обновление.
        if (body.status !== undefined) await tasks.transition(body.taskId, body.status, body)
        return { payload: { task: await tasks.updateTask(body.taskId, body) } }
      },
    }),

    // Маршруты слоя качества — в собственном модуле (см. его шапку).
    ...registerQualityRoutes(route, { projects, workspaces, tasks, repoIntel, quality, reviews, upstream, contextBuilder, team: runtime.team, capabilities: runtime.capabilities }),

    route('/gildra/v1/recovery/scan', {
      POST: async () => ({ payload: { report: await sessions.scanForRecovery() } }),
    }),

    route('/gildra/v1/leases/state', {
      GET: async ({ query }) => ({ payload: { lease: await leases.stateOf(query.get('workspaceId') ?? '') } }),
    }),
  ]

  return () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose()
    }
  }
}
