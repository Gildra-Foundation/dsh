// Crash-consistency и fencing (§3-§6, §34, §48, §49).
//
// Проверяется не «функция вернула значение», а поведение при отказе:
// падение между шагами многошаговой операции, «воскресший» writer после
// takeover, изменение состояния между планом и удалением.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonStore } from '../lib/store.js'
import { runtimeRoots } from '../lib/paths.js'
import { createJournal, OPERATION_TYPES, PHASES } from '../lib/journal.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { createLeaseManager } from '../lib/leases.js'
import { createProcessManager } from '../lib/processes.js'
import { createPortAllocator } from '../lib/ports.js'
import { createSessionManager } from '../lib/sessions.js'
import { commitAll, git } from '../lib/gitx.js'

const base = await mkdtemp(join(tmpdir(), 'gildra crash '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })

// Полный стек Runtime поверх одного state-корня. Отдельная фабрика нужна,
// чтобы «перезапускать Runtime» после симулированного падения.
function buildRuntime(overrides = {}) {
  const store = new JsonStore(roots.stateRoot)
  const journal = createJournal({ roots })
  const projects = createProjectRegistry({ store, roots })
  const leases = createLeaseManager({ roots, env: {} })
  const processes = createProcessManager({ store, roots })
  const ports = overrides.ports ?? createPortAllocator({ store, env: {} })
  const workspaces = createWorkspaceManager({ store, roots, projects, leases, processes, env: {} })
  const sessions = createSessionManager({
    store, roots, projects, workspaces, leases, processes, ports, journal, env: {},
  })
  return { store, journal, projects, leases, processes, ports, workspaces, sessions }
}

const first = buildRuntime()
await first.store.ensureRoot()

const seed = join(base, 'seed')
await git(['init', '-b', 'main', seed])
await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
await writeFile(join(seed, 'app.txt'), 'v1\n')
await commitAll(seed, 'initial', { name: 'Seed', email: 'seed@test' })
const canonical = join(base, 'repos', 'demo.git')
await git(['clone', '--bare', seed, canonical])
await git(['-C', canonical, 'config', 'core.autocrlf', 'false'])
await first.projects.register({ projectId: 'demo', path: canonical })

// --- Журнал: успешная операция не оставляет записи ------------------------
{
  const created = await first.sessions.createSession({ projectId: 'demo', userId: 'alex' })
  assert.equal(created.session.status, 'ACTIVE')
  assert.deepEqual(await first.journal.listOpen(), [],
    'успешная операция удаляет свою запись журнала')
  // Fencing: сессия знает поколение своего lease.
  assert.equal(created.session.leaseGeneration, 1)
  await first.sessions.cleanupSession(created.session.sessionId, { ownerToken: created.ownerToken })
  assert.deepEqual(await first.journal.listOpen(), [])
}

// --- Крах между шагами создания сессии (fault injection через DI) ---------
// Порты падают уже ПОСЛЕ создания worktree и захвата lease: на диске
// остаются ресурсы, о которых обычный state ничего бы не сказал.
{
  const failingPorts = {
    allocate: async () => { throw new Error('simulated crash: port allocator died') },
    releaseForSession: async () => ({ released: 0 }),
    listForSession: async () => [],
  }
  const crashing = buildRuntime({ ports: failingPorts })
  await assert.rejects(
    crashing.sessions.createSession({ projectId: 'demo', userId: 'alex' }),
    /simulated crash/,
  )

  // Журнал точно говорит, до какого шага дошли.
  const open = await crashing.journal.listOpen()
  assert.equal(open.length, 1, 'незавершённая операция остаётся в журнале')
  assert.equal(open[0].type, OPERATION_TYPES.CREATE_SESSION)
  assert.equal(open[0].phase, PHASES.FAILED)
  assert.ok(open[0].context.workspaceId, 'журнал сохранил, какой workspace успел создаться')
  assert.ok(open[0].context.branch)
  assert.equal(existsSync(open[0].context.path), true, 'worktree действительно создан на диске')

  // «Перезапуск Runtime»: новый экземпляр видит незавершённую операцию и НЕ
  // удаляет ничего сам.
  const restarted = buildRuntime()
  const report = await restarted.sessions.scanForRecovery()
  assert.equal(report.unfinishedOperations.length, 1)
  assert.equal(report.unfinishedOperations[0].type, OPERATION_TYPES.CREATE_SESSION)
  assert.equal(existsSync(open[0].context.path), true, 'recovery ничего не удаляет автоматически')

  // Ручная уборка последствий: сессия помечена FAILED, workspace остаётся для
  // решения пользователя.
  const failed = (await restarted.sessions.listSessions({})).find(record => record.status === 'FAILED')
  assert.ok(failed, 'сессия помечена FAILED')
  await restarted.workspaces.cleanupWorkspace(open[0].context.workspaceId, { confirmUnmerged: true })
  await restarted.journal.forget(open[0].operationId)
  assert.deepEqual(await restarted.journal.listOpen(), [])
}

// --- Fencing: «воскресший» writer после takeover ничего не разрушает ------
{
  const runtime = buildRuntime()
  const created = await runtime.sessions.createSession({ projectId: 'demo', userId: 'peter' })
  const staleToken = created.ownerToken
  const workspaceId = created.session.workspaceId
  assert.equal((await runtime.leases.stateOf(workspaceId)).generation, 1)

  // Владелец «умирает»: подменяем pid на мёртвый и роняем lease в ORPHANED.
  const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const deadPid = deadChild.pid
  await new Promise(resolveExit => deadChild.on('exit', resolveExit))
  const record = await runtime.sessions.getSession(created.session.sessionId)
  await runtime.store.write('sessions', created.session.sessionId, {
    ...record,
    pid: deadPid,
    lastActivityAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  })
  await runtime.leases.forceRelease(workspaceId, { reason: 'test-crash' })

  // Новый writer перехватывает workspace — поколение растёт.
  await runtime.sessions.scanForRecovery()
  const recovered = await runtime.sessions.recoverSession(created.session.sessionId)
  assert.equal(recovered.session.leaseGeneration, 2, 'takeover увеличивает поколение lease')
  assert.notEqual(recovered.ownerToken, staleToken)

  // Старый токен мёртв на всех уровнях.
  await assert.rejects(
    runtime.leases.heartbeat(workspaceId, staleToken),
    (error) => error.code === 'FOREIGN_OWNER',
  )
  await assert.rejects(
    runtime.leases.assertFence(workspaceId, { ownerToken: staleToken }),
    (error) => error.code === 'FOREIGN_OWNER',
  )
  // Даже с ПРАВИЛЬНЫМ токеном, но устаревшим поколением — отказ (ABA).
  await assert.rejects(
    runtime.leases.assertFence(workspaceId, { ownerToken: recovered.ownerToken, generation: 1 }),
    (error) => error.code === 'FOREIGN_OWNER' && error.details.currentGeneration === 2,
  )
  // Актуальная пара проходит.
  assert.equal((await runtime.leases.assertFence(workspaceId, {
    ownerToken: recovered.ownerToken,
    generation: 2,
  })).generation, 2)

  // Старый writer пытается уничтожить workspace своим токеном — отклонено.
  await assert.rejects(
    runtime.workspaces.cleanupWorkspace(workspaceId, { ownerToken: staleToken, confirmUnmerged: true }),
    (error) => error.code === 'FOREIGN_OWNER' || error.code === 'WORKSPACE_LOCKED',
  )
  assert.equal(existsSync(created.session.workspaceId ? (await runtime.workspaces.getRecord(workspaceId)).path : ''), true,
    'workspace устаревшим writer-ом не удалён')

  await runtime.sessions.cleanupSession(created.session.sessionId, {
    ownerToken: recovered.ownerToken,
    confirmUnmerged: true,
  })
}

// --- TOCTOU cleanup: состояние изменилось между планом и удалением --------
{
  const runtime = buildRuntime()
  const created = await runtime.sessions.createSession({ projectId: 'demo', userId: 'alex' })
  const workspaceId = created.session.workspaceId
  const workspace = await runtime.workspaces.getRecord(workspaceId)

  const plan = await runtime.workspaces.cleanupPlan(workspaceId)
  assert.ok(plan.planToken, 'план выдаёт отпечаток состояния')
  assert.deepEqual(plan.blockers, ['WORKSPACE_LOCKED'], 'свой активный lease виден как блокер')

  // Между планом и удалением в workspace появились изменения.
  await writeFile(join(workspace.path, 'app.txt'), 'изменено после плана\n')
  await assert.rejects(
    runtime.workspaces.cleanupWorkspace(workspaceId, {
      ownerToken: created.ownerToken,
      expectedPlanToken: plan.planToken,
      confirmUnmerged: true,
    }),
    (error) => error.code === 'WORKSPACE_BUSY',
  )
  assert.equal(existsSync(workspace.path), true, 'workspace не удалён при устаревшем плане')

  // Свежий план видит новое состояние и требует подтверждения изменений.
  const fresh = await runtime.workspaces.cleanupPlan(workspaceId)
  assert.notEqual(fresh.planToken, plan.planToken)
  assert.ok(fresh.blockers.includes('WORKSPACE_DIRTY'))
  await assert.rejects(
    runtime.workspaces.cleanupWorkspace(workspaceId, {
      ownerToken: created.ownerToken,
      expectedPlanToken: fresh.planToken,
    }),
    (error) => error.code === 'WORKSPACE_DIRTY',
  )
  // С подтверждением и актуальным планом — удаляется.
  await runtime.workspaces.cleanupWorkspace(workspaceId, {
    ownerToken: created.ownerToken,
    expectedPlanToken: fresh.planToken,
    confirmDirty: true,
    confirmUnmerged: true,
  })
  assert.equal(existsSync(workspace.path), false)
}

// --- Живой процесс сессии не даёт объявить её осиротевшей (§7) ------------
{
  const runtime = buildRuntime()
  const created = await runtime.sessions.createSession({ projectId: 'demo', userId: 'alex' })
  const workspace = await runtime.workspaces.getRecord(created.session.workspaceId)

  // UI молчит давно, но managed-процесс сессии жив.
  const child = await runtime.processes.spawnInSession(
    {
      sessionId: created.session.sessionId,
      workspaceId: workspace.workspaceId,
      cwd: workspace.path,
      env: process.env,
      role: 'dev-server',
    },
    process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
  )
  try {
    const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    const deadPid = deadChild.pid
    await new Promise(resolveExit => deadChild.on('exit', resolveExit))
    const record = await runtime.sessions.getSession(created.session.sessionId)
    await runtime.store.write('sessions', created.session.sessionId, {
      ...record,
      pid: deadPid,
      lastActivityAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    })

    const liveness = await runtime.sessions.livenessOf(await runtime.sessions.getSession(created.session.sessionId))
    assert.equal(liveness.uiSilent, true, 'UI действительно молчит')
    assert.equal(liveness.ownerProcessAlive, false, 'процесс-владелец мёртв')
    assert.equal(liveness.managedProcesses, 1, 'managed-процесс сессии жив')
    assert.equal(liveness.alive, true, 'живой процесс — достаточное доказательство жизни')

    const report = await runtime.sessions.scanForRecovery()
    assert.equal(report.orphaned.some(entry => entry.sessionId === created.session.sessionId), false,
      'сессия с живым процессом не объявляется ORPHANED из-за молчания вкладки')
    assert.equal((await runtime.sessions.getSession(created.session.sessionId)).status, 'ACTIVE')
  } finally {
    await runtime.processes.killSessionProcesses(created.session.sessionId)
    assert.ok(child.pid)
  }

  // Процессов больше нет; в реальном крахе вместе с процессом-владельцем
  // умирает и его lease, поэтому досимулируем это явно.
  await runtime.leases.forceRelease(created.session.workspaceId, { reason: 'test-crash-simulation' })
  const report = await runtime.sessions.scanForRecovery()
  assert.equal(report.orphaned.some(entry => entry.sessionId === created.session.sessionId), true,
    'без живых процессов и lease сессия законно становится ORPHANED')
}

// --- Журнал переживает перезапуск и читается как есть ----------------------
{
  const journal = createJournal({ roots })
  const operation = await journal.begin(OPERATION_TYPES.MERGE, 'merge-test', { projectId: 'demo' })
  await operation.advance(PHASES.MERGING, { sourceBranch: 'session/alex/x' })
  const reopened = createJournal({ roots })
  const open = (await reopened.listOpen()).filter(entry => entry.entityId === 'merge-test')
  assert.equal(open.length, 1)
  assert.equal(open[0].phase, PHASES.MERGING)
  assert.equal(open[0].context.sourceBranch, 'session/alex/x')
  await operation.complete()
  assert.equal((await reopened.listOpen()).filter(entry => entry.entityId === 'merge-test').length, 0)
  // Никаких temp-файлов после работы журнала.
  const leftovers = (await readdir(join(roots.stateRoot, 'journal'))).filter(name => name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [])
}

// --- Секреты не утекают в журнал и audit ----------------------------------
{
  const auditPath = join(roots.stateRoot, 'audit.log')
  const audit = existsSync(auditPath) ? await readFile(auditPath, 'utf8') : ''
  assert.doesNotMatch(audit, /ownerToken/i, 'audit не должен содержать owner-token')
  assert.doesNotMatch(audit, /[0-9a-f]{48}/, 'audit не должен содержать значение токена')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime crash recovery and fencing tests passed.')
