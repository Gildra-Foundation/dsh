// Upstream Awareness (§23–§25 плана AI-качества).
//
// Доказываемые инварианты:
//   1. неподвижная цель → UP_TO_DATE;
//   2. нерелевантный сдвиг (docs) → UPSTREAM_UNRELATED, работа не блокируется;
//   3. релевантность по expected areas, по фактическим файлам и по
//      import-соседям (1 шаг);
//   4. UPSTREAM_RELEVANT блокирует готовность, пока сдвиг не рассмотрен явно;
//   5. Runtime не делает rebase: worktree задачи остаётся на своей базе.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, git, revParse } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { createTaskManager } from '../lib/tasks.js'
import { createRepoIntel } from '../lib/repo-intel.js'
import { createReviewManager } from '../lib/review.js'
import { createUpstreamMonitor } from '../lib/upstream.js'
import { createQualityManager } from '../lib/quality.js'
import { createProcessManager } from '../lib/processes.js'

const identity = { name: 'Alex', email: 'alex@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra upstream '))
const repo = join(base, 'repo')
await git(['init', '-b', 'main', repo])
await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
await mkdir(join(repo, 'src', 'auth'), { recursive: true })
await mkdir(join(repo, 'docs'), { recursive: true })
await writeFile(join(repo, 'src', 'auth', 'service.js'), 'export function login() {\n  return 1\n}\n')
await writeFile(join(repo, 'src', 'controller.js'), "import { login } from './auth/service.js'\nexport const go = () => login()\n")
await writeFile(join(repo, 'docs', 'readme.md'), '# docs\n')
await commitAll(repo, 'init', identity)

const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
await projects.register({ projectId: 'demo', path: repo })
const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })
const tasks = createTaskManager({ store, roots, projects })
const processes = createProcessManager({ store, roots })
const repoIntel = createRepoIntel({ store, roots, projects })
const reviews = createReviewManager({ store, roots, projects, tasks, workspaces, repoIntel })
const quality = createQualityManager({ store, roots, projects, tasks, workspaces, processes })
const upstream = createUpstreamMonitor({ roots, projects, tasks })

// Задача работает над controller.js (импортирует auth/service.js).
const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-u1' })
const { task } = await tasks.createTask({
  projectId: 'demo', title: 'Controller change', owner: 'alex',
  acceptanceCriteria: ['контроллер работает'],
  expectedAreas: ['src/controller.js'],
})
await tasks.attachWorkspace(task.taskId, {
  workspaceId: workspace.workspaceId, sessionId: 'sess-u1',
  branch: workspace.branch, baseSha: workspace.baseSha,
})
await writeFile(join(workspace.path, 'src', 'controller.js'), "import { login } from './auth/service.js'\nexport const go = () => login() + 1\n")
await commitAll(workspace.path, 'task work', identity)
await reviews.analyzeTask(task.taskId)

// --- 1. Неподвижная цель --------------------------------------------------
{
  const verdict = await upstream.assessUpstream(task.taskId)
  assert.equal(verdict.status, 'UP_TO_DATE')
  assert.equal(verdict.behind, 0)
}

// --- 2. Нерелевантный сдвиг ------------------------------------------------
{
  // Двигаем main напрямую в canonical-репозитории (у него своё дерево).
  await writeFile(join(repo, 'docs', 'readme.md'), '# docs v2\n')
  await commitAll(repo, 'docs change', identity)
  const verdict = await upstream.assessUpstream(task.taskId)
  assert.equal(verdict.status, 'UPSTREAM_UNRELATED')
  assert.equal(verdict.behind, 1)
  assert.deepEqual(verdict.relevantFiles, [])
  assert.match(verdict.recommendation, /пересечений с задачей не найдено/)
}

// --- 3а. Релевантность по import-соседу -----------------------------------
{
  await writeFile(join(repo, 'src', 'auth', 'service.js'), 'export function login() {\n  return 2\n}\n')
  await commitAll(repo, 'auth service change', identity)
  const verdict = await upstream.assessUpstream(task.taskId)
  assert.equal(verdict.status, 'UPSTREAM_RELEVANT', 'изменён файл, который импортирует задача')
  assert.deepEqual(verdict.relevantFiles, ['src/auth/service.js'])
  assert.match(verdict.recommendation, /Рекомендуется обновить базу/)
  assert.equal(verdict.behind, 2)
}

// --- 3б. Релевантность по expected area и фактическому файлу --------------
{
  await writeFile(join(repo, 'src', 'controller.js'), "import { login } from './auth/service.js'\nexport const go = () => login() * 3\n")
  await commitAll(repo, 'controller upstream change', identity)
  const verdict = await upstream.assessUpstream(task.taskId)
  assert.equal(verdict.status, 'UPSTREAM_RELEVANT')
  assert.ok(verdict.relevantFiles.includes('src/controller.js'))
}

// --- 4. Релевантный сдвиг блокирует готовность до явного решения ----------
{
  const verdict = await quality.readiness(task.taskId)
  assert.ok(verdict.blockers.some(blocker => blocker.id === 'UPSTREAM_RELEVANT'),
    `релевантный upstream обязан быть блокером: ${JSON.stringify(verdict.blockers)}`)
  await tasks.acknowledgeSignal(task.taskId, {
    signal: 'UPSTREAM_RELEVANT',
    explanation: 'Сдвиг рассмотрен: изменение login() совместимо, задача переиграна на свежих тестах.',
  })
  const after = await quality.readiness(task.taskId)
  assert.ok(!after.blockers.some(blocker => blocker.id === 'UPSTREAM_RELEVANT'))
}

// --- 5. Никакого автоматического rebase (§25) ------------------------------
{
  const head = await revParse(workspace.path, 'HEAD')
  const baseStill = await git(['-C', workspace.path, 'merge-base', 'HEAD', 'main'])
  assert.equal(baseStill.stdout.trim(), workspace.baseSha, 'база worktree не сдвинута Runtime’ом')
  assert.equal((await revParse(workspace.path, 'HEAD')), head)
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime upstream awareness tests passed.')
