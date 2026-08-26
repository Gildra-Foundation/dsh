// Флагманский интеграционный тест архитектуры изоляции (см. задание §36):
// два независимых worktree над одним canonical-репозиторием, независимые
// ветки, неизменный main, ожидаемый merge-конфликт и cleanup, не задевающий
// соседнюю сессию. Весь стенд живёт в каталоге С ПРОБЕЛОМ в имени — это
// одновременно инвариант Windows-путей (§39).

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonStore } from '../lib/store.js'
import { runtimeRoots } from '../lib/paths.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { commitAll, dirtyFiles, git, revParse } from '../lib/gitx.js'

const base = await mkdtemp(join(tmpdir(), 'gildra runtime '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })

// --- Канонический bare-репозиторий с историей на main ---------------------
const seed = join(base, 'seed repo')
await git(['init', '-b', 'main', seed])
await writeFile(join(seed, 'README.md'), '# demo\n')
await writeFile(join(seed, 'shared.txt'), 'line-1\nline-2\nline-3\n')
await commitAll(seed, 'initial', { name: 'Seed', email: 'seed@test' })
const canonical = join(base, 'repos', 'demo.git')
await git(['clone', '--bare', seed, canonical])

const project = await projects.register({ projectId: 'demo', path: canonical })
assert.equal(project.defaultBranch, 'main')
assert.deepEqual(project.protectedBranches, ['main', 'master', 'production', 'release/*'])
const mainShaBefore = await revParse(canonical, 'main')

// --- Валидации создания ---------------------------------------------------
await assert.rejects(
  workspaces.createWorkspace({ projectId: 'missing', userId: 'alex', sessionId: 'sess-x' }),
  (error) => error.code === 'PROJECT_NOT_FOUND',
)
await assert.rejects(
  workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-x', branch: 'main' }),
  (error) => error.code === 'PROTECTED_BRANCH',
)
await assert.rejects(
  workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-x', branch: 'release/1.0' }),
  (error) => error.code === 'PROTECTED_BRANCH',
)
await assert.rejects(
  workspaces.createWorkspace({ projectId: 'demo', userId: 'Алекс', sessionId: 'sess-x' }),
  (error) => error.code === 'INVALID_ID',
)

// --- Две сессии одного пользователя + сессия второго пользователя ---------
const a = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-a' })
const b = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-b' })
const p = await workspaces.createWorkspace({ projectId: 'demo', userId: 'peter', sessionId: 'sess-p' })
assert.equal(a.branch, 'session/alex/sess-a')
assert.equal(b.branch, 'session/alex/sess-b')
assert.equal(p.branch, 'session/peter/sess-p')
assert.ok(a.path.includes(join('workspaces', 'demo', 'alex', 'sess-a')))
assert.notEqual(a.path, b.path)

// Дубликат сессии отклоняется.
await assert.rejects(
  workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-a' }),
  (error) => error.code === 'WORKSPACE_EXISTS',
)

// --- Изоляция незакоммиченных изменений (§36) -----------------------------
await writeFile(join(a.path, 'shared.txt'), 'A-change\nline-2\nline-3\n')
await writeFile(join(b.path, 'shared.txt'), 'B-change\nline-2\nline-3\n')

assert.equal(await readFile(join(a.path, 'shared.txt'), 'utf8'), 'A-change\nline-2\nline-3\n')
assert.equal(await readFile(join(b.path, 'shared.txt'), 'utf8'), 'B-change\nline-2\nline-3\n')
assert.equal(await readFile(join(p.path, 'shared.txt'), 'utf8'), 'line-1\nline-2\nline-3\n',
  'третья сессия не видит чужих незакоммиченных изменений')
assert.equal((await dirtyFiles(a.path)).length, 1)
assert.equal((await dirtyFiles(p.path)).length, 0)

// Canonical main не изменился.
assert.equal(await revParse(canonical, 'main'), mainShaBefore)
const { stdout: mainShared } = await git(['-C', canonical, 'show', 'main:shared.txt'])
assert.equal(mainShared, 'line-1\nline-2\nline-3\n')

// --- Коммиты независимы; статус видит ahead/dirty -------------------------
await commitAll(a.path, 'A: change first line', { name: 'Alex', email: 'alex@test' })
const statusA = await workspaces.workspaceStatus(a.workspaceId)
assert.equal(statusA.dirtyFiles, 0)
assert.equal(statusA.ahead, 1)
assert.equal(statusA.currentBranch, 'session/alex/sess-a')
const statusB = await workspaces.workspaceStatus(b.workspaceId)
assert.equal(statusB.dirtyFiles, 1)
assert.equal(statusB.ahead, 0)

// Ветка A не видна в worktree B как изменение файлов.
assert.equal(await readFile(join(b.path, 'shared.txt'), 'utf8'), 'B-change\nline-2\nline-3\n')

// --- Merge A → main: чистое объединение -----------------------------------
const mergeA = await workspaces.startMerge({ projectId: 'demo', sourceBranch: a.branch })
assert.equal(mergeA.status, 'completed')
assert.equal(existsSync(mergeA.path), false, 'merge-worktree удаляется после успеха')
const { stdout: mainAfterA } = await git(['-C', canonical, 'show', 'main:shared.txt'])
assert.equal(mainAfterA, 'A-change\nline-2\nline-3\n')
assert.notEqual(await revParse(canonical, 'main'), mainShaBefore)

// C ответвляется сейчас (base = main с A-change) и меняет ту же первую
// строку — после будущего merge B в main это даст конфликт для сценария
// abort ниже.
const c = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-c' })
await writeFile(join(c.path, 'shared.txt'), 'C-version\nline-2\nline-3\n')
await commitAll(c.path, 'C: rewrite first line', { name: 'Alex', email: 'alex@test' })

// --- Merge B → main: ожидаемый конфликт, никакого молчаливого разрешения --
await commitAll(b.path, 'B: change first line differently', { name: 'Alex', email: 'alex@test' })
const mergeB = await workspaces.startMerge({ projectId: 'demo', sourceBranch: b.branch })
assert.equal(mergeB.status, 'conflict')
assert.deepEqual(mergeB.conflicts, ['shared.txt'])
assert.equal(existsSync(mergeB.path), true, 'конфликтный merge-worktree остаётся для разрешения')
const conflicted = await readFile(join(mergeB.path, 'shared.txt'), 'utf8')
assert.match(conflicted, /<{7}/)
assert.match(conflicted, />{7}/)

// completeMerge с неразрешёнными конфликтами отклоняется.
await assert.rejects(workspaces.completeMerge(mergeB.mergeId), (error) => error.code === 'MERGE_CONFLICT')

// Разрешаем конфликт и завершаем merge.
await writeFile(join(mergeB.path, 'shared.txt'), 'AB-merged\nline-2\nline-3\n')
const completed = await workspaces.completeMerge(mergeB.mergeId)
assert.equal(completed.status, 'completed')
const { stdout: mainAfterB } = await git(['-C', canonical, 'show', 'main:shared.txt'])
assert.equal(mainAfterB, 'AB-merged\nline-2\nline-3\n')
assert.equal(existsSync(mergeB.path), false)

// --- Merge с конфликтом можно отменить без следов -------------------------
const mainBeforeAbort = await revParse(canonical, 'main')
const mergeC = await workspaces.startMerge({ projectId: 'demo', sourceBranch: c.branch })
assert.equal(mergeC.status, 'conflict')
const aborted = await workspaces.abortMerge(mergeC.mergeId)
assert.equal(aborted.status, 'aborted')
assert.equal(await revParse(canonical, 'main'), mainBeforeAbort, 'abort не двигает main')
assert.equal(existsSync(mergeC.path), false)

// --- Cleanup: план, guard'ы, безопасность соседей -------------------------
// B влита в main → удаляется без подтверждений.
const planB = await workspaces.cleanupPlan(b.workspaceId)
assert.equal(planB.removable, true)
await workspaces.cleanupWorkspace(b.workspaceId)
assert.equal(existsSync(b.path), false)
assert.equal((await store.read('workspaces', b.workspaceId)) === undefined, true)

// Сосед P полностью жив: файлы на месте, git работает, изменения делаются.
assert.equal(existsSync(p.path), true)
assert.equal(await readFile(join(p.path, 'shared.txt'), 'utf8'), 'line-1\nline-2\nline-3\n')
await writeFile(join(p.path, 'peter.txt'), 'peter was here\n')
assert.equal((await dirtyFiles(p.path)).length, 1)

// P: dirty + не влита → без подтверждений нельзя; dry-run объясняет причины.
// У P нет собственных коммитов — ветка тривиально «влита», причина одна.
const planP = await workspaces.cleanupPlan(p.workspaceId)
assert.equal(planP.removable, false)
assert.deepEqual(planP.reasons.map(reason => reason.code), ['WORKSPACE_DIRTY'])
await assert.rejects(workspaces.cleanupWorkspace(p.workspaceId), (error) => error.code === 'WORKSPACE_DIRTY')
await workspaces.cleanupWorkspace(p.workspaceId, { confirmDirty: true })
assert.equal(existsSync(p.path), false)

// C остаётся: canonical знает про его worktree, adoptExistingWorktrees пуст
// (все известны store), статус живой.
assert.deepEqual(await workspaces.adoptExistingWorktrees('demo'), [])
assert.equal((await workspaces.workspaceStatus(c.workspaceId)).worktreePresent, true)

// C: коммит есть, merge отменён → чистый worktree, но невлитая ветка.
const planC = await workspaces.cleanupPlan(c.workspaceId)
assert.equal(planC.removable, false)
assert.deepEqual(planC.reasons.map(reason => reason.code), ['BRANCH_NOT_MERGED'])
await assert.rejects(workspaces.cleanupWorkspace(c.workspaceId), (error) => error.details?.branchNotMerged === true)
await workspaces.cleanupWorkspace(c.workspaceId, { confirmUnmerged: true })
assert.equal(existsSync(c.path), false)

// --- Лимиты ---------------------------------------------------------------
const limited = createWorkspaceManager({ store, roots, projects, env: { GILDRA_DSH_MAX_WORKSPACES_PER_USER: '1' } })
await assert.rejects(
  limited.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-over' }),
  (error) => error.code === 'LIMIT_EXCEEDED',
)

// --- Реестр проектов ------------------------------------------------------
await assert.rejects(projects.register({ projectId: 'demo', path: canonical }), (error) => error.code === 'PROJECT_EXISTS')
await assert.rejects(projects.register({ projectId: 'x', path: join(base, 'nope') }), (error) => error.code === 'INVALID_INPUT')
await assert.rejects(projects.register({ projectId: 'x' }), (error) => error.code === 'INVALID_INPUT')
await assert.rejects(
  projects.register({ projectId: 'x', repoUrl: 'https://github.com/a/b', path: canonical }),
  (error) => error.code === 'INVALID_INPUT',
)
await assert.rejects(projects.resolveBaseRef(project, 'no-such-ref'), (error) => error.code === 'INVALID_INPUT')
assert.equal((await projects.fetchProject('demo')).fetched, false, 'локальный проект не фетчится')
assert.equal((await projects.list()).length, 1)

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime workspace isolation tests passed.')
