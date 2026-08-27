// Merge workflow: state machine, свежесть базы, policy и crash-устойчивость
// (§19-§21). Ключевой инвариант: целевая ветка двигается ТОЛЬКО последним
// шагом, а конфликт никогда не разрешается молча.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonStore } from '../lib/store.js'
import { runtimeRoots } from '../lib/paths.js'
import { createJournal } from '../lib/journal.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { commitAll, git, revParse } from '../lib/gitx.js'

const base = await mkdtemp(join(tmpdir(), 'gildra merge '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const journal = createJournal({ roots })
const projects = createProjectRegistry({ store, roots })
const workspaces = createWorkspaceManager({ store, roots, projects, journal, env: {} })

const seed = join(base, 'seed repo')
await git(['init', '-b', 'main', seed])
await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
await writeFile(join(seed, 'shared.txt'), 'line-1\nline-2\nline-3\n')
await commitAll(seed, 'initial', { name: 'Seed', email: 'seed@test' })
const canonical = join(base, 'repos', 'demo.git')
await git(['clone', '--bare', seed, canonical])
await git(['-C', canonical, 'config', 'core.autocrlf', 'false'])
await projects.register({ projectId: 'demo', path: canonical })

const makeWorkspace = async (sessionId, mutate) => {
  const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId })
  await mutate(workspace)
  return workspace
}

// --- Policy: не сливаем ветку без коммитов --------------------------------
{
  const empty = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-empty' })
  await assert.rejects(
    workspaces.startMerge({ projectId: 'demo', sourceBranch: empty.branch }),
    (error) => error.code === 'INVALID_INPUT' && /новых коммитов/.test(error.message),
    'ветка без коммитов не должна сливаться',
  )
  // Ветка с изменениями, но без коммита — тоже отказ (requireClean).
  await writeFile(join(empty.path, 'shared.txt'), 'uncommitted\n')
  await assert.rejects(
    workspaces.startMerge({ projectId: 'demo', sourceBranch: empty.branch }),
    (error) => error.code === 'WORKSPACE_DIRTY',
    'незакоммиченные изменения обязаны блокировать merge',
  )
  // Policy конфигурируема: с отключёнными требованиями отказ другой.
  await assert.rejects(
    workspaces.startMerge({
      projectId: 'demo',
      sourceBranch: empty.branch,
      policy: { requireClean: false, requireCommits: true },
    }),
    (error) => error.code === 'INVALID_INPUT',
  )
  await workspaces.cleanupWorkspace(empty.workspaceId, { confirmDirty: true, confirmUnmerged: true })
}

// Все ветки-участницы ответвляются ЗАРАНЕЕ, от исходного main: только так
// B честно отстаёт от цели (§20), а C и D дают настоящий конфликт по той же
// строке. Ветка, созданная уже после чужого merge, конфликта не даст.
const laggingB = await makeWorkspace('sess-b', async (created) => {
  await writeFile(join(created.path, 'other.txt'), 'B\n')
  await commitAll(created.path, 'B', { name: 'Alex', email: 'alex@test' })
})
const conflictingC = await makeWorkspace('sess-c', async (created) => {
  await writeFile(join(created.path, 'shared.txt'), 'C-change\nline-2\nline-3\n')
  await commitAll(created.path, 'C', { name: 'Alex', email: 'alex@test' })
})
const conflictingD = await makeWorkspace('sess-d', async (created) => {
  await writeFile(join(created.path, 'shared.txt'), 'D-change\nline-2\nline-3\n')
  await commitAll(created.path, 'D', { name: 'Alex', email: 'alex@test' })
})

// --- Чистый merge: state machine и неподвижность target до финала ---------
const mainBefore = await revParse(canonical, 'main')
{
  const workspace = await makeWorkspace('sess-a', async (created) => {
    await writeFile(join(created.path, 'shared.txt'), 'A-change\nline-2\nline-3\n')
    await commitAll(created.path, 'A', { name: 'Alex', email: 'alex@test' })
  })

  const merge = await workspaces.startMerge({ projectId: 'demo', sourceBranch: workspace.branch })
  assert.equal(merge.status, 'COMPLETED')
  assert.equal(merge.targetBefore, mainBefore, 'зафиксирована точка отката target')
  assert.notEqual(merge.targetAfter, mainBefore, 'target продвинулся ровно на финальном шаге')
  assert.equal(merge.aheadOfTarget, 1)
  assert.equal(merge.behindTarget, 0)
  assert.equal(existsSync(merge.path), false, 'merge-worktree убран после успеха')
  // Журнал успешной операции пуст.
  assert.equal((await journal.listOpen()).filter(entry => entry.entityId === merge.mergeId).length, 0)

  const persisted = await workspaces.getMerge(merge.mergeId)
  assert.equal(persisted.status, 'COMPLETED')
}

// --- Свежесть базы (§20): источник отстал от target -----------------------
{
  // B ответвился от исходного main, а main уже ушёл вперёд после merge A.
  const merge = await workspaces.startMerge({ projectId: 'demo', sourceBranch: laggingB.branch })
  assert.equal(merge.status, 'COMPLETED')
  assert.ok(merge.behindTarget >= 1,
    'Runtime честно фиксирует, на сколько коммитов источник отставал от цели')
}

// --- Конфликт: target не двинут, маркеры сохранены, молча не решаем -------
{
  const targetBeforeConflict = await revParse(canonical, 'main')
  const merge = await workspaces.startMerge({ projectId: 'demo', sourceBranch: conflictingC.branch })

  assert.equal(merge.status, 'CONFLICT')
  assert.deepEqual(merge.conflicts, ['shared.txt'])
  assert.equal(await revParse(canonical, 'main'), targetBeforeConflict,
    'при конфликте целевая ветка обязана остаться нетронутой')
  assert.equal(existsSync(merge.path), true, 'merge-worktree остаётся для разрешения')
  const content = await readFile(join(merge.path, 'shared.txt'), 'utf8')
  assert.match(content, /<{7}/, 'конфликтные маркеры сохранены для ревью')

  // Журнал знает, что операция висит в фазе CONFLICT — это и есть
  // crash-устойчивость: перезапуск Runtime увидит незавершённый merge.
  const open = (await journal.listOpen()).filter(entry => entry.entityId === merge.mergeId)
  assert.equal(open.length, 1)
  assert.equal(open[0].phase, 'CONFLICT')

  // Незавершённый merge виден в списке активных.
  const active = await workspaces.listMerges({ projectId: 'demo', activeOnly: true })
  assert.equal(active.length, 1)
  assert.equal(active[0].mergeId, merge.mergeId)

  // Попытка завершить с неразрешёнными маркерами отклоняется.
  await assert.rejects(
    workspaces.completeMerge(merge.mergeId),
    (error) => error.code === 'MERGE_CONFLICT',
    'нельзя завершить merge, пока остались маркеры',
  )
  assert.equal(await revParse(canonical, 'main'), targetBeforeConflict)

  // Разрешаем и завершаем: только теперь target двигается.
  await writeFile(join(merge.path, 'shared.txt'), 'AC-merged\nline-2\nline-3\n')
  const completed = await workspaces.completeMerge(merge.mergeId)
  assert.equal(completed.status, 'COMPLETED')
  assert.equal(completed.resolvedConflicts, true)
  assert.notEqual(await revParse(canonical, 'main'), targetBeforeConflict)
  const { stdout } = await git(['-C', canonical, 'show', 'main:shared.txt'])
  assert.equal(stdout, 'AC-merged\nline-2\nline-3\n')
  assert.equal(existsSync(merge.path), false)
  assert.equal((await journal.listOpen()).filter(entry => entry.entityId === merge.mergeId).length, 0)
}

// --- Abort: ни следа, target на месте, журнал очищен ----------------------
{
  const before = await revParse(canonical, 'main')
  const merge = await workspaces.startMerge({ projectId: 'demo', sourceBranch: conflictingD.branch })
  assert.equal(merge.status, 'CONFLICT')

  const aborted = await workspaces.abortMerge(merge.mergeId)
  assert.equal(aborted.status, 'ABORTED')
  assert.equal(await revParse(canonical, 'main'), before, 'abort не двигает target')
  assert.equal(existsSync(merge.path), false)
  assert.equal((await journal.listOpen()).filter(entry => entry.entityId === merge.mergeId).length, 0)
  assert.deepEqual(await workspaces.listMerges({ projectId: 'demo', activeOnly: true }), [])
}

// --- Защищённая ветка как ИСТОЧНИК не превращается в workspace ------------
{
  await assert.rejects(
    workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-prot', branch: 'main' }),
    (error) => error.code === 'PROTECTED_BRANCH',
  )
  await assert.rejects(
    workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-prot', branch: 'release/2.0' }),
    (error) => error.code === 'PROTECTED_BRANCH',
  )
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime merge workflow tests passed.')
