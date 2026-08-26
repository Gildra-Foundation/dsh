// Тесты API /gildra/v1/*: проводка apply(), guard'ы same-origin/content-type,
// owner-token, структурные ошибки и основной пользовательский поток
// (проект → сессия → workspace → merge → cleanup) через HTTP-обвязку.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, ISOLATION_RULES } from '../lib/index.js'
import { createRuntime, registerRuntimeRoutes } from '../lib/api.js'
import { commitAll, git } from '../lib/gitx.js'

function makeCtx() {
  const sections = []
  const guards = []
  const routes = new Map()
  return {
    sections,
    guards,
    routes,
    systemPrompt: { section(value) { sections.push(value); return () => {} } },
    tools: { guard(value) { guards.push(value); return () => {} } },
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
    effect(callback) { callback() },
  }
}

function requestFor({ method = 'GET', url = '/', body, origin, contentType = 'application/json' } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: {
      ...(origin ? { origin } : {}),
      ...(method === 'GET' ? {} : { 'content-type': contentType }),
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

async function call(route, request) {
  const response = {
    status: 0,
    body: undefined,
    writeHead(status) { this.status = status },
    end(payload) { this.body = payload ? JSON.parse(payload) : undefined },
  }
  await route.handler(request, response)
  return response
}

// --- apply(): проводка секций, guard'а и маршрутов ------------------------
{
  const ctx = makeCtx()
  apply(ctx)
  assert.ok(ctx.sections.some(section => section.name === 'gildra:workspace-isolation'))
  assert.equal(ctx.guards.length, 1)
  assert.ok(ISOLATION_RULES.includes('merge workflow'))
  for (const path of ['/gildra/v1/runtime', '/gildra/v1/projects', '/gildra/v1/sessions', '/gildra/v1/merges', '/gildra/v1/tasks']) {
    assert.ok(ctx.routes.has(path), `маршрут ${path} должен быть зарегистрирован`)
  }
}

// --- Основной поток через API ---------------------------------------------
const base = await mkdtemp(join(tmpdir(), 'gildra api '))
const runtime = createRuntime({ env: { GILDRA_DSH_STATE_DIR: join(base, 'state') } })
const ctx = makeCtx()
registerRuntimeRoutes(ctx, runtime)
const routeOf = path => ctx.routes.get(path)

// Проект.
const seed = join(base, 'seed')
await git(['init', '-b', 'main', seed])
await writeFile(join(seed, 'app.txt'), 'v1\n')
await commitAll(seed, 'initial', { name: 'Seed', email: 'seed@test' })
const canonical = join(base, 'repos', 'demo.git')
await git(['clone', '--bare', seed, canonical])

{
  const created = await call(routeOf('/gildra/v1/projects'), requestFor({
    method: 'POST',
    body: { projectId: 'demo', path: canonical },
  }))
  assert.equal(created.status, 201)
  assert.equal(created.body.ok, true)
  assert.equal(created.body.project.defaultBranch, 'main')

  const listed = await call(routeOf('/gildra/v1/projects'), requestFor({}))
  assert.equal(listed.body.projects.length, 1)
}

// Guard'ы мутаций: чужой origin и не-JSON отклоняются структурно.
{
  const foreign = await call(routeOf('/gildra/v1/projects'), requestFor({
    method: 'POST',
    origin: 'https://evil.example',
    body: { projectId: 'evil', path: canonical },
  }))
  assert.equal(foreign.status, 403)
  assert.equal(foreign.body.error.code, 'UNAUTHORIZED_SESSION')

  const notJson = await call(routeOf('/gildra/v1/projects'), requestFor({
    method: 'POST',
    contentType: 'text/plain',
    body: { projectId: 'x', path: canonical },
  }))
  assert.equal(notJson.status, 415)
  assert.equal(notJson.body.error.code, 'INVALID_INPUT')

  const badMethod = await call(routeOf('/gildra/v1/workspaces'), requestFor({ method: 'DELETE' }))
  assert.equal(badMethod.status, 405)
}

// Сессия + workspace + контекст агента.
let session
let ownerToken
{
  const created = await call(routeOf('/gildra/v1/sessions'), requestFor({
    method: 'POST',
    origin: 'http://127.0.0.1:3080',
    body: { projectId: 'demo', userId: 'alex', title: 'API session' },
  }))
  assert.equal(created.status, 201)
  session = created.body.session
  ownerToken = created.body.ownerToken
  assert.equal(session.status, 'ACTIVE')
  assert.ok(ownerToken)
  assert.equal(created.body.environment.GILDRA_MODE, 'WRITE')

  const workspacesList = await call(routeOf('/gildra/v1/workspaces'), requestFor({ url: '/gildra/v1/workspaces?projectId=demo' }))
  assert.equal(workspacesList.body.workspaces.length, 1)
  assert.equal(workspacesList.body.workspaces[0].lease.state, 'ACTIVE')
  assert.equal(workspacesList.body.workspaces[0].dirtyFiles, 0)

  const context = await call(routeOf('/gildra/v1/context'), requestFor({ url: `/gildra/v1/context?sessionId=${session.sessionId}` }))
  assert.match(context.body.context, /Never switch branch/)
  assert.equal(context.body.environment.PORT, String(session.ports.app))

  const heartbeat = await call(routeOf('/gildra/v1/sessions/heartbeat'), requestFor({
    method: 'POST',
    body: { sessionId: session.sessionId, ownerToken },
  }))
  assert.equal(heartbeat.status, 200)

  const wrongToken = await call(routeOf('/gildra/v1/sessions/transition'), requestFor({
    method: 'POST',
    body: { sessionId: session.sessionId, ownerToken: 'wrong', status: 'TESTING' },
  }))
  assert.equal(wrongToken.status, 403)
  assert.equal(wrongToken.body.error.code, 'UNAUTHORIZED_SESSION')

  const missing = await call(routeOf('/gildra/v1/context'), requestFor({ url: '/gildra/v1/context?sessionId=sess-none' }))
  assert.equal(missing.status, 404)
  assert.equal(missing.body.error.code, 'SESSION_NOT_FOUND')
}

// Merge через API: коммит в workspace → чистое объединение в main.
{
  const workspace = await runtime.workspaces.getRecord(session.workspaceId)
  await writeFile(join(workspace.path, 'app.txt'), 'v2 from session\n')
  await commitAll(workspace.path, 'session change', { name: 'Alex', email: 'alex@test' })

  const merge = await call(routeOf('/gildra/v1/merges'), requestFor({
    method: 'POST',
    body: { projectId: 'demo', sourceBranch: workspace.branch },
  }))
  assert.equal(merge.status, 201)
  assert.equal(merge.body.merge.status, 'completed')
  const { stdout } = await git(['-C', canonical, 'show', 'main:app.txt'])
  assert.equal(stdout, 'v2 from session\n')

  const fetched = await call(routeOf('/gildra/v1/merges'), requestFor({ url: `/gildra/v1/merges?id=${merge.body.merge.mergeId}` }))
  assert.equal(fetched.body.merge.status, 'completed')
}

// Задачи: create/list/update и структурная ошибка недопустимого статуса.
{
  const created = await call(routeOf('/gildra/v1/tasks'), requestFor({
    method: 'POST',
    body: { projectId: 'demo', title: 'Add Battle.net OAuth' },
  }))
  assert.equal(created.status, 201)
  const task = created.body.task
  assert.equal(task.status, 'PLANNED')

  const updated = await call(routeOf('/gildra/v1/tasks/update'), requestFor({
    method: 'POST',
    body: { taskId: task.taskId, status: 'IN_PROGRESS', linkSession: session.sessionId, linkAgent: 'implementation' },
  }))
  assert.equal(updated.body.task.status, 'IN_PROGRESS')
  assert.deepEqual(updated.body.task.sessions, [session.sessionId])

  const invalid = await call(routeOf('/gildra/v1/tasks/update'), requestFor({
    method: 'POST',
    body: { taskId: task.taskId, status: 'NOPE' },
  }))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.error.code, 'INVALID_INPUT')

  const listed = await call(routeOf('/gildra/v1/tasks'), requestFor({ url: '/gildra/v1/tasks?projectId=demo' }))
  assert.equal(listed.body.tasks.length, 1)
}

// Метрики, recovery-скан, состояние lease, cleanup через API.
{
  const metrics = await call(routeOf('/gildra/v1/runtime'), requestFor({}))
  assert.equal(metrics.body.runtime.apiVersion, 1)
  assert.ok(metrics.body.runtime.metrics.activeSessions >= 1)

  const scan = await call(routeOf('/gildra/v1/recovery/scan'), requestFor({ method: 'POST', body: {} }))
  assert.deepEqual(Object.keys(scan.body.report).sort(), ['adoptableWorktrees', 'missingWorkspaces', 'orphaned'])

  const leaseState = await call(routeOf('/gildra/v1/leases/state'), requestFor({ url: `/gildra/v1/leases/state?workspaceId=${session.workspaceId}` }))
  assert.equal(leaseState.body.lease.state, 'ACTIVE')

  // Анонимный dry-run честно показывает собственный активный lease как
  // причину: снять его может только владелец токена (cleanup ниже).
  const plan = await call(routeOf('/gildra/v1/workspaces/plan'), requestFor({ url: `/gildra/v1/workspaces/plan?id=${session.workspaceId}` }))
  assert.equal(plan.body.plan.removable, false)
  assert.deepEqual(plan.body.plan.reasons.map(reason => reason.code), ['WORKSPACE_LOCKED'])

  const cleanup = await call(routeOf('/gildra/v1/sessions/cleanup'), requestFor({
    method: 'POST',
    body: { sessionId: session.sessionId, ownerToken },
  }))
  assert.equal(cleanup.status, 200)
  assert.equal(cleanup.body.completed, true)

  const after = await call(routeOf('/gildra/v1/workspaces'), requestFor({ url: '/gildra/v1/workspaces?projectId=demo' }))
  assert.equal(after.body.workspaces.length, 0)
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime API tests passed.')
