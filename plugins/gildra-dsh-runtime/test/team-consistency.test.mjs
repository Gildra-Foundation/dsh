// Командная консистентность (§13, §23 плана authority).
//
// Часть 1 (этот коммит): сериализация git-провайдера внутри одного Runtime —
//   1. 20 параллельных publish разных задач через ОДИН provider: все
//      сохранены, index.lock не остаётся, каждый commit несёт только свой
//      payload;
//   2. publish + release одновременно не повреждают clone;
//   3. две публикации одной задачи с разной revision: CAS честно решает.
// Часть 2: режимы синхронизации (§12) и teamSync-состояние (§15).

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createGitTeamProvider, sanitizeTaskSummary } from '../lib/team.js'
import { git } from '../lib/gitx.js'

const base = await mkdtemp(join(tmpdir(), 'gildra team consistency '))

// «GitHub» — bare-репозиторий координации.
const seed = join(base, 'seed')
await git(['init', '-b', 'main', seed])
await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
await writeFile(join(seed, 'README.md'), '# coordination\n')
await git(['-C', seed, 'add', '-A'])
await git(['-C', seed, '-c', 'user.name=S', '-c', 'user.email=s@t', 'commit', '-m', 'init'])
const origin = join(base, 'origin.git')
await git(['clone', '--bare', seed, origin])

const clonePath = join(base, 'clone-one')
const provider = createGitTeamProvider({ clonePath, remoteUrl: origin })

const summaryOf = index => sanitizeTaskSummary({
  projectId: 'demo',
  taskId: `task-${String(index)}`,
  title: `Task ${String(index)}`,
  owner: index % 2 === 0 ? 'alex' : 'peter',
  status: 'IMPLEMENTING',
  claims: [{ type: 'PATH', area: `src/area${String(index)}/**`, mode: 'CLAIMED' }],
})

// --- 1. 20 параллельных publish через один provider ------------------------
{
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) => provider.publishTaskSummary(summaryOf(index))),
  )
  const failed = results.filter(entry => entry.status === 'rejected')
  assert.equal(failed.length, 0, `параллельные publish не должны падать: ${failed.map(entry => String(entry.reason?.code ?? entry.reason)).join('|')}`)

  const listed = await provider.listProjectTasks('demo')
  assert.equal(listed.length, 20, 'все 20 задач сохранены')

  // Clone не повреждён: нет index.lock, status чистый.
  assert.equal(existsSync(join(clonePath, '.git', 'index.lock')), false, 'index.lock не должен оставаться')
  const status = await git(['-C', clonePath, 'status', '--porcelain'])
  assert.equal(status.stdout.trim(), '', 'рабочее дерево координации чистое')

  // Каждый publish-коммит несёт РОВНО один payload-файл.
  const log = await git(['-C', clonePath, 'log', '--name-only', '--pretty=%H', 'origin/main'])
  const blocks = log.stdout.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    const files = block.split('\n').slice(1).filter(line => line.startsWith('projects/'))
    assert.ok(files.length <= 1, `commit смешал payloads: ${files.join(',')}`)
  }
}

// --- 2. publish + release одновременно --------------------------------------
{
  const results = await Promise.allSettled([
    provider.publishTaskSummary(sanitizeTaskSummary({ projectId: 'demo', taskId: 'task-new', title: 'New', owner: 'kim', status: 'PLANNED' })),
    provider.releaseClaim('demo', 'task-3'),
    provider.publishTaskStatus({ ...summaryOf(4), status: 'REVIEWING' }, { expectedRevision: 1 }),
  ])
  assert.deepEqual(results.map(entry => entry.status), ['fulfilled', 'fulfilled', 'fulfilled'],
    `mixed-операции: ${results.map(entry => String(entry.reason ?? 'ok')).join('|')}`)
  const listed = await provider.listProjectTasks('demo')
  assert.equal(listed.length, 20, '20 − released + new = 20')
  assert.ok(!listed.some(entry => entry.taskId === 'task-3'), 'release удалил свою задачу')
  assert.equal(listed.find(entry => entry.taskId === 'task-4').status, 'REVIEWING')
  assert.equal(existsSync(join(clonePath, '.git', 'index.lock')), false)
}

// --- 3. Две публикации одной задачи с разной revision ----------------------
{
  const current = (await provider.listProjectTasks('demo')).find(entry => entry.taskId === 'task-5')
  const results = await Promise.allSettled([
    provider.publishTaskStatus({ ...summaryOf(5), status: 'REVIEWING' }, { expectedRevision: current.revision }),
    provider.publishTaskStatus({ ...summaryOf(5), status: 'BLOCKED' }, { expectedRevision: current.revision }),
  ])
  const ok = results.filter(entry => entry.status === 'fulfilled')
  const conflict = results.filter(entry => entry.status === 'rejected' && entry.reason?.code === 'TEAM_STATE_CONFLICT')
  assert.equal(ok.length, 1, 'CAS: ровно одна из двух конкурирующих ревизий проходит')
  assert.equal(conflict.length, 1, 'вторая получает честный TEAM_STATE_CONFLICT')
}

// --- Часть 2: strict / best-effort ------------------------------------------
{
  const { runtimeRoots } = await import('../lib/paths.js')
  const { JsonStore } = await import('../lib/store.js')
  const { createProjectRegistry } = await import('../lib/projects.js')
  const { createTaskManager } = await import('../lib/tasks.js')
  const { createQualityManager } = await import('../lib/quality.js')
  const { createWorkspaceManager } = await import('../lib/workspaces.js')
  const { createProcessManager } = await import('../lib/processes.js')
  const { commitAll } = await import('../lib/gitx.js')

  const repo = join(base, 'project-repo')
  await git(['init', '-b', 'main', repo])
  await writeFile(join(repo, 'app.js'), 'export const x = 1\n')
  await commitAll(repo, 'init', { name: 'S', email: 's@t' })

  const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
  const store2 = new JsonStore(roots.stateRoot)
  await store2.ensureRoot()
  const projects = createProjectRegistry({ store: store2, roots })
  await projects.register({ projectId: 'demo', path: repo })
  const workspaces = createWorkspaceManager({ store: store2, roots, projects, env: {} })
  const processes = createProcessManager({ store: store2, roots })

  // Провайдер, который ПАДАЕТ: недоступный remote.
  const deadProvider = createGitTeamProvider({ clonePath: join(base, 'dead-clone'), remoteUrl: join(base, 'missing-origin.git') })
  const tasks = createTaskManager({ store: store2, roots, projects, team: deadProvider })
  const quality = createQualityManager({ store: store2, roots, projects, tasks, workspaces, processes })
  const adminSetPolicy = (id, policy) => quality.setPolicy(id, policy, { verifiedAdmin: { actorId: 'test-admin' } })

  async function makeTask(label) {
    const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: `s-${label}` })
    const { task } = await tasks.createTask({ projectId: 'demo', title: label, owner: 'alex' })
    await tasks.attachWorkspace(task.taskId, {
      workspaceId: workspace.workspaceId, sessionId: workspace.sessionId,
      branch: workspace.branch, baseSha: workspace.baseSha,
    })
    await tasks.setModulePlan(task.taskId, { modulesToChange: [{ module: '(root)', reason: 'правка app.js' }] })
    return task
  }

  // strict: провайдер мёртв → IMPLEMENTING не начинается, состояние честное.
  await adminSetPolicy('demo', { required: ['review'], checks: {}, team: { mode: 'strict' } })
  const strictTask = await makeTask('strict')
  await assert.rejects(
    tasks.transition(strictTask.taskId, 'IMPLEMENTING'),
    error => ['TEAM_SYNC_DEGRADED', 'TEAM_SYNC_REQUIRED'].includes(error.code),
    'strict-режим не работает fail-open',
  )
  const strictState = await tasks.teamSyncState('demo')
  assert.equal(strictState.status, 'DEGRADED', 'сбой синхронизации виден в состоянии')
  assert.equal(typeof strictState.lastError, 'string')

  // best-effort: работа продолжается, но статус DEGRADED зафиксирован.
  await adminSetPolicy('demo', { required: ['review'], checks: {}, team: { mode: 'best-effort' } })
  const softTask = await makeTask('soft')
  const started = await tasks.transition(softTask.taskId, 'IMPLEMENTING')
  assert.equal(started.status, 'IMPLEMENTING', 'best-effort продолжает работу при сбое провайдера')
  assert.equal((await tasks.teamSyncState('demo')).status, 'DEGRADED')

  // strict без провайдера вовсе → TEAM_SYNC_REQUIRED.
  const noTeamTasks = createTaskManager({ store: store2, roots, projects })
  const bare = await makeTask('bare')
  await adminSetPolicy('demo', { required: ['review'], checks: {}, team: { mode: 'strict' } })
  await assert.rejects(
    noTeamTasks.transition(bare.taskId, 'IMPLEMENTING'),
    error => error.code === 'TEAM_SYNC_REQUIRED',
  )
  assert.equal((await noTeamTasks.teamSyncState('demo')).status, 'DISABLED')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime team consistency tests passed.')
