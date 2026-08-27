// Quality Pipeline: verification, evidence, Definition of Done (§5–§7, §18,
// §66–§69 плана AI-качества).
//
// Доказываемые инварианты:
//   1. verification выполняет ТОЛЬКО argv-команды из политики; результат —
//      durable evidence с exit code и хвостом лога;
//   2. required-проверка без команды = NOT_CONFIGURED и блокирует готовность
//      (а не «PASSED по умолчанию»);
//   3. падающая проверка → Task не READY; promoteIfReady отклоняет с полным
//      списком блокеров (фальсификация gate);
//   4. evidence протухает: новый коммит → STALE_EVIDENCE; грязное дерево →
//      DIRTY_WORKSPACE;
//   5. таймаут — TIMED_OUT через штатный terminate;
//   6. отмена не удаляет workspace и оставляет структурный статус;
//   7. regression-first (§18): доказательство собирается из двух РЕАЛЬНЫХ
//      прогонов (проваленный → прошедший), словами его не сочинить;
//   8. только promoteIfReady переводит в READY_FOR_HUMAN_REVIEW.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, git } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { createProcessManager } from '../lib/processes.js'
import { createTaskManager } from '../lib/tasks.js'
import { createQualityManager, qualityPolicyOf } from '../lib/quality.js'

const base = await mkdtemp(join(tmpdir(), 'gildra quality '))
const repo = join(base, 'repo')
await git(['init', '-b', 'main', repo])
await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
await writeFile(join(repo, 'app.js'), 'export const ok = true\n')
await commitAll(repo, 'init', { name: 'Seed', email: 'seed@test' })

const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
await projects.register({ projectId: 'demo', path: repo })
const processes = createProcessManager({ store, roots })
const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })
const tasks = createTaskManager({ store, roots, projects })
const quality = createQualityManager({ store, roots, projects, tasks, workspaces, processes })

const identity = { name: 'Alex', email: 'alex@test' }

async function makeTask(overrides = {}) {
  const sessionId = `sess-q${String(makeTask.counter = (makeTask.counter ?? 0) + 1)}`
  const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId })
  const { task } = await tasks.createTask({
    projectId: 'demo',
    title: overrides.title ?? 'Quality task',
    kind: overrides.kind ?? 'feature',
    owner: 'alex',
    acceptanceCriteria: overrides.acceptanceCriteria ?? ['изменение работает'],
  })
  await tasks.attachWorkspace(task.taskId, {
    workspaceId: workspace.workspaceId,
    sessionId,
    branch: workspace.branch,
    baseSha: workspace.baseSha,
  })
  return { task: await tasks.getTask(task.taskId), workspace }
}

// Утилита: имитация APPROVED-ревью на задаче (реальный review-модуль
// проверяется отдельным набором; здесь тестируется сам gate).
async function approveReview(taskId, headSha, extra = {}) {
  const record = await tasks.getTask(taskId)
  await tasks.saveTask({
    ...record,
    review: {
      verdict: 'APPROVED', openBySeverity: {}, criteriaVerified: true,
      headSha, modes: ['standard'], ...extra,
    },
  })
}

// --- 1–2. Политика и honest NOT_CONFIGURED --------------------------------
{
  await assert.rejects(quality.setPolicy('demo', { checks: { tests: { argv: 'npm test' } } }), /argv-массивом/,
    'shell-строка не принимается — только argv')
  await quality.setPolicy('demo', {
    required: ['tests', 'lint', 'typecheck', 'review'],
    checks: {
      tests: { argv: ['node', '-e', 'console.log("tests ok")'] },
      lint: { argv: ['node', '-e', 'console.error("lint broken"); process.exit(1)'] },
    },
  })
  const policy = qualityPolicyOf(await projects.get('demo'))
  assert.deepEqual(policy.required, ['tests', 'lint', 'typecheck', 'review'])
  assert.equal(policy.checks.typecheck, undefined)
}

const { task, workspace } = await makeTask()

// --- Verification: evidence с фактами -------------------------------------
{
  const run = await quality.runVerification(task.taskId)
  assert.equal(run.status, 'COMPLETED')
  assert.equal(run.headSha.length, 40)
  const tests = run.checks.find(check => check.id === 'tests')
  assert.equal(tests.status, 'PASSED')
  assert.equal(tests.exitCode, 0)
  assert.match(tests.logTail, /tests ok/, 'хвост лога хранится в evidence')
  assert.equal(existsSync(tests.logPath), true, 'полный лог — отдельный файл, не JSON-state')
  const lint = run.checks.find(check => check.id === 'lint')
  assert.equal(lint.status, 'FAILED')
  assert.equal(lint.exitCode, 1)
  assert.match(lint.logTail, /lint broken/)
  const typecheck = run.checks.find(check => check.id === 'typecheck')
  assert.equal(typecheck.status, 'NOT_CONFIGURED', 'ненастроенная проверка не притворяется PASSED')

  // --- 3. Gate: падающая проверка блокирует готовность --------------------
  const verdict = await quality.readiness(task.taskId)
  assert.equal(verdict.ready, false)
  const ids = verdict.blockers.map(blocker => blocker.id)
  assert.ok(ids.includes('CHECK_FAILED:lint'), `нет CHECK_FAILED:lint в ${ids.join(',')}`)
  assert.ok(ids.includes('CHECK_NOT_CONFIGURED:typecheck'))
  assert.ok(ids.includes('REVIEW_MISSING'))
  await assert.rejects(quality.promoteIfReady(task.taskId),
    error => error.code === 'READINESS_REQUIRED' && error.details.blockers.length >= 3,
    'promote обязан отклонить с полным списком блокеров')
  assert.equal((await tasks.getTask(task.taskId)).status !== 'READY_FOR_HUMAN_REVIEW', true)
}

// --- Полный зелёный путь: единственная дорога в READY ---------------------
{
  await quality.setPolicy('demo', {
    required: ['tests', 'review'],
    checks: { tests: { argv: ['node', '-e', 'console.log("ok")'] } },
  })
  const run = await quality.runVerification(task.taskId)
  assert.equal(run.checks.find(check => check.id === 'tests').status, 'PASSED')

  // Ревью ещё нет → не READY.
  assert.equal((await quality.readiness(task.taskId)).ready, false)
  await approveReview(task.taskId, run.headSha)
  const verdict = await quality.readiness(task.taskId)
  assert.deepEqual(verdict.blockers, [], `неожиданные блокеры: ${JSON.stringify(verdict.blockers)}`)
  const promoted = await quality.promoteIfReady(task.taskId)
  assert.equal(promoted.status, 'READY_FOR_HUMAN_REVIEW')

  // --- 4. Evidence протухает ----------------------------------------------
  await writeFile(join(workspace.path, 'app.js'), 'export const ok = 2\n')
  const dirtyVerdict = await quality.readiness(task.taskId)
  assert.ok(dirtyVerdict.blockers.some(blocker => blocker.id === 'DIRTY_WORKSPACE'),
    'грязное дерево делает доказательство неполным')
  await commitAll(workspace.path, 'change', identity)
  const staleVerdict = await quality.readiness(task.taskId)
  assert.ok(staleVerdict.blockers.some(blocker => blocker.id === 'STALE_EVIDENCE'),
    'новый коммит обязан протушить evidence')
}

// --- 5. Таймаут через штатный terminate -----------------------------------
{
  const slow = await makeTask({ title: 'Timeout task' })
  await quality.setPolicy('demo', {
    required: ['tests', 'review'],
    checks: { tests: { argv: ['node', '-e', 'setTimeout(() => {}, 30000)'], timeoutMs: 400 } },
  })
  const run = await quality.runVerification(slow.task.taskId)
  assert.equal(run.checks.find(check => check.id === 'tests').status, 'TIMED_OUT')
  const verdict = await quality.readiness(slow.task.taskId)
  assert.ok(verdict.blockers.some(blocker => blocker.id === 'CHECK_FAILED:tests'),
    'TIMED_OUT — это не PASSED')
}

// --- 6. Отмена: структурный статус, workspace жив --------------------------
{
  const target = await makeTask({ title: 'Cancel task' })
  await quality.setPolicy('demo', {
    required: ['tests', 'review'],
    checks: {
      first: { argv: ['node', '-e', 'setTimeout(() => {}, 15000)'], timeoutMs: 20000 },
      second: { argv: ['node', '-e', 'console.log("never")'] },
    },
  })
  const pending = quality.runVerification(target.task.taskId, { checkIds: ['first', 'second'] })
  // Ждём, пока прогон ИМЕННО ЭТОЙ задачи реально начнётся: запись RUNNING
  // плюс живой verify-процесс её сессии.
  const deadline = Date.now() + 10_000
  let runId
  for (;;) {
    for (const id of await store.list('verifications')) {
      const row = await store.read('verifications', id)
      if (row?.taskId === target.task.taskId && row.status === 'RUNNING') runId = id
    }
    const procs = await processes.listForSession(target.workspace.sessionId)
    if (runId && procs.some(record => record.role === 'verify')) break
    if (Date.now() > deadline) throw new Error('verification не стартовал')
    await new Promise(resolveTimer => setTimeout(resolveTimer, 25))
  }
  await quality.cancelVerification(runId)
  const finished = await pending
  assert.equal(finished.status, 'CANCELLED')
  assert.equal(finished.checks.find(check => check.id === 'second').status, 'CANCELLED')
  assert.equal(existsSync(target.workspace.path), true, 'отмена не удаляет workspace (§69)')
}

// --- 7. Regression-first bugfix (§18) -------------------------------------
{
  const bug = await makeTask({ title: 'Bug', kind: 'bugfix' })
  await quality.setPolicy('demo', {
    required: ['tests', 'review'],
    checks: { tests: { argv: ['node', '--input-type=module', '-e', "import { readFileSync } from 'node:fs'; process.exit(readFileSync('app.js', 'utf8').includes('fixed') ? 0 : 1)"] } },
  })
  // Прогон при воспроизведённом баге — падает.
  const failing = await quality.runVerification(bug.task.taskId)
  assert.equal(failing.checks[0].status, 'FAILED', 'баг должен быть воспроизведён')
  // Чиним и коммитим.
  await writeFile(join(bug.workspace.path, 'app.js'), 'export const ok = "fixed"\n')
  await commitAll(bug.workspace.path, 'fix bug', identity)
  const passing = await quality.runVerification(bug.task.taskId)
  assert.equal(passing.checks[0].status, 'PASSED')

  // Словами regression не сочинить: порядок и статусы проверяются по записям.
  await assert.rejects(quality.recordRegression(bug.task.taskId, { failingRunId: passing.runId, passingRunId: passing.runId }),
    /не содержит ни одной FAILED/)
  await assert.rejects(quality.recordRegression(bug.task.taskId, { failingRunId: passing.runId, passingRunId: failing.runId }),
    /FAILED|зелёным/)
  await quality.recordRegression(bug.task.taskId, { failingRunId: failing.runId, passingRunId: passing.runId })
  assert.equal((await tasks.getTask(bug.task.taskId)).regression.status, 'PROVEN')

  await approveReview(bug.task.taskId, passing.headSha)
  const verdict = await quality.readiness(bug.task.taskId)
  assert.deepEqual(verdict.blockers, [], `bugfix с regression-доказательством готов: ${JSON.stringify(verdict.blockers)}`)

  // Без regression bugfix не проходит.
  const record = await tasks.getTask(bug.task.taskId)
  await tasks.saveTask({ ...record, regression: undefined })
  assert.ok((await quality.readiness(bug.task.taskId)).blockers.some(blocker => blocker.id === 'REGRESSION_REQUIRED'))
  await assert.rejects(quality.recordRegression(bug.task.taskId, { manualReproOnly: true, reason: 'коротко' }), /содержательной/)
  await quality.recordRegression(bug.task.taskId, { manualReproOnly: true, reason: 'Требуется реальное железо принтера: воспроизводится только на устройстве.' })
  assert.equal((await tasks.getTask(bug.task.taskId)).regression.status, 'MANUAL_REPRO_ONLY')
}

// Лог-файлы лежат в state/logs/verify, а не в JSON.
{
  const anyRun = await store.read('verifications', (await store.list('verifications'))[0])
  const raw = await readFile(store.filePath('verifications', anyRun.runId), 'utf8')
  assert.ok(raw.length < 64 * 1024, 'полные stdout-логи не должны попадать в JSON-state')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime quality pipeline tests passed.')
