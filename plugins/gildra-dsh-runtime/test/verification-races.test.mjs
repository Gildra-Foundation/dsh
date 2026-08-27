// Гонки verification-резервации (§11, §25 плана authority).
//
// Доказываемые инварианты:
//   1. 50 одновременных runVerification при allowParallel=false → ровно один
//      проходит резервацию, 49 получают VERIFICATION_ACTIVE;
//   2. провал создания snapshot переводит PREPARING → FAILED и не оставляет
//      вечного «активного» прогона — следующий запуск проходит;
//   3. зависший PREPARING (краш Runtime) восстанавливается: помечается
//      FAILED, новый прогон стартует;
//   4. cancellation работает и в фазе PREPARING;
//   5. параллельный режим — только по явной политике.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, git } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { createProcessManager } from '../lib/processes.js'
import { createTaskManager } from '../lib/tasks.js'
import { createQualityManager } from '../lib/quality.js'

const identity = { name: 'Alex', email: 'alex@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra verify races '))
const repo = join(base, 'repo')
await git(['init', '-b', 'main', repo])
await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
await writeFile(join(repo, 'app.js'), 'export const ok = 1\n')
await commitAll(repo, 'init', identity)

const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
await projects.register({ projectId: 'demo', path: repo })
const processes = createProcessManager({ store, roots })
const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })
const tasks = createTaskManager({ store, roots, projects })
const quality = createQualityManager({ store, roots, projects, tasks, workspaces, processes })
const adminSetPolicy = (id, policy) => quality.setPolicy(id, policy, { verifiedAdmin: { actorId: 'test-admin' } })

// Прогон ДОЛЬШЕ, чем вся очередь из 50 lock-попыток: каждый конкурент
// гарантированно приходит в окно PREPARING/RUNNING, а не после завершения.
await adminSetPolicy('demo', {
  required: ['tests', 'review'],
  checks: { tests: { argv: ['node', '-e', 'setTimeout(() => {}, 4000)'] } },
})

async function makeTask(label) {
  const sessionId = `sess-${label}`
  const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId })
  const { task } = await tasks.createTask({ projectId: 'demo', title: label, owner: 'alex', acceptanceCriteria: ['ok'] })
  await tasks.attachWorkspace(task.taskId, {
    workspaceId: workspace.workspaceId, sessionId,
    branch: workspace.branch, baseSha: workspace.baseSha,
  })
  return { task, workspace }
}

// --- 1. 50 одновременных запусков ------------------------------------------
{
  const { task } = await makeTask('race50')
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, () => quality.runVerification(task.taskId)),
  )
  const ok = results.filter(entry => entry.status === 'fulfilled')
  const active = results.filter(entry => entry.status === 'rejected' && entry.reason?.code === 'VERIFICATION_ACTIVE')
  const other = results.filter(entry => entry.status === 'rejected' && entry.reason?.code !== 'VERIFICATION_ACTIVE')
  assert.equal(ok.length, 1, `ровно один прогон: ok=${String(ok.length)}, active=${String(active.length)}, other=${other.map(entry => String(entry.reason?.code ?? entry.reason)).join(',')}`)
  assert.equal(active.length, 49, '49 конкурентов получают VERIFICATION_ACTIVE')
  assert.equal(ok[0].value.status, 'COMPLETED')
  // Пост-инвариант: интервалы активности прогонов задачи не пересекаются.
  const runs = []
  for (const id of await store.list('verifications')) {
    const row = await store.read('verifications', id)
    if (row?.taskId === task.taskId) runs.push(row)
  }
  assert.equal(runs.length, 1, 'в store ровно одна запись прогона этой задачи')
}

// --- 2. Провал снапшота: PREPARING → FAILED, путь свободен -----------------
{
  const { task } = await makeTask('snapfail')
  const brokenWorkspaces = {
    ...workspaces,
    createVerificationSnapshot: async () => {
      throw new Error('диск закончился (симуляция)')
    },
  }
  const brokenQuality = createQualityManager({ store, roots, projects, tasks, workspaces: brokenWorkspaces, processes })
  await assert.rejects(brokenQuality.runVerification(task.taskId), /диск закончился/)
  const rows = []
  for (const id of await store.list('verifications')) {
    const row = await store.read('verifications', id)
    if (row?.taskId === task.taskId) rows.push(row)
  }
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'FAILED')
  assert.equal(rows[0].failure, 'SNAPSHOT_FAILED', 'провал снапшота честно записан')
  // Резервация не зависла: обычный прогон проходит.
  const retry = await quality.runVerification(task.taskId)
  assert.equal(retry.status, 'COMPLETED')
}

// --- 3. Зависший PREPARING восстанавливается -------------------------------
{
  const { task } = await makeTask('stale')
  // Симулируем краш Runtime сразу после резервации: durable PREPARING без
  // процесса, старше лимита.
  const staleId = 'verify-stale-crash'
  await store.write('verifications', staleId, {
    schemaVersion: 2, runId: staleId, taskId: task.taskId, projectId: 'demo',
    workspaceId: task.workspaceId, status: 'PREPARING', generation: 1,
    startedAt: new Date(Date.now() - 11 * 60_000).toISOString(), checks: [],
  })
  // Свежий PREPARING блокирует…
  const freshId = 'verify-fresh-hold'
  await store.write('verifications', freshId, {
    schemaVersion: 2, runId: freshId, taskId: task.taskId, projectId: 'demo',
    workspaceId: task.workspaceId, status: 'PREPARING', generation: 2,
    startedAt: new Date().toISOString(), checks: [],
  })
  await assert.rejects(quality.runVerification(task.taskId), error => error.code === 'VERIFICATION_ACTIVE',
    'живой PREPARING держит эксклюзив')
  await store.delete('verifications', freshId)
  // …а протухший — нет: recovery помечает его FAILED и пропускает новый run.
  const run = await quality.runVerification(task.taskId)
  assert.equal(run.status, 'COMPLETED')
  const stale = await store.read('verifications', staleId)
  assert.equal(stale.status, 'FAILED')
  assert.equal(stale.failure, 'STALE_PREPARING')
  assert.ok(run.generation > stale.generation, 'поколение растёт монотонно')
}

// --- 4. Отмена в фазе PREPARING --------------------------------------------
{
  const { task } = await makeTask('cancelprep')
  const preparingId = 'verify-prep-cancel'
  await store.write('verifications', preparingId, {
    schemaVersion: 2, runId: preparingId, taskId: task.taskId, projectId: 'demo',
    workspaceId: task.workspaceId, status: 'PREPARING', generation: 1,
    startedAt: new Date().toISOString(), checks: [],
  })
  const cancelled = await quality.cancelVerification(preparingId)
  assert.equal(cancelled.status, 'CANCELLING', 'PREPARING принимает отмену')
}

// --- 5. Параллельность — только по явной политике --------------------------
{
  const { task } = await makeTask('parallel')
  await adminSetPolicy('demo', {
    required: ['tests', 'review'],
    checks: { tests: { argv: ['node', '-e', 'setTimeout(() => {}, 300)'] } },
    verification: { allowParallel: true },
  })
  const results = await Promise.allSettled([
    quality.runVerification(task.taskId),
    quality.runVerification(task.taskId),
  ])
  assert.deepEqual(results.map(entry => entry.status), ['fulfilled', 'fulfilled'],
    'с allowParallel оба прогона живут')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime verification race tests passed.')
