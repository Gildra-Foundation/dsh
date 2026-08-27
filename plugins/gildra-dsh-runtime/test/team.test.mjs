// Team Coordination Provider (§23–§25 плана модульности).
//
// Доказываемые инварианты:
//   1. санитизация: токены/пути/capability не публикуются по построению;
//   2. local backend: CAS по revision — устаревшая ревизия даёт
//      TEAM_STATE_CONFLICT, а не silent overwrite;
//   3. github (git-backed) backend: два независимых клона видят задачи друг
//      друга; проигравший push перечитывает и повторяет; расхождение revision —
//      честный конфликт;
//   4. отсутствие настройки провайдера — валидный solo-режим (undefined).

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createGitTeamProvider, createLocalTeamProvider, createTeamProvider, sanitizeTaskSummary } from '../lib/team.js'
import { git } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'

const base = await mkdtemp(join(tmpdir(), 'gildra team '))

// --- 1. Санитизация ---------------------------------------------------------
{
  const summary = sanitizeTaskSummary({
    projectId: 'demo',
    taskId: 'task-1',
    title: 'Auth change',
    owner: 'alex',
    status: 'IMPLEMENTING',
    branch: 'session/alex/x',
    baseSha: 'a'.repeat(40),
    claims: [{ area: 'src/auth/**', mode: 'CLAIMED', ownerToken: 'LEAK' }],
    expectedAreas: ['src/auth/**'],
    analysis: { modularity: { changedModules: ['auth.service'] } },
    delivery: { prNumber: 42, ci: { conclusion: 'success' }, ciFixAttempts: 1 },
    // Поля, которым в команде не место:
    ownerToken: 'SECRET-TOKEN',
    workspacePath: '/home/alex/private',
  })
  const serialized = JSON.stringify(summary)
  assert.ok(!serialized.includes('SECRET-TOKEN'), 'ownerToken не публикуется')
  assert.ok(!serialized.includes('/home/alex'), 'локальные пути не публикуются')
  assert.ok(!serialized.includes('LEAK'), 'чужие поля внутри claims отфильтрованы')
  assert.deepEqual(summary.affectedModules, ['auth.service'])
  assert.equal(summary.prNumber, 42)
  assert.equal(summary.ciConclusion, 'success')
}

// --- 2. local backend: CAS ---------------------------------------------------
{
  const provider = createLocalTeamProvider({ dir: join(base, 'shared') })
  const summary = sanitizeTaskSummary({ projectId: 'demo', taskId: 'task-1', title: 'A', owner: 'alex', status: 'PLANNED' })
  const first = await provider.publishTaskSummary(summary)
  assert.equal(first.revision, 1)
  const second = await provider.publishTaskSummary({ ...summary, status: 'IMPLEMENTING' }, { expectedRevision: 1 })
  assert.equal(second.revision, 2)
  await assert.rejects(
    provider.publishTaskSummary({ ...summary, status: 'BLOCKED' }, { expectedRevision: 1 }),
    error => error.code === 'TEAM_STATE_CONFLICT',
    'устаревшая ревизия — конфликт, а не перезапись',
  )
  const listed = await provider.listProjectTasks('demo')
  assert.equal(listed.length, 1)
  assert.equal(listed[0].status, 'IMPLEMENTING', 'silent overwrite не произошёл')
  await provider.releaseClaim('demo', 'task-1')
  assert.deepEqual(await provider.listProjectTasks('demo'), [])
}

// --- 3. github backend: два Runtime, гонка push ------------------------------
{
  // «GitHub» — локальный bare-репозиторий координации.
  const origin = join(base, 'coordination.git')
  const seed = join(base, 'seed')
  await git(['init', '-b', 'main', seed])
  await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
  await (await import('node:fs/promises')).writeFile(join(seed, 'README.md'), '# team\n')
  await git(['-C', seed, 'add', '-A'])
  await git(['-C', seed, '-c', 'user.name=S', '-c', 'user.email=s@t', 'commit', '-m', 'init'])
  await git(['clone', '--bare', seed, origin])

  const alex = createGitTeamProvider({ clonePath: join(base, 'clone-alex'), remoteUrl: origin })
  const peter = createGitTeamProvider({ clonePath: join(base, 'clone-peter'), remoteUrl: origin })

  const taskA = sanitizeTaskSummary({ projectId: 'demo', taskId: 'task-a', title: 'Auth service', owner: 'alex', status: 'IMPLEMENTING', claims: [{ area: 'src/auth/**', mode: 'CLAIMED' }] })
  const published = await alex.publishTaskSummary(taskA)
  assert.equal(published.revision, 1)

  // Peter видит задачу Alex через свой независимый клон.
  const seen = await peter.listProjectTasks('demo')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].owner, 'alex')

  // Peter публикует свою; Alex — свою вторую параллельно: обе доезжают,
  // проигравший push повторяет после fetch.
  const taskB = sanitizeTaskSummary({ projectId: 'demo', taskId: 'task-b', title: 'Token', owner: 'peter', status: 'PLANNED', claims: [{ area: 'src/auth/token.js', mode: 'CLAIMED' }] })
  const taskC = sanitizeTaskSummary({ projectId: 'demo', taskId: 'task-c', title: 'Docs', owner: 'alex', status: 'PLANNED' })
  const results = await Promise.allSettled([
    peter.publishTaskSummary(taskB),
    alex.publishTaskSummary(taskC),
  ])
  assert.deepEqual(results.map(entry => entry.status), ['fulfilled', 'fulfilled'],
    `гонка push должна решаться повтором: ${results.map(entry => String(entry.reason ?? '')).join('|')}`)
  const all = await peter.listProjectTasks('demo')
  assert.equal(all.length, 3, 'обе конкурирующие публикации сохранились')

  // Optimistic CAS через клоны: Alex меняет task-a (rev 1 → 2); Peter,
  // державший rev 1, получает честный конфликт.
  await alex.publishTaskStatus({ ...taskA, status: 'REVIEWING' }, { expectedRevision: 1 })
  await assert.rejects(
    peter.publishTaskStatus({ ...taskA, status: 'BLOCKED' }, { expectedRevision: 1 }),
    error => error.code === 'TEAM_STATE_CONFLICT',
  )
  const claims = await alex.listProjectClaims('demo')
  assert.equal(claims.length, 2, 'claims видны всей команде')

  // Санитарная проверка содержимого координационного репо: секретов нет.
  const raw = readFileSync(join(base, 'clone-peter', 'projects', 'demo', 'tasks', 'task-a.json'), 'utf8')
  assert.ok(!raw.toLowerCase().includes('token"'), 'координация не содержит токенов')
}

// --- 4. Solo-режим -----------------------------------------------------------
{
  const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
  assert.equal(createTeamProvider({ env: {}, roots }), undefined)
  assert.equal(createTeamProvider({ env: { GILDRA_TEAM_PROVIDER: 'local' }, roots }), undefined, 'local без каталога не активируется')
  const local = createTeamProvider({ env: { GILDRA_TEAM_PROVIDER: 'local', GILDRA_TEAM_DIR: join(base, 'solo') }, roots })
  assert.equal(local.backend, 'local')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime team coordination provider tests passed.')
