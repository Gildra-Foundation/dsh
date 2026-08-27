// Public API gate (§18, §24): UNEXPLAINED_PUBLIC_API_CHANGE существует в
// коде, а не только в документации.
//
//   1. удалённый export без плана → сигнал, gate public-api FAILED (BLOCK);
//   2. декларация в Module Change Plan (publicContractsChanged) закрывает
//      gate заранее;
//   3. policy-классификация совместимой области (publicApiCompatible)
//      закрывает gate;
//   4. правка тела с сохранением сигнатуры export — не сигнал;
//   5. интеграция: human-approval PUBLIC_API на текущем HEAD снимает блокер
//      readiness (§18 путь 3).

import assert from 'node:assert/strict'

import { analyzeModularity } from '../lib/modularity.js'

function tree(files) {
  return { files: Object.keys(files), read: async path => files[path] }
}

async function run({ before, after, changed, added = {}, removed = {}, architecture, modulePlan }) {
  const beforeTree = tree(before)
  const afterTree = tree(after)
  return analyzeModularity({
    filesBefore: beforeTree.files,
    readBefore: beforeTree.read,
    filesAfter: afterTree.files,
    readAfter: afterTree.read,
    changedFiles: changed,
    addedByFile: new Map(Object.entries(added)),
    removedByFile: new Map(Object.entries(removed)),
    architecture,
    modulePlan,
  })
}
const codesOf = result => result.signals.map(signal => signal.code)
const checkOf = (result, id) => result.checks.find(check => check.id === id)

const beforeApi = { 'src/api.js': 'export function oldName(a) {\n  return a\n}\nexport const keep = 1\n' }

// --- 1. Удалённый export без объяснения -------------------------------------
{
  const after = { 'src/api.js': 'export const keep = 1\n' }
  const result = await run({
    before: beforeApi, after, changed: ['src/api.js'],
    removed: { 'src/api.js': ['export function oldName(a) {'] },
  })
  const signal = result.signals.find(entry => entry.code === 'UNEXPLAINED_PUBLIC_API_CHANGE')
  assert.ok(signal, `удалённый export обязан дать сигнал: ${codesOf(result).join(',')}`)
  assert.equal(signal.detail.changes[0].name, 'oldName')
  assert.equal(checkOf(result, 'public-api').status, 'FAILED', 'gate BLOCK по умолчанию')
}

// --- 2. Декларация в плане закрывает gate -----------------------------------
{
  const after = { 'src/api.js': 'export const keep = 1\n' }
  const result = await run({
    before: beforeApi, after, changed: ['src/api.js'],
    removed: { 'src/api.js': ['export function oldName(a) {'] },
    modulePlan: { publicContractsChanged: ['oldName'] },
  })
  assert.ok(!codesOf(result).includes('UNEXPLAINED_PUBLIC_API_CHANGE'),
    'заранее декларированное изменение контракта — не unexplained')
  assert.equal(checkOf(result, 'public-api').status, 'PASSED')
}

// --- 3. Policy-классификация совместимой области ----------------------------
{
  const after = { 'src/api.js': 'export const keep = 1\n' }
  const result = await run({
    before: beforeApi, after, changed: ['src/api.js'],
    removed: { 'src/api.js': ['export function oldName(a) {'] },
    architecture: { publicApiCompatible: ['src/api.js'] },
  })
  assert.ok(!codesOf(result).includes('UNEXPLAINED_PUBLIC_API_CHANGE'),
    'policy классифицировала область как совместимую')
}

// --- 4. Правка тела с сохранением сигнатуры ---------------------------------
{
  const after = { 'src/api.js': 'export function oldName(a) {\n  return a + 1\n}\nexport const keep = 1\n' }
  const result = await run({
    before: beforeApi, after, changed: ['src/api.js'],
    removed: { 'src/api.js': ['export function oldName(a) {'] },
    added: { 'src/api.js': ['export function oldName(a) {', '  return a + 1'] },
  })
  assert.ok(!codesOf(result).includes('UNEXPLAINED_PUBLIC_API_CHANGE'),
    'изменение тела при сохранении export-имени — не breaking')
}

// --- 5. Интеграция: human PUBLIC_API approval снимает блокер ----------------
{
  const { mkdtemp, rm, writeFile: wf } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { commitAll, git } = await import('../lib/gitx.js')
  const { runtimeRoots } = await import('../lib/paths.js')
  const { JsonStore } = await import('../lib/store.js')
  const { createProjectRegistry } = await import('../lib/projects.js')
  const { createWorkspaceManager } = await import('../lib/workspaces.js')
  const { createProcessManager } = await import('../lib/processes.js')
  const { createTaskManager } = await import('../lib/tasks.js')
  const { createQualityManager } = await import('../lib/quality.js')
  const { createRepoIntel } = await import('../lib/repo-intel.js')
  const { createReviewManager } = await import('../lib/review.js')

  const identity = { name: 'Alex', email: 'alex@test' }
  const base = await mkdtemp(join(tmpdir(), 'gildra public api '))
  const repo = join(base, 'repo')
  await git(['init', '-b', 'main', repo])
  await wf(join(repo, 'api.js'), 'export function oldName(a) {\n  return a\n}\n')
  await commitAll(repo, 'init', identity)

  const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
  const store = new JsonStore(roots.stateRoot)
  await store.ensureRoot()
  const projects = createProjectRegistry({ store, roots })
  await projects.register({ projectId: 'demo', path: repo })
  const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })
  const processes = createProcessManager({ store, roots })
  const tasks = createTaskManager({ store, roots, projects })
  const quality = createQualityManager({ store, roots, projects, tasks, workspaces, processes })
  const repoIntel = createRepoIntel({ store, roots, projects })
  const reviews = createReviewManager({ store, roots, projects, tasks, workspaces, repoIntel })
  await quality.setPolicy('demo', { required: ['review'], checks: {} }, { verifiedAdmin: { actorId: 'admin' } })

  const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 's-api' })
  const { task } = await tasks.createTask({ projectId: 'demo', title: 'Break API', owner: 'alex', acceptanceCriteria: ['ok'] })
  await tasks.attachWorkspace(task.taskId, {
    workspaceId: workspace.workspaceId, sessionId: 's-api',
    branch: workspace.branch, baseSha: workspace.baseSha,
  })
  await wf(join(workspace.path, 'api.js'), 'export function newName(a) {\n  return a\n}\n')
  await commitAll(workspace.path, 'rename export', identity)
  await reviews.analyzeTask(task.taskId)

  let verdict = await quality.readiness(task.taskId)
  assert.ok(verdict.blockers.some(blocker => blocker.id === 'ARCH:public-api'),
    `breaking rename без плана блокирует: ${JSON.stringify(verdict.blockers.map(entry => entry.id))}`)

  // Human-approval на текущем HEAD снимает блокер (§18 путь 3).
  await tasks.saveTask({
    ...(await tasks.getTask(task.taskId)),
    humanApprovals: [{ kind: 'PUBLIC_API', actorType: 'HUMAN', actorId: 'human', headSha: (await tasks.getTask(task.taskId)).analysis.headSha, createdAt: new Date().toISOString() }],
  })
  verdict = await quality.readiness(task.taskId)
  assert.ok(!verdict.blockers.some(blocker => blocker.id === 'ARCH:public-api'))
  assert.ok(verdict.facts.some(fact => fact.id === 'public-api' && fact.status === 'APPROVED_BY_HUMAN'))

  await rm(base, { recursive: true, force: true })
}

console.log('Gildra Runtime public API gate tests passed.')
