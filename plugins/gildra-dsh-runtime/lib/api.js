// Версионированный loopback-API Gildra Runtime (/gildra/v1/*).
//
// Маршруты exact-типа (path-параметров у ctx.webServer нет): идентификаторы
// передаются в query/body и валидируются менеджерами. Мутации требуют
// same-origin и application/json; операции сессии — её owner-token.
// Произвольные shell-команды через API не выполняются. Ошибки — структурные
// (errors.js); UI никогда не парсит строки сообщений.

import { asRuntimeError } from './errors.js'
import { JsonStore } from './store.js'
import { runtimeRoots } from './paths.js'
import { appendAudit } from './audit.js'
import { createProjectRegistry } from './projects.js'
import { createLeaseManager } from './leases.js'
import { createProcessManager } from './processes.js'
import { createPortAllocator } from './ports.js'
import { createWorkspaceManager } from './workspaces.js'
import { createSessionManager } from './sessions.js'
import { createTaskManager } from './tasks.js'
import { agentContextBlock, renderRuntimeProfile, sessionEnvironment } from './runtime-env.js'

export const API_VERSION = 1

const MAX_BODY_BYTES = 64 * 1024

export function jsonResponse(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function errorResponse(res, error) {
  const runtimeError = asRuntimeError(error)
  jsonResponse(res, runtimeError.status, { ok: false, error: runtimeError.toJSON() })
}

export async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw asRuntimeError(new Error('Тело запроса слишком большое.'))
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw asRuntimeError(new Error('Некорректный JSON в запросе.'))
  }
}

export function sameOriginRequest(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function queryOf(req) {
  return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
}

// Собирает менеджеры Runtime поверх одного state-корня. Вынесено из apply(),
// чтобы тесты собирали весь стек без Harness.
export function createRuntime({ env = process.env } = {}) {
  const roots = runtimeRoots(env)
  const store = new JsonStore(roots.stateRoot, {
    onCorrupt: entry => void appendAudit(roots.stateRoot, 'store.corrupt', entry).catch(() => {}),
  })
  const projects = createProjectRegistry({ store, roots })
  const leases = createLeaseManager({ roots, env })
  const processes = createProcessManager({ store, roots })
  const ports = createPortAllocator({ store, env })
  const workspaces = createWorkspaceManager({ store, roots, projects, leases, processes, env })
  const sessions = createSessionManager({ store, roots, projects, workspaces, leases, processes, ports, env })
  const tasks = createTaskManager({ store, roots, projects })
  return { roots, store, projects, leases, processes, ports, workspaces, sessions, tasks }
}

export function registerRuntimeRoutes(ctx, runtime = createRuntime()) {
  const { projects, leases, processes, ports, workspaces, sessions, tasks } = runtime

  // Единый каркас маршрута: guard'ы + структурные ошибки в одном месте.
  function route(path, methods) {
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
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            if (!sameOriginRequest(req)) {
              jsonResponse(res, 403, { ok: false, error: { code: 'UNAUTHORIZED_SESSION', message: 'Операция разрешена только из приложения Gildra DSH.' } })
              return
            }
            if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
              jsonResponse(res, 415, { ok: false, error: { code: 'INVALID_INPUT', message: 'Тело запроса должно иметь тип application/json.' } })
              return
            }
          }
          const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readJsonBody(req)
          const result = await handlerFor({ req, body, query: queryOf(req) })
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
      GET: async () => ({ payload: { runtime: { apiVersion: API_VERSION, metrics: await operationalMetrics() } } }),
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

    route('/gildra/v1/merges/complete', {
      POST: async ({ body }) => ({ payload: { merge: await workspaces.completeMerge(body.mergeId) } }),
    }),

    route('/gildra/v1/merges/abort', {
      POST: async ({ body }) => ({ payload: { merge: await workspaces.abortMerge(body.mergeId) } }),
    }),

    route('/gildra/v1/tasks', {
      GET: async ({ query }) => ({ payload: { tasks: await tasks.listTasks({ projectId: query.get('projectId') ?? undefined }) } }),
      POST: async ({ body }) => ({ statusCode: 201, payload: { task: await tasks.createTask(body ?? {}) } }),
    }),

    route('/gildra/v1/tasks/update', {
      POST: async ({ body }) => ({ payload: { task: await tasks.updateTask(body.taskId, body) } }),
    }),

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
