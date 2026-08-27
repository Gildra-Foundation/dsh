// Тесты Session/Process/Port-слоя: полный жизненный цикл write-сессии,
// изоляция процессов (§37), конкурентная аллокация портов, env-инъекция,
// runtime-профиль проекта, crash recovery (§25) и cleanup, не задевающий
// соседнюю сессию.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonStore } from '../lib/store.js'
import { runtimeRoots } from '../lib/paths.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { createLeaseManager } from '../lib/leases.js'
import { createProcessManager } from '../lib/processes.js'
import { createPortAllocator, probePortFree } from '../lib/ports.js'
import { createSessionManager } from '../lib/sessions.js'
import { agentContextBlock, composeProjectName, renderRuntimeProfile, sessionEnvironment } from '../lib/runtime-env.js'
import { commitAll, git } from '../lib/gitx.js'

const base = await mkdtemp(join(tmpdir(), 'gildra sess '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
const leases = createLeaseManager({ roots, env: {} })
const processes = createProcessManager({ store, roots })
const ports = createPortAllocator({ store, env: {} })
const workspaces = createWorkspaceManager({ store, roots, projects, leases, processes, env: {} })
const sessions = createSessionManager({ store, roots, projects, workspaces, leases, processes, ports, env: {} })

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// --- Проект ---------------------------------------------------------------
const seed = join(base, 'seed')
await git(['init', '-b', 'main', seed])
await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
await writeFile(join(seed, 'app.txt'), 'v1\n')
await commitAll(seed, 'initial', { name: 'Seed', email: 'seed@test' })
const canonical = join(base, 'repos', 'demo.git')
await git(['clone', '--bare', seed, canonical])
await git(['-C', canonical, 'config', 'core.autocrlf', 'false'])
await projects.register({ projectId: 'demo', path: canonical })

// --- Полный жизненный цикл write-сессии -----------------------------------
const a = await sessions.createSession({ projectId: 'demo', userId: 'alex', title: 'Add OAuth' })
assert.equal(a.session.status, 'ACTIVE')
assert.equal(a.session.mode, 'write')
assert.match(a.session.branch, /^session\/alex\/sess-/)
assert.ok(a.ownerToken)
assert.ok(existsSync(join(roots.workspacesRoot, 'demo', 'alex', a.session.sessionId)))
assert.equal((await leases.stateOf(a.session.workspaceId)).state, 'ACTIVE')
assert.ok(Number.isInteger(a.session.ports.app))

// Env-инъекция.
assert.equal(a.environment.GILDRA_SESSION_ID, a.session.sessionId)
assert.equal(a.environment.GILDRA_MODE, 'WRITE')
assert.equal(a.environment.PORT, String(a.session.ports.app))
assert.equal(a.environment.COMPOSE_PROJECT_NAME, `gildra_${a.session.sessionId}`)
assert.ok(a.environment.GILDRA_WORKSPACE.endsWith(a.session.sessionId))

// Вторая write-сессия и read-сессия на workspace первой.
const b = await sessions.createSession({ projectId: 'demo', userId: 'alex' })
assert.notEqual(a.session.workspaceId, b.session.workspaceId)
assert.notEqual(a.session.ports.app, b.session.ports.app, 'портам двух сессий нельзя совпадать')
const reader = await sessions.createSession({ projectId: 'demo', userId: 'alex', mode: 'read', attachTo: a.session.workspaceId })
assert.equal(reader.session.mode, 'read')
assert.equal(reader.session.workspaceId, a.session.workspaceId)
assert.equal((await leases.stateOf(a.session.workspaceId)).sessionId, a.session.sessionId,
  'read-сессия не трогает lease writer-а')

// Heartbeat/transition/ownership.
await sessions.heartbeat(a.session.sessionId, a.ownerToken)
await sessions.transition(a.session.sessionId, a.ownerToken, 'TESTING')
assert.equal((await sessions.getSession(a.session.sessionId)).status, 'TESTING')
await assert.rejects(sessions.transition(a.session.sessionId, 'wrong-token', 'ACTIVE'), (error) => error.code === 'UNAUTHORIZED_SESSION')
await assert.rejects(sessions.transition(a.session.sessionId, a.ownerToken, 'NOPE'), (error) => error.code === 'INVALID_INPUT')
await sessions.transition(a.session.sessionId, a.ownerToken, 'ACTIVE')

// --- Runtime-профиль и agent context --------------------------------------
{
  const environment = sessionEnvironment({
    session: a.session,
    workspace: await workspaces.getRecord(a.session.workspaceId),
    ports: [{ name: 'app', port: a.session.ports.app }, { name: 'debug', port: 39999 }],
  })
  assert.equal(environment.GILDRA_PORT_DEBUG, '39999')
  const rendered = renderRuntimeProfile({
    env: {
      POSTGRES_DB: '${GILDRA_PROJECT_ID}_${GILDRA_SESSION_ID}',
      REDIS_PREFIX: '${GILDRA_SESSION_ID}:',
      DATABASE_URL: 'postgres://localhost/${GILDRA_PROJECT_ID}_${GILDRA_SESSION_ID}',
    },
    startCommand: 'npm start -- --port ${GILDRA_PORT_APP}',
  }, environment)
  assert.equal(rendered.env.POSTGRES_DB, `demo_${a.session.sessionId}`)
  assert.equal(rendered.env.REDIS_PREFIX, `${a.session.sessionId}:`)
  assert.match(rendered.startCommand, /--port \d+$/)
  assert.throws(() => renderRuntimeProfile({ env: { X: '${NOPE}' } }, environment), /NOPE/)
  assert.equal(composeProjectName('sess-abc'), 'gildra_sess-abc')
  const block = agentContextBlock({
    session: a.session,
    workspace: await workspaces.getRecord(a.session.workspaceId),
    project: await projects.get('demo'),
  })
  assert.match(block, /Mode: WRITE/)
  assert.match(block, /Never switch branch/)
  assert.match(block, /Protected branches .*main/)
}

// --- §37: два mock dev-server-а живут одновременно ------------------------
const workspaceA = await workspaces.getRecord(a.session.workspaceId)
const workspaceB = await workspaces.getRecord(b.session.workspaceId)
const serverScript = 'setInterval(() => {}, 1000)'
const procA = await processes.spawnInSession(
  { sessionId: a.session.sessionId, workspaceId: workspaceA.workspaceId, cwd: workspaceA.path, env: { ...process.env, ...a.environment }, role: 'dev-server' },
  process.execPath, ['-e', serverScript],
)
const procB = await processes.spawnInSession(
  { sessionId: b.session.sessionId, workspaceId: workspaceB.workspaceId, cwd: workspaceB.path, env: { ...process.env, ...b.environment }, role: 'dev-server' },
  process.execPath, ['-e', serverScript],
)
assert.equal(alive(procA.pid), true)
assert.equal(alive(procB.pid), true)
assert.equal((await processes.listForSession(a.session.sessionId)).length, 1)
assert.equal((await processes.listForSession(b.session.sessionId)).length, 1)

// Завершение процессов сессии A не трогает процесс сессии B.
await processes.killSessionProcesses(a.session.sessionId)
await new Promise(resolveTimer => setTimeout(resolveTimer, 100))
assert.equal(alive(procA.pid), false, 'процесс сессии A завершён')
assert.equal(alive(procB.pid), true, 'процесс сессии B жив')
assert.equal((await processes.listForSession(a.session.sessionId)).length, 0)

// --- Порты: конкурентная аллокация уникальна, busy-порт пропускается ------
{
  const narrowStore = new JsonStore(join(base, 'ports-state'))
  await narrowStore.ensureRoot()
  const busy = createServer()
  await new Promise(resolveListen => busy.listen({ port: 31410, host: '127.0.0.1' }, resolveListen))
  const narrow = createPortAllocator({ store: narrowStore, env: { GILDRA_DSH_PORT_RANGE: '31410-31419' } })
  const allocated = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    narrow.allocate({ sessionId: `sess-p${String(index)}` })))
  const numbers = allocated.map(record => record.port)
  assert.equal(new Set(numbers).size, 6, 'порты конкурентных аллокаций уникальны')
  assert.equal(numbers.includes(31410), false, 'занятый порт пропущен')
  await new Promise(resolveClose => busy.close(resolveClose))

  // Порт мёртвой сессии переиспользуется.
  const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const deadPid = deadChild.pid
  await new Promise(resolveExit => deadChild.on('exit', resolveExit))
  await narrowStore.write('ports', 'port-31410', {
    schemaVersion: 1, id: 'port-31410', port: 31410, name: 'app', sessionId: 'sess-dead', pid: deadPid, acquiredAt: new Date().toISOString(),
  })
  const reclaimed = await narrow.allocate({ sessionId: 'sess-new' })
  assert.equal(reclaimed.port, 31410, 'порт мёртвой сессии возвращается в пул')
  await narrow.releaseForSession('sess-new')
  assert.equal(await probePortFree(31410), true)

  // Диапазон исчерпан → PORT_POOL_EXHAUSTED, а не PORT_UNAVAILABLE: это
  // проблема ёмкости пула, а не одного порта (отдельный store и диапазон,
  // чтобы не пересекаться с живыми lease из блока выше).
  const tinyStore = new JsonStore(join(base, 'ports-tiny'))
  await tinyStore.ensureRoot()
  const tiny = createPortAllocator({ store: tinyStore, env: { GILDRA_DSH_PORT_RANGE: '31420-31421' } })
  await tiny.allocate({ sessionId: 'sess-x1' })
  await tiny.allocate({ sessionId: 'sess-x2' })
  await assert.rejects(tiny.allocate({ sessionId: 'sess-x3' }), (error) => error.code === 'PORT_POOL_EXHAUSTED')
}

// --- Откат неудачного создания сессии -------------------------------------
await assert.rejects(
  sessions.createSession({ projectId: 'demo', userId: 'alex', baseRef: 'no-such-ref' }),
  (error) => error.code === 'INVALID_INPUT',
)
{
  const failed = (await sessions.listSessions({})).filter(record => record.status === 'FAILED')
  assert.equal(failed.length, 1)
  assert.equal(failed[0].workspaceId, undefined, 'полуживых ресурсов после отката нет')
}

// --- Cleanup сессии B: её процесс и порт освобождены, сессия A не тронута -
await writeFile(join(workspaceB.path, 'app.txt'), 'B dirty\n')
await assert.rejects(
  sessions.cleanupSession(b.session.sessionId, { ownerToken: b.ownerToken }),
  (error) => error.code === 'WORKSPACE_DIRTY',
)
// Отказ cleanup из-за dirty пометил сессию ORPHANED с причиной — восстановим
// и завершим с подтверждением.
// Неудачный cleanup ничего не разрушил: сессия сохраняет прежний статус,
// свой lease и токен — восстанавливать нечего, достаточно повторить с
// подтверждением.
const bAfterFailedCleanup = await sessions.getSession(b.session.sessionId)
assert.equal(bAfterFailedCleanup.status, 'ACTIVE')
assert.match(bAfterFailedCleanup.cleanupError ?? '', /Незакоммиченные/)
assert.equal((await leases.stateOf(b.session.workspaceId)).state, 'ACTIVE',
  'отклонённый cleanup не снимает собственный lease')
await sessions.cleanupSession(b.session.sessionId, { ownerToken: b.ownerToken, confirmDirty: true })
await new Promise(resolveTimer => setTimeout(resolveTimer, 100))
assert.equal(alive(procB.pid), false, 'cleanup завершил процесс своей сессии')
assert.equal((await sessions.getSession(b.session.sessionId)).status, 'COMPLETED')
assert.equal(existsSync(workspaceB.path), false)
assert.equal((await ports.listForSession(b.session.sessionId)).length, 0)
// Сессия A жива и её workspace на месте.
assert.equal(existsSync(workspaceA.path), true)
assert.equal((await sessions.getSession(a.session.sessionId)).status, 'ACTIVE')
assert.equal((await leases.stateOf(a.session.workspaceId)).state, 'ACTIVE')

// --- Crash recovery (§25) --------------------------------------------------
{
  const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const deadPid = deadChild.pid
  await new Promise(resolveExit => deadChild.on('exit', resolveExit))
  // «Упавший» владелец сессии A: PID мёртв, lease мёртв, активности давно нет.
  const recordA = await sessions.getSession(a.session.sessionId)
  await store.write('sessions', a.session.sessionId, {
    ...recordA,
    pid: deadPid,
    lastActivityAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  })
  await leases.forceRelease(a.session.workspaceId, { reason: 'test-crash-simulation' })

  // Брошенный worktree, о котором store не знает.
  const strayPath = join(base, 'stray-worktree')
  await git(['-C', canonical, 'worktree', 'add', '-b', 'session/alex/sess-stray', strayPath, 'main'])

  const report = await sessions.scanForRecovery()
  assert.deepEqual(report.orphaned.map(entry => entry.sessionId), [a.session.sessionId])
  assert.equal((await sessions.getSession(a.session.sessionId)).status, 'ORPHANED')
  assert.equal(report.adoptableWorktrees.length, 1)
  assert.equal(report.adoptableWorktrees[0].branch, 'session/alex/sess-stray')

  // Recover: новый owner-token, сессия снова ACTIVE, lease захвачен.
  const recovered = await sessions.recoverSession(a.session.sessionId)
  assert.equal(recovered.session.status, 'ACTIVE')
  assert.notEqual(recovered.ownerToken, a.ownerToken)
  assert.equal((await leases.stateOf(a.session.workspaceId)).state, 'ACTIVE')

  // Повторный скан ничего нового не находит (сессия снова живая: pid наш).
  const second = await sessions.scanForRecovery()
  assert.equal(second.orphaned.length, 0)
  await git(['-C', canonical, 'worktree', 'remove', '--force', strayPath])
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime session lifecycle tests passed.')
