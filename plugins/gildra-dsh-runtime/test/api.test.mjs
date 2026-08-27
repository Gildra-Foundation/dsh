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

// UI всегда шлёт loopback Origin и Host — так же делает и тест. Отсутствие
// заголовков проверяется отдельными негативными кейсами.
function requestFor({
  method = 'GET', url = '/', body, origin = 'http://127.0.0.1:3080',
  host = '127.0.0.1:3080', contentType = 'application/json', idempotencyKey,
} = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: {
      ...(host ? { host } : {}),
      ...(origin ? { origin } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
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

// Мутации не принимаются, пока Runtime не завершил первичное восстановление.
{
  const early = await call(routeOf('/gildra/v1/projects'), requestFor({
    method: 'POST', body: { projectId: 'early', path: '/tmp' },
  }))
  assert.equal(early.status, 503)
  assert.equal(early.body.error.code, 'RUNTIME_NOT_READY')
  const health = await call(routeOf('/gildra/v1/health'), requestFor({}))
  assert.equal(health.body.health.ready, false, 'health доступен до готовности')
}
await runtime.lifecycle.boot()
assert.equal(runtime.lifecycle.state, 'READY')

// Проект.
const seed = join(base, 'seed')
await git(['init', '-b', 'main', seed])
await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
await writeFile(join(seed, 'app.txt'), 'v1\n')
await commitAll(seed, 'initial', { name: 'Seed', email: 'seed@test' })
const canonical = join(base, 'repos', 'demo.git')
await git(['clone', '--bare', seed, canonical])
await git(['-C', canonical, 'config', 'core.autocrlf', 'false'])

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

  // Мутация без Origin приходит не из браузера-UI: тоже отклоняется.
  const noOrigin = await call(routeOf('/gildra/v1/projects'), requestFor({
    method: 'POST', origin: null, body: { projectId: 'x', path: canonical },
  }))
  assert.equal(noOrigin.status, 403)

  // DNS rebinding: чужой Host при loopback-origin.
  const rebind = await call(routeOf('/gildra/v1/projects'), requestFor({
    method: 'POST', host: 'evil.example', body: { projectId: 'x', path: canonical },
  }))
  assert.equal(rebind.status, 403)

  // Гигантское поле отклоняется до попадания в state.
  const huge = await call(routeOf('/gildra/v1/tasks'), requestFor({
    method: 'POST', body: { projectId: 'demo', title: 'x'.repeat(5000) },
  }))
  assert.equal(huge.status, 400)
  assert.equal(huge.body.error.code, 'INVALID_INPUT')

  const notJson = await call(routeOf('/gildra/v1/projects'), requestFor({
    method: 'POST',
    contentType: 'text/plain',
    body: { projectId: 'x', path: canonical },
  }))
  assert.equal(notJson.status, 415)
  assert.equal(notJson.body.error.code, 'UNSUPPORTED_MEDIA_TYPE')

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
  assert.equal(merge.body.merge.status, 'COMPLETED')
  const { stdout } = await git(['-C', canonical, 'show', 'main:app.txt'])
  assert.equal(stdout, 'v2 from session\n')

  const fetched = await call(routeOf('/gildra/v1/merges'), requestFor({ url: `/gildra/v1/merges?id=${merge.body.merge.mergeId}` }))
  assert.equal(fetched.body.merge.status, 'COMPLETED')
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
    body: { taskId: task.taskId, status: 'IMPLEMENTING', linkSession: session.sessionId, linkAgent: 'implementation' },
  }))
  assert.equal(updated.body.task.status, 'IMPLEMENTING')
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
  assert.deepEqual(Object.keys(scan.body.report).sort(),
    ['adoptableWorktrees', 'missingWorkspaces', 'orphaned', 'staleLeases', 'unfinishedOperations'])

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

// --- Идемпотентность мутаций (§11) ----------------------------------------
{
  // Повтор POST с тем же Idempotency-Key не создаёт вторую сессию.
  const key = 'client-retry-1'
  const first = await call(routeOf('/gildra/v1/sessions'), requestFor({
    method: 'POST', idempotencyKey: key, body: { projectId: 'demo', userId: 'alex' },
  }))
  assert.equal(first.status, 201)
  const retry = await call(routeOf('/gildra/v1/sessions'), requestFor({
    method: 'POST', idempotencyKey: key, body: { projectId: 'demo', userId: 'alex' },
  }))
  assert.equal(retry.status, 201)
  assert.equal(retry.body.session.sessionId, first.body.session.sessionId,
    'повтор с тем же ключом возвращает ту же сессию, а не создаёт дубль')

  const listed = await call(routeOf('/gildra/v1/sessions'), requestFor({ url: '/gildra/v1/sessions?activeOnly=1' }))
  const duplicates = listed.body.sessions.filter(record => record.userId === 'alex' && record.status === 'ACTIVE')
  assert.equal(duplicates.length, 1, 'в состоянии ровно одна активная сессия')

  // Другой ключ — уже новая сессия.
  const other = await call(routeOf('/gildra/v1/sessions'), requestFor({
    method: 'POST', idempotencyKey: 'client-retry-2', body: { projectId: 'demo', userId: 'alex' },
  }))
  assert.notEqual(other.body.session.sessionId, first.body.session.sessionId)

  for (const created of [first, other]) {
    await call(routeOf('/gildra/v1/sessions/cleanup'), requestFor({
      method: 'POST',
      body: { sessionId: created.body.session.sessionId, ownerToken: created.body.ownerToken, confirmUnmerged: true },
    }))
  }
}

// --- Возможности, health и диагностика ------------------------------------
{
  const capabilities = await call(routeOf('/gildra/v1/capabilities'), requestFor({}))
  assert.equal(capabilities.body.apiVersion, 1)
  assert.ok(capabilities.body.runtimeVersion >= 1)
  assert.equal(capabilities.body.features.fencing, true)
  assert.equal(capabilities.body.features.idempotency, true)

  const health = await call(routeOf('/gildra/v1/health'), requestFor({}))
  assert.equal(health.body.health.ready, true)
  assert.equal(health.body.health.runtime, 'READY')

  const diagnostics = await call(routeOf('/gildra/v1/diagnostics'), requestFor({}))
  assert.equal(diagnostics.body.diagnostics.state, 'READY')
  assert.ok(diagnostics.body.diagnostics.selfCheck.ok, 'self-check проходит')
  assert.ok(Array.isArray(diagnostics.body.diagnostics.unfinishedOperations))
  assert.deepEqual(diagnostics.body.diagnostics.corruptions, [])

  // Секреты не утекают ни в один read-only ответ.
  const serialized = JSON.stringify([capabilities.body, health.body, diagnostics.body])
  assert.doesNotMatch(serialized, /ownerToken/i)
  assert.doesNotMatch(serialized, /[0-9a-f]{48}/)
}

// --- Слой качества через HTTP-обвязку (§65, §66) ---------------------------
{
  // Политика: единственная trusted-команда + review; policy отдаётся GET-ом.
  const setPolicy = await call(routeOf('/gildra/v1/quality/policy'), requestFor({
    method: 'POST',
    body: { projectId: 'demo', policy: { required: ['tests', 'review'], checks: { tests: { argv: ['node', '-e', 'console.log("api ok")'] } } } },
  }))
  assert.equal(setPolicy.status, 200)
  const gotPolicy = await call(routeOf('/gildra/v1/quality/policy'), requestFor({ url: '/gildra/v1/quality/policy?projectId=demo' }))
  assert.deepEqual(gotPolicy.body.policy.required, ['tests', 'review'])

  // Профиль репозитория строится и кэшируется.
  const profile = await call(routeOf('/gildra/v1/repo/profile'), requestFor({ url: '/gildra/v1/repo/profile?projectId=demo' }))
  assert.equal(profile.status, 200)
  assert.ok(Array.isArray(profile.body.profile.languages))

  // Задача с критериями и claims; вторая задача видит пересечение.
  const taskA = await call(routeOf('/gildra/v1/tasks'), requestFor({
    method: 'POST',
    body: { projectId: 'demo', title: 'Quality flow', owner: 'alex', acceptanceCriteria: ['работает'], claims: ['README.md'] },
  }))
  const flowTask = taskA.body.task
  const taskB = await call(routeOf('/gildra/v1/tasks'), requestFor({
    method: 'POST',
    body: { projectId: 'demo', title: 'Neighbour', owner: 'peter', claims: ['README.md'] },
  }))
  assert.equal(taskB.body.overlaps.length, 1, 'API отдаёт пересечения claims')

  // Team view.
  const team = await call(routeOf('/gildra/v1/team'), requestFor({ url: '/gildra/v1/team?projectId=demo' }))
  assert.ok(team.body.team.activeTasks >= 2)
  assert.ok(team.body.team.overlaps.length >= 1)

  // Привязка workspace: dirty считает сервер.
  const sessionB = await call(routeOf('/gildra/v1/sessions'), requestFor({
    method: 'POST',
    body: { projectId: 'demo', userId: 'alex', sessionId: 'apiflow' },
  }))
  const workspaceId = sessionB.body.session.workspaceId
  const attach = await call(routeOf('/gildra/v1/tasks/attach'), requestFor({
    method: 'POST',
    body: { taskId: flowTask.taskId, workspaceId },
  }))
  assert.equal(attach.status, 200)
  assert.equal(attach.body.task.workspaceId, workspaceId)

  // Verification через API → quality → блокер REVIEW_MISSING → promote 409.
  const run = await call(routeOf('/gildra/v1/tasks/verify'), requestFor({
    method: 'POST',
    body: { taskId: flowTask.taskId },
  }))
  assert.equal(run.body.run.status, 'COMPLETED')
  assert.equal(run.body.run.checks.find(check => check.id === 'tests').status, 'PASSED')

  const qualityBefore = await call(routeOf('/gildra/v1/tasks/quality'), requestFor({ url: `/gildra/v1/tasks/quality?taskId=${flowTask.taskId}` }))
  assert.equal(qualityBefore.body.quality.ready, false)
  assert.ok(qualityBefore.body.quality.blockers.some(blocker => blocker.id === 'REVIEW_MISSING'))
  const promoteEarly = await call(routeOf('/gildra/v1/tasks/promote'), requestFor({
    method: 'POST', body: { taskId: flowTask.taskId },
  }))
  assert.equal(promoteEarly.status, 409)
  assert.equal(promoteEarly.body.error.code, 'READINESS_REQUIRED')

  // Ревью: writer≠reviewer guard работает и через API.
  await call(routeOf('/gildra/v1/tasks/update'), requestFor({
    method: 'POST', body: { taskId: flowTask.taskId, writerAgent: 'writer-a' },
  }))
  const conflict = await call(routeOf('/gildra/v1/reviews/request'), requestFor({
    method: 'POST', body: { taskId: flowTask.taskId, reviewerAgent: 'writer-a' },
  }))
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'WRITER_REVIEWER_CONFLICT')

  const requested = await call(routeOf('/gildra/v1/reviews/request'), requestFor({
    method: 'POST', body: { taskId: flowTask.taskId, reviewerAgent: 'reviewer-b' },
  }))
  assert.equal(requested.status, 201)
  assert.ok(requested.body.packet.acceptanceCriteria.length === 1)
  const submitted = await call(routeOf('/gildra/v1/reviews/submit'), requestFor({
    method: 'POST',
    body: { reviewId: requested.body.review.reviewId, verdict: 'APPROVED', findings: [], criteriaVerdicts: [{ met: true }] },
  }))
  assert.equal(submitted.body.review.verdict, 'APPROVED')

  // Контекст задачи компактен и структурен.
  const context = await call(routeOf('/gildra/v1/tasks/context'), requestFor({ url: `/gildra/v1/tasks/context?taskId=${flowTask.taskId}` }))
  assert.ok(context.body.context.text.length < 8200)
  assert.deepEqual(context.body.context.structured.required, ['tests', 'review'])

  // Evidence протух после нового прогона не требуется — sha не менялся —
  // теперь gate зелёный и promote работает.
  const promote = await call(routeOf('/gildra/v1/tasks/promote'), requestFor({
    method: 'POST', body: { taskId: flowTask.taskId },
  }))
  assert.equal(promote.status, 200, JSON.stringify(promote.body))
  assert.equal(promote.body.task.status, 'READY_FOR_HUMAN_REVIEW')

  // Delivery + upstream.
  const delivery = await call(routeOf('/gildra/v1/tasks/delivery'), requestFor({
    method: 'POST', body: { taskId: flowTask.taskId, mode: 'PR', prUrl: 'https://github.com/acme/demo/pull/12', prNumber: 12, ciStatus: 'PASSED' },
  }))
  assert.equal(delivery.body.task.delivery.prNumber, 12)
  const upstreamCheck = await call(routeOf('/gildra/v1/tasks/upstream'), requestFor({
    method: 'POST', body: { taskId: flowTask.taskId },
  }))
  assert.equal(upstreamCheck.body.upstream.status, 'UP_TO_DATE')

  // Capabilities объявляют слой качества.
  const capabilities = await call(routeOf('/gildra/v1/capabilities'), requestFor({}))
  assert.equal(capabilities.body.features.qualityPipeline, true)
  assert.equal(capabilities.body.features.teamClaims, true)
  assert.equal(capabilities.body.features.upstreamAwareness, true)
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime API tests passed.')
