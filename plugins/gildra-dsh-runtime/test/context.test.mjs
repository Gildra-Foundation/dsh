// Task Context Builder (§32–§35, §55 плана AI-качества).
//
// Доказываемые инварианты:
//   1. контекст содержит критерии, scope, доверенные команды и DoD;
//   2. policy-файлы и ADR передаются ПУТЯМИ, README не инлайнится;
//   3. подбираются только ADR, относящиеся к затронутым областям;
//   4. пересечения команды и upstream-предупреждение попадают в контекст;
//   5. контекст компактен (жёсткий потолок), «дампа всего» нет.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, git } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { createTaskManager } from '../lib/tasks.js'
import { createRepoIntel } from '../lib/repo-intel.js'
import { createQualityManager } from '../lib/quality.js'
import { createProcessManager } from '../lib/processes.js'
import { createContextBuilder, relevantAdrFiles } from '../lib/context-builder.js'

const identity = { name: 'Alex', email: 'alex@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra context '))
const repo = join(base, 'repo')
await git(['init', '-b', 'main', repo])
await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
await mkdir(join(repo, 'docs', 'adr'), { recursive: true })
await mkdir(join(repo, 'lib'), { recursive: true })
await writeFile(join(repo, 'AGENTS.md'), '# Правила\nОчень важные.\n')
await writeFile(join(repo, 'README.md'), `# Огромный README\n${'строка\n'.repeat(500)}`)
await writeFile(join(repo, 'docs', 'adr', '0001-lease-fencing.md'), '# ADR лизы\n')
await writeFile(join(repo, 'docs', 'adr', '0002-ui-palette.md'), '# ADR палитра\n')
await writeFile(join(repo, 'lib', 'leases.js'), 'export const lease = 1\n')
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
const quality = createQualityManager({ store, roots, projects, tasks, workspaces, processes })
const contextBuilder = createContextBuilder({ projects, tasks, workspaces, repoIntel })
const adminSetPolicy = (id, policy) => quality.setPolicy(id, policy, { verifiedAdmin: { actorId: 'test-admin' } })

await adminSetPolicy('demo', {
  required: ['tests', 'review'],
  checks: { tests: { argv: ['node', '-e', 'process.exit(0)'] } },
  protectedAreas: ['.github/**'],
})

// --- 3. Подбор ADR по областям (unit) --------------------------------------
{
  const adr = ['docs/adr/0001-lease-fencing.md', 'docs/adr/0002-ui-palette.md', 'docs/adr/0003-port-allocation.md']
  assert.deepEqual(relevantAdrFiles(adr, ['lib/leases.js']), ['docs/adr/0001-lease-fencing.md'])
  assert.deepEqual(relevantAdrFiles(adr, ['src/ports.js']), ['docs/adr/0003-port-allocation.md'])
  assert.deepEqual(relevantAdrFiles(adr, ['docs/manual.md']), [])
}

// --- Полный контекст задачи -------------------------------------------------
const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-c1' })
const { task } = await tasks.createTask({
  projectId: 'demo', title: 'Fix lease takeover', kind: 'bugfix', owner: 'alex',
  acceptanceCriteria: ['перехват не теряет generation', 'есть регрессионный тест'],
  expectedAreas: ['lib/leases.js', 'test/**'],
  claims: ['lib/leases.js'],
})
await tasks.attachWorkspace(task.taskId, {
  workspaceId: workspace.workspaceId, sessionId: 'sess-c1',
  branch: workspace.branch, baseSha: workspace.baseSha,
})
// Соседняя задача в той же области — для overlap-предупреждения.
await tasks.createTask({ projectId: 'demo', title: 'Lease telemetry', owner: 'peter', claims: ['lib/**'] })
// Upstream-настрой: сымитируем уже вычисленную релевантную оценку.
await tasks.saveTask({
  ...(await tasks.getTask(task.taskId)),
  upstream: { status: 'UPSTREAM_RELEVANT', behind: 2, recommendation: 'Рекомендуется обновить базу.' },
})

{
  const { text, structured } = await contextBuilder.buildTaskContext(task.taskId)
  // 1. Критерии, scope, доверенные команды, DoD.
  assert.match(text, /перехват не теряет generation/)
  assert.match(text, /Expected scope: lib\/leases\.js, test\/\*\*/)
  assert.match(text, /tests: node -e process\.exit\(0\)/)
  assert.match(text, /Definition of Done: required = tests, review/)
  assert.match(text, /Protected areas .*\.github/)

  // 2. Policy — путями; README не инлайнится ни путём, ни содержимым.
  assert.match(text, /Project rules .*AGENTS\.md/)
  assert.ok(!text.includes('Огромный README'), 'README не должен инлайниться')
  assert.ok(!structured.policyFiles.includes('README.md'))

  // 3. Только релевантный ADR.
  assert.match(text, /docs\/adr\/0001-lease-fencing\.md/)
  assert.ok(!text.includes('0002-ui-palette'), 'нерелевантный ADR не подмешивается')

  // 4. Пересечения и upstream.
  assert.match(text, /Team overlap warning/)
  assert.match(text, /peter.*lib\/\*\*/)
  assert.match(text, /UPSTREAM_RELEVANT/)
  assert.match(text, /Prefer repository evidence over assumptions/)

  // 5. Компактность.
  assert.ok(text.length < 8200, `контекст слишком большой: ${String(text.length)}`)
  assert.equal(structured.trustedCommands.length, 1)
  assert.equal(structured.overlaps.length, 1)
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime task context builder tests passed.')
