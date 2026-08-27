// Флагманский E2E-сценарий командной AI-разработки (§62–§64 плана AI-качества).
//
// Полный конвейер на реальном git и реальных процессах:
//   два человека → две задачи с пересечением областей → два изолированных
//   worktree → независимая работа → verification → HIGH-дефект от
//   независимого reviewer → задача НЕ READY → починка → re-review →
//   adversarial для high-risk → main тем временем уехал релевантно →
//   явное решение по upstream → delivery (PR-модель) → READY_FOR_HUMAN_REVIEW
//   → merge → MERGED.
//
// Дополнительно: §63 — reviewer работает в read-сессии и НЕ получает
// write-lease рабочего workspace; §64 — параллельные writer'ы всегда в
// отдельных worktree и не видят незамёрдженную работу друг друга.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRuntime } from '../lib/api.js'
import { commitAll, git, revParse } from '../lib/gitx.js'

const identity = { name: 'Team', email: 'team@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra e2e team '))

// --- Проект: auth-сервис с собственным честным тестом ----------------------
const repo = join(base, 'project')
await git(['init', '-b', 'main', repo])
await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
await mkdir(join(repo, 'src', 'auth'), { recursive: true })
await writeFile(join(repo, 'src', 'auth', 'service.js'), [
  "import { parseToken } from './token.js'",
  'export function authenticate(rawToken, now) {',
  '  const token = parseToken(rawToken)',
  '  if (token.expiresAt <= now) return { ok: false, reason: "expired" }',
  '  return { ok: true, user: token.user }',
  '}',
  '',
].join('\n'))
await writeFile(join(repo, 'src', 'auth', 'token.js'), [
  'export function parseToken(raw) {',
  '  const [user, expiresAt] = String(raw).split(":")',
  '  return { user, expiresAt: Number(expiresAt) }',
  '}',
  '',
].join('\n'))
await writeFile(join(repo, 'test.mjs'), [
  "import assert from 'node:assert/strict'",
  "import { authenticate } from './src/auth/service.js'",
  "assert.deepEqual(authenticate('alex:200', 100), { ok: true, user: 'alex' })",
  "console.log('project tests passed')",
  '',
].join('\n'))
await writeFile(join(repo, 'AGENTS.md'), '# Правила проекта\n')
await commitAll(repo, 'init', identity)

const runtime = createRuntime({ env: { GILDRA_DSH_STATE_DIR: join(base, 'state') } })
const { projects, sessions, workspaces, tasks, quality, reviews, upstream, contextBuilder, leases } = runtime
await projects.register({ projectId: 'auth-app', path: repo })
await quality.setPolicy('auth-app', {
  required: ['tests', 'review'],
  checks: { tests: { argv: ['node', 'test.mjs'] } },
})

// --- 1–3. Две задачи, пересечение видно, два изолированных worktree --------
const taskA = (await tasks.createTask({
  projectId: 'auth-app', title: 'Change auth service', kind: 'feature', owner: 'alex',
  acceptanceCriteria: ['authenticate отклоняет просроченный токен', 'валидный токен проходит'],
  expectedAreas: ['src/auth/**', 'test.mjs'],
  claims: ['src/auth/**'],
})).task
const createdB = await tasks.createTask({
  projectId: 'auth-app', title: 'Change auth token handling', kind: 'feature', owner: 'peter',
  acceptanceCriteria: ['parseToken устойчив к мусору'],
  expectedAreas: ['src/auth/token.js'],
  claims: ['src/auth/token.js'],
})
assert.equal(createdB.overlaps.length, 1, 'Gildra обязана увидеть пересечение областей')
assert.equal(createdB.overlaps[0].owner, 'alex')
const overview = await tasks.teamOverview('auth-app')
assert.equal(overview.overlaps.length, 1, 'Team View показывает claims-пересечение')

const alexSession = await sessions.createSession({ projectId: 'auth-app', userId: 'alex', title: 'task A' })
const peterSession = await sessions.createSession({ projectId: 'auth-app', userId: 'peter', title: 'task B' })
const wsA = await workspaces.getRecord(alexSession.session.workspaceId)
const wsB = await workspaces.getRecord(peterSession.session.workspaceId)
assert.notEqual(wsA.path, wsB.path, 'два writer’а — два разных worktree (§64)')
await tasks.attachWorkspace(taskA.taskId, {
  workspaceId: wsA.workspaceId, sessionId: wsA.sessionId, branch: wsA.branch, baseSha: wsA.baseSha,
})
await tasks.attachWorkspace(createdB.task.taskId, {
  workspaceId: wsB.workspaceId, sessionId: wsB.sessionId, branch: wsB.branch, baseSha: wsB.baseSha,
})
await tasks.updateTask(taskA.taskId, { writerAgent: 'writer-17' })
await tasks.updateTask(createdB.task.taskId, { writerAgent: 'writer-21' })

// Writer получает компактный контекст с предупреждением о пересечении (§33).
{
  const { text } = await contextBuilder.buildTaskContext(createdB.task.taskId)
  assert.match(text, /Team overlap warning/)
  assert.match(text, /alex/)
}

// --- 4. Оба работают независимо -------------------------------------------
// Alex вносит ДЕФЕКТ: проверка истечения инвертируется частично (упускает
// граничный случай «ровно сейчас»), тесты проекта этого не ловят.
await writeFile(join(wsA.path, 'src', 'auth', 'service.js'), [
  "import { parseToken } from './token.js'",
  'export function authenticate(rawToken, now) {',
  '  const token = parseToken(rawToken)',
  '  if (token.expiresAt < now) return { ok: false, reason: "expired" }',
  '  return { ok: true, user: token.user }',
  '}',
  '',
].join('\n'))
await commitAll(wsA.path, 'feat: refine expiry handling', identity)

await writeFile(join(wsB.path, 'src', 'auth', 'token.js'), [
  'export function parseToken(raw) {',
  '  const [user, expiresAt] = String(raw ?? "").split(":")',
  '  return { user: user || "anonymous", expiresAt: Number(expiresAt) || 0 }',
  '}',
  '',
].join('\n'))
await commitAll(wsB.path, 'feat: harden token parsing', identity)

// Изоляция (§64): Peter не видит незамёрдженные правки Alex.
assert.match(readFileSync(join(wsB.path, 'src', 'auth', 'service.js'), 'utf8'), /<= now/,
  'worktree Питера не должен видеть незамёрдженную правку Алекса')

// --- 5. Задача A проходит тесты -------------------------------------------
const runA1 = await quality.runVerification(taskA.taskId)
assert.equal(runA1.checks.find(check => check.id === 'tests').status, 'PASSED',
  'дефект не покрыт тестами проекта — verification честно зелёный')

// --- 6–7. Независимый reviewer находит HIGH → задача НЕ READY --------------
await assert.rejects(reviews.requestReview(taskA.taskId, { reviewerAgent: 'writer-17' }),
  error => error.code === 'WRITER_REVIEWER_CONFLICT')
const review1 = await reviews.requestReview(taskA.taskId, { reviewerAgent: 'reviewer-4' })
assert.ok(review1.packet.diff.highRisk, 'auth-изменение обязано быть high-risk')
await reviews.submitReview(review1.review.reviewId, {
  verdict: 'CHANGES_REQUESTED',
  findings: [{
    severity: 'HIGH', category: 'CORRECTNESS', file: 'src/auth/service.js', line: 4,
    message: 'Граница истечения ослаблена: токен с expiresAt == now теперь проходит аутентификацию.',
    evidence: 'authenticate("u:100", 100) возвращает ok:true, до изменения — expired.',
  }],
  criteriaVerdicts: [{ met: false, note: 'просроченный (граничный) токен проходит' }, { met: true }],
})
assert.equal((await tasks.getTask(taskA.taskId)).status, 'FIXING_REVIEW')
await assert.rejects(quality.promoteIfReady(taskA.taskId),
  error => error.code === 'READINESS_REQUIRED', 'HIGH-дефект блокирует готовность (§62.7)')

// --- 8. Writer исправляет; re-verification; re-review + adversarial --------
await writeFile(join(wsA.path, 'src', 'auth', 'service.js'), [
  "import { parseToken } from './token.js'",
  'export function authenticate(rawToken, now) {',
  '  const token = parseToken(rawToken)',
  '  if (token.expiresAt <= now) return { ok: false, reason: "expired" }',
  '  return { ok: true, user: token.user, expiresAt: token.expiresAt }',
  '}',
  '',
].join('\n'))
await writeFile(join(wsA.path, 'test.mjs'), [
  "import assert from 'node:assert/strict'",
  "import { authenticate } from './src/auth/service.js'",
  "const granted = authenticate('alex:200', 100)",
  "assert.equal(granted.ok, true)",
  "assert.equal(granted.user, 'alex')",
  "assert.equal(granted.expiresAt, 200, 'фича задачи: срок жизни возвращается вызывающему')",
  "assert.equal(authenticate('alex:100', 100).ok, false, 'граничный токен обязан истечь')",
  "console.log('project tests passed')",
  '',
].join('\n'))
await commitAll(wsA.path, 'fix: restore expiry boundary, add regression assert', identity)
const runA2 = await quality.runVerification(taskA.taskId)
assert.equal(runA2.checks.find(check => check.id === 'tests').status, 'PASSED')

const review2 = await reviews.requestReview(taskA.taskId, { reviewerAgent: 'reviewer-4' })
await reviews.submitReview(review2.review.reviewId, {
  verdict: 'APPROVED', findings: [],
  criteriaVerdicts: [{ met: true }, { met: true }],
})
// High-risk без adversarial всё ещё не готов (§17).
{
  const verdict = await quality.readiness(taskA.taskId)
  assert.ok(verdict.blockers.some(blocker => blocker.id === 'ADVERSARIAL_REQUIRED'),
    `high-risk auth-диф требует adversarial: ${JSON.stringify(verdict.blockers)}`)
}
const adversarial = await reviews.requestReview(taskA.taskId, { reviewerAgent: 'reviewer-9', mode: 'adversarial' })
await reviews.submitReview(adversarial.review.reviewId, {
  verdict: 'APPROVED', findings: [],
  criteriaVerdicts: [{ met: true }, { met: true }],
  summary: 'Атаковал границу expiry и мусорные токены — сломать не удалось.',
})

// --- 10–12. Main тем временем уехал релевантно -----------------------------
await writeFile(join(repo, 'src', 'auth', 'service.js'),
  readFileSync(join(repo, 'src', 'auth', 'service.js'), 'utf8').replace(
    "import { parseToken } from './token.js'",
    "// upstream hardening note\nimport { parseToken } from './token.js'",
  ))
await commitAll(repo, 'upstream: annotate auth service', identity)
const upstreamVerdict = await upstream.assessUpstream(taskA.taskId)
assert.equal(upstreamVerdict.status, 'UPSTREAM_RELEVANT', 'сдвиг main затронул файл задачи')
{
  const verdict = await quality.readiness(taskA.taskId)
  assert.ok(verdict.blockers.some(blocker => blocker.id === 'UPSTREAM_RELEVANT'),
    'релевантный upstream требует явного решения (§62.12)')
}
await tasks.acknowledgeSignal(taskA.taskId, {
  signal: 'UPSTREAM_RELEVANT',
  explanation: 'Upstream добавил только комментарий над импортом; пересечения по смыслу нет, merge пройдёт текстово.',
})

// --- 13–14. Delivery и вычисленная готовность ------------------------------
await tasks.recordDelivery(taskA.taskId, {
  mode: 'PR', branchPushed: true,
  prUrl: 'https://github.com/acme/auth-app/pull/42', prNumber: 42, ciStatus: 'PASSED',
})
const finalVerdict = await quality.readiness(taskA.taskId)
assert.deepEqual(finalVerdict.blockers, [], `Definition of Done: ${JSON.stringify(finalVerdict.blockers)}`)
const promoted = await quality.promoteIfReady(taskA.taskId)
assert.equal(promoted.status, 'READY_FOR_HUMAN_REVIEW')

// Evidence — факты для UI (§49): проверки, ревью, diff.
assert.ok(finalVerdict.facts.some(fact => fact.kind === 'check' && fact.id === 'tests' && fact.status === 'PASSED'))
assert.ok(finalVerdict.facts.some(fact => fact.kind === 'review' && fact.modes.includes('adversarial')))

// --- §63: reviewer read-only, без write-lease ------------------------------
{
  // Reviewer читает ТОТ ЖЕ worktree через read-сессию: ни нового workspace,
  // ни write-lease — эксклюзивное право записи остаётся у writer-сессии.
  const readSession = await sessions.createSession({
    projectId: 'auth-app', userId: 'reviewer', mode: 'read', attachTo: wsA.workspaceId,
  })
  assert.equal(readSession.session.mode, 'read')
  assert.equal(readSession.session.workspaceId, wsA.workspaceId, 'read-сессия видит существующий workspace')
  const lease = await leases.stateOf(wsA.workspaceId)
  assert.equal(lease.state, 'ACTIVE', 'write-lease остаётся активным')
  assert.equal(lease.sessionId, wsA.sessionId, 'владелец lease — writer-сессия, не reviewer')
  assert.equal((await tasks.getTask(taskA.taskId)).reviewerAgent, 'reviewer-9')
}

// --- Merge и MERGED ---------------------------------------------------------
{
  // Canonical здесь — не-bare репозиторий пользователя, и его собственное
  // дерево держит main извлечённой: Runtime честно отказывает двигать ветку
  // под живым рабочим деревом (BRANCH_CHECKED_OUT). Освобождаем main так же,
  // как это сделал бы человек в своём репозитории.
  await assert.rejects(
    workspaces.startMerge({ projectId: 'auth-app', sourceBranch: wsA.branch, targetBranch: 'main' }),
    error => error.code === 'BRANCH_CHECKED_OUT',
  )
  await git(['-C', repo, 'switch', '--detach'])
  const merge = await workspaces.startMerge({ projectId: 'auth-app', sourceBranch: wsA.branch, targetBranch: 'main' })
  assert.equal(merge.status, 'COMPLETED', `merge: ${merge.status} ${merge.error ?? ''}`)
  const merged = await tasks.transition(taskA.taskId, 'MERGED')
  assert.equal(merged.status, 'MERGED')
  // Изменение Alex реально в main вместе с upstream-коммитом.
  const mainContent = await git(['-C', repo, 'show', 'main:src/auth/service.js'])
  assert.match(mainContent.stdout, /<= now/)
  assert.match(mainContent.stdout, /expiresAt: token.expiresAt/)
  assert.match(mainContent.stdout, /upstream hardening note/)
  assert.notEqual(await revParse(repo, 'main'), taskA.baseSha)
}

// Задача B продолжает жить независимо: её worktree цел, статус активен.
assert.equal(existsSync(wsB.path), true)
assert.ok(['PLANNED', 'IMPLEMENTING'].includes((await tasks.getTask(createdB.task.taskId)).status))

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime team collaboration E2E passed.')
