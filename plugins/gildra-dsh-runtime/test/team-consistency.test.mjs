// Командная консистентность (§13, §23 плана authority).
//
// Часть 1 (этот коммит): сериализация git-провайдера внутри одного Runtime —
//   1. 20 параллельных publish разных задач через ОДИН provider: все
//      сохранены, index.lock не остаётся, каждый commit несёт только свой
//      payload;
//   2. publish + release одновременно не повреждают clone;
//   3. две публикации одной задачи с разной revision: CAS честно решает.
// Часть 2 (strict/best-effort/fingerprint) добавляется следующим коммитом.

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

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime team consistency (serialization) tests passed.')
