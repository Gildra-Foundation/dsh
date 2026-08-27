// Двух-Runtime E2E (§40 плана модульности): Alex и Peter — РАЗНЫЕ runtime
// root'ы (модель разных Unix-пользователей), общий project-origin и общий
// координационный «GitHub»-репозиторий.
//
// Сценарий (§40): claims → синхронизация через провайдера → semantic overlap
// до implementation → явная координация → изолированные worktree в разных
// root'ах → cross-layer shortcut пойман → починка → verification на immutable
// snapshot → CI-evidence по SHA → CODEOWNERS human-approval → обе задачи
// READY_FOR_HUMAN_REVIEW → доставка в общий origin без потери изменений.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRuntime } from '../lib/api.js'
import { commitAll, git, revParse } from '../lib/gitx.js'

const identity = { name: 'Team', email: 'team@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra team e2e '))

// --- Общая инфраструктура: project origin + координационный репозиторий ----
const seed = join(base, 'seed')
await git(['init', '-b', 'main', seed])
await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
await mkdir(join(seed, 'src', 'domain', 'auth'), { recursive: true })
await mkdir(join(seed, 'src', 'application'), { recursive: true })
await mkdir(join(seed, 'src', 'infrastructure'), { recursive: true })
await mkdir(join(seed, '.github'), { recursive: true })
await writeFile(join(seed, 'src', 'domain', 'auth', 'service.js'), [
  'export function issueToken(user) {',
  '  return `${user}:signed`',
  '}',
  '',
].join('\n'))
await writeFile(join(seed, 'src', 'application', 'auth-controller.js'), [
  "import { issueToken } from '../domain/auth/service.js'",
  'export function login(user) {',
  '  return { token: issueToken(user) }',
  '}',
  '',
].join('\n'))
await writeFile(join(seed, 'src', 'infrastructure', 'store.js'), 'export const save = value => value\n')
await writeFile(join(seed, 'test.mjs'), [
  "import assert from 'node:assert/strict'",
  "import { login } from './src/application/auth-controller.js'",
  "assert.equal(login('alex').token, 'alex:signed')",
  "console.log('project tests passed')",
  '',
].join('\n'))
await writeFile(join(seed, '.github', 'CODEOWNERS'), 'src/domain/** @security-team\n')
await commitAll(seed, 'init', identity)
const projectOrigin = join(base, 'project-origin.git')
await git(['clone', '--bare', seed, projectOrigin])

const coordinationOrigin = join(base, 'coordination.git')
await git(['clone', '--bare', seed, coordinationOrigin]) // содержимое неважно, важна ветка

// --- Два независимых Runtime («Unix-like roots», §22) ----------------------
function makeRuntime(person) {
  return createRuntime({
    env: {
      GILDRA_DSH_STATE_DIR: join(base, `runtime-${person}`, 'state'),
      GILDRA_TEAM_PROVIDER: 'github',
      GILDRA_TEAM_REPO: coordinationOrigin,
    },
  })
}
const alexRt = makeRuntime('alex')
const peterRt = makeRuntime('peter')
assert.notEqual(alexRt.roots.stateRoot, peterRt.roots.stateRoot, 'разные root — модель разных Unix-пользователей')
assert.equal(alexRt.team.backend, 'github')

// Каждый Runtime работает со СВОИМ клоном общего origin (у людей нет общего
// HOME и общего canonical).
async function adoptClone(rt, person) {
  const clone = join(base, `checkout-${person}`)
  await git(['clone', projectOrigin, clone])
  await git(['-C', clone, 'config', 'core.autocrlf', 'false'])
  // canonical с рабочим деревом держит main — освобождаем (как человек).
  await git(['-C', clone, 'switch', '--detach'])
  await rt.projects.register({ projectId: 'auth-app', path: clone })
  return clone
}
const alexClone = await adoptClone(alexRt, 'alex')
const peterClone = await adoptClone(peterRt, 'peter')

const ARCHITECTURE = {
  layers: [
    { id: 'domain', patterns: ['src/domain/**'], mayDependOn: [] },
    { id: 'application', patterns: ['src/application/**'], mayDependOn: ['domain'] },
    { id: 'infrastructure', patterns: ['src/infrastructure/**'], mayDependOn: ['application', 'domain'] },
  ],
  modules: [
    { id: 'auth.service', patterns: ['src/domain/auth/**'] },
    { id: 'auth.controller', patterns: ['src/application/**'] },
  ],
}
for (const rt of [alexRt, peterRt]) {
  await rt.quality.setPolicy('auth-app', {
    required: ['tests', 'review'],
    checks: { tests: { argv: ['node', 'test.mjs'] } },
    architecture: ARCHITECTURE,
    delivery: { requireCI: true, requireCodeOwners: true },
  })
}

// --- 1–2. Alex: Task A с MODULE-claim на auth.service ----------------------
const taskA = (await alexRt.tasks.createTask({
  projectId: 'auth-app', title: 'Sign tokens with expiry', owner: 'alex',
  acceptanceCriteria: ['токен несёт срок жизни', 'подпись проверяема'],
  expectedAreas: ['src/domain/auth/**', 'test.mjs'],
  claims: [{ type: 'MODULE', value: 'auth.service', mode: 'CLAIMED' }, 'src/domain/auth/**'],
})).task

const alexSession = await alexRt.sessions.createSession({ projectId: 'auth-app', userId: 'alex' })
const wsA = await alexRt.workspaces.getRecord(alexSession.session.workspaceId)
await alexRt.tasks.attachWorkspace(taskA.taskId, {
  workspaceId: wsA.workspaceId, sessionId: wsA.sessionId, branch: wsA.branch, baseSha: wsA.baseSha,
})
await alexRt.tasks.updateTask(taskA.taskId, { writerAgent: 'writer-alex' })
await alexRt.tasks.setModulePlan(taskA.taskId, {
  modulesToChange: [
    { module: 'auth.service', reason: 'подпись и срок жизни токена' },
    { module: '(root)', reason: 'обновление теста test.mjs' },
  ],
})
await alexRt.tasks.transition(taskA.taskId, 'IMPLEMENTING') // пересечений пока нет

// --- 3–7. Peter: Task B на auth.controller → semantic overlap --------------
const createdB = await peterRt.tasks.createTask({
  projectId: 'auth-app', title: 'Return expiry from login', owner: 'peter',
  acceptanceCriteria: ['login отдаёт срок жизни'],
  expectedAreas: ['src/application/**', 'test.mjs'],
  claims: [{ type: 'MODULE', value: 'auth.controller', mode: 'CLAIMED' }],
})
const taskB = createdB.task

const peterSession = await peterRt.sessions.createSession({ projectId: 'auth-app', userId: 'peter' })
const wsB = await peterRt.workspaces.getRecord(peterSession.session.workspaceId)
await peterRt.tasks.attachWorkspace(taskB.taskId, {
  workspaceId: wsB.workspaceId, sessionId: wsB.sessionId, branch: wsB.branch, baseSha: wsB.baseSha,
})
await peterRt.tasks.updateTask(taskB.taskId, { writerAgent: 'writer-peter' })
await peterRt.tasks.setModulePlan(taskB.taskId, {
  modulesToChange: [{ module: 'auth.controller', reason: 'прокинуть срок жизни в ответ' }],
})

// §40.6: semantic overlap — controller зависит от service, который занят Alex.
await assert.rejects(
  peterRt.tasks.transition(taskB.taskId, 'IMPLEMENTING'),
  error => error.code === 'OVERLAP_DECISION_REQUIRED'
    && error.details.semantic.some(entry => entry.type === 'SEMANTIC_OVERLAP' && entry.sharedModules.includes('auth.service')),
  'semantic overlap между Runtime обязан требовать координации',
)
// §40.7: оба фиксируют координацию.
await peterRt.tasks.recordOverlapDecision(taskB.taskId, { decision: 'COORDINATE', note: 'Согласовано: Alex меняет подпись, я — только формат ответа.' })
await alexRt.tasks.recordOverlapDecision(taskA.taskId, { decision: 'COORDINATE', note: 'Peter ждёт формат {token, expiresAt}.' })
await peterRt.tasks.transition(taskB.taskId, 'IMPLEMENTING')

// §40.8/11: worktree физически разные и в разных root'ах.
assert.ok(wsA.path.includes('runtime-alex') && wsB.path.includes('runtime-peter'))

// --- 9. Writer Alex: сперва cross-layer shortcut (§40.13) ------------------
await writeFile(join(wsA.path, 'src', 'domain', 'auth', 'service.js'), [
  "import { save } from '../../infrastructure/store.js'",
  'export function issueToken(user, now = 0) {',
  '  return save(`${user}:signed:${now + 3600}`)',
  '}',
  '',
].join('\n'))
await writeFile(join(wsA.path, 'test.mjs'), [
  "import assert from 'node:assert/strict'",
  "import { login } from './src/application/auth-controller.js'",
  "assert.equal(login('alex').token, 'alex:signed:3600')",
  "console.log('project tests passed')",
  '',
].join('\n'))
await commitAll(wsA.path, 'feat: expiry via infrastructure save', identity)
await alexRt.reviews.analyzeTask(taskA.taskId)
{
  // §40.12–14: analyzer ловит cross-layer, gate блокирует.
  const verdict = await alexRt.quality.readiness(taskA.taskId)
  assert.ok(verdict.blockers.some(blocker => blocker.id === 'ARCH:architecture-boundaries'),
    `cross-layer shortcut обязан блокировать: ${JSON.stringify(verdict.blockers.map(entry => entry.id))}`)
}

// §40.15: починка — без infrastructure в domain.
await writeFile(join(wsA.path, 'src', 'domain', 'auth', 'service.js'), [
  'export function issueToken(user, now = 0) {',
  '  return `${user}:signed:${now + 3600}`',
  '}',
  '',
].join('\n'))
await commitAll(wsA.path, 'fix: keep domain pure', identity)

// --- 10. Writer Peter: связанное изменение --------------------------------
await writeFile(join(wsB.path, 'src', 'application', 'auth-controller.js'), [
  "import { issueToken } from '../domain/auth/service.js'",
  'export function login(user, now = 0) {',
  '  const token = issueToken(user, now)',
  '  return { token, expiresAt: Number(token.split(":").at(-1)) || null }',
  '}',
  '',
].join('\n'))
await commitAll(wsB.path, 'feat: expose expiry', identity)

// §40.11: изменения физически не пересекаются.
{
  const changedA = (await git(['-C', wsA.path, 'diff', '--no-ext-diff', '--name-only', `${wsA.baseSha}..HEAD`])).stdout.split('\n').filter(Boolean)
  const changedB = (await git(['-C', wsB.path, 'diff', '--no-ext-diff', '--name-only', `${wsB.baseSha}..HEAD`])).stdout.split('\n').filter(Boolean)
  const both = changedA.filter(file => changedB.includes(file))
  assert.deepEqual(both, [], `файловых пересечений нет: ${both.join(',')}`)
}

// --- Полный DoD для обеих задач --------------------------------------------
let reviewerSeq = 0
async function openReview(rt, taskId, { reviewerAgent, mode = 'standard' }) {
  const task = await rt.tasks.getTask(taskId)
  const readSession = await rt.sessions.createSession({
    projectId: task.projectId, userId: `rvw${String(reviewerSeq += 1)}`,
    mode: 'read', attachTo: task.workspaceId,
  })
  const requested = await rt.reviews.requestReview(taskId, {
    reviewerAgent, reviewerSessionId: readSession.session.sessionId, mode,
  })
  const claimed = await rt.reviews.claimReview(requested.review.reviewId, {
    sessionId: readSession.session.sessionId, ownerToken: readSession.ownerToken,
  })
  return { ...requested, reviewerCapability: claimed.reviewerCapability }
}

async function driveToReady(rt, task, ws, reviewerName) {
  const verification = await rt.quality.runVerification(task.taskId)
  assert.equal(verification.snapshot.mode, 'COMMITTED', 'verification идёт на immutable snapshot (§40.16)')
  assert.equal(verification.checks.find(check => check.id === 'tests').status, 'PASSED')

  const review = await openReview(rt, task.taskId, { reviewerAgent: reviewerName })
  await rt.reviews.submitReview(review.review.reviewId, {
    capability: review.reviewerCapability,
    verdict: 'APPROVED', findings: [],
    criteriaVerdicts: (await rt.tasks.getTask(task.taskId)).acceptanceCriteria.map(() => ({ met: true })),
  })
  // auth-области high-risk → adversarial.
  const adversarial = await openReview(rt, task.taskId, { reviewerAgent: `${reviewerName}-adv`, mode: 'adversarial' })
  await rt.reviews.submitReview(adversarial.review.reviewId, {
    capability: adversarial.reviewerCapability,
    verdict: 'APPROVED', findings: [],
    criteriaVerdicts: (await rt.tasks.getTask(task.taskId)).acceptanceCriteria.map(() => ({ met: true })),
  })
  // Строгие сигналы (например BACKWARD_COMPATIBILITY от изменённой сигнатуры)
  // гасит REVIEWER — его актор восстанавливается из capability (§15).
  const reviewerActor = await rt.reviews.actorForCapability(task.taskId, review.reviewerCapability)
  assert.equal(reviewerActor?.type, 'AI_REVIEWER')
  for (const blocker of (await rt.quality.readiness(task.taskId)).blockers) {
    if (blocker.id.startsWith('SIGNAL_UNACKNOWLEDGED:')) {
      await rt.tasks.acknowledgeSignal(task.taskId, {
        signal: blocker.id.split(':')[1],
        explanation: 'Проверено ревьюером: изменение сигнатуры согласовано с Peter, вызовы обновлены.',
        verifiedActor: reviewerActor,
      })
    }
  }
  const head = (await rt.tasks.getTask(task.taskId)).analysis.headSha
  // §40.17: CI-evidence привязано к commit SHA.
  await rt.tasks.recordCiEvidence(task.taskId, { commitSha: head, conclusion: 'success', workflowRunId: `wf-${task.taskId}`, verifiedIntegration: { provider: 'github' } })
  // §40.18: CODEOWNERS-область (src/domain) требует человека — у Peter её
  // может не быть; approve фиксируем при необходимости.
  const verdictBefore = await rt.quality.readiness(task.taskId)
  if (verdictBefore.blockers.some(blocker => blocker.id === 'CODEOWNERS_REVIEW_REQUIRED')) {
    // Интерактивный канал (§6): host выдаёт одноразовую capability, действие
    // фиксируется после её расхода.
    const humanCap = await rt.capabilities.issue({
      role: 'HUMAN_ADMIN', scope: 'human:CODEOWNERS', taskId: task.taskId,
      headSha: (await rt.tasks.getTask(task.taskId)).analysis.headSha,
    })
    await rt.capabilities.consume(humanCap.capability, { role: 'HUMAN_ADMIN', scope: 'human:CODEOWNERS', taskId: task.taskId })
    await rt.tasks.recordHumanApproval(task.taskId, { kind: 'CODEOWNERS', actorId: 'security-team-human', verifiedHuman: true })
  }
  const verdict = await rt.quality.readiness(task.taskId)
  assert.deepEqual(verdict.blockers, [], `DoD ${task.taskId}: ${JSON.stringify(verdict.blockers)}`)
  const promoted = await rt.quality.promoteIfReady(task.taskId)
  assert.equal(promoted.status, 'READY_FOR_HUMAN_REVIEW') // §40.19
  return promoted
}

await driveToReady(alexRt, taskA, wsA, 'reviewer-4')
await driveToReady(peterRt, taskB, wsB, 'reviewer-9')

// Команда видит обе задачи из обоих Runtime (§34).
{
  const view = await peterRt.tasks.teamOverview('auth-app')
  const ids = Object.values(view.byOwner).flat().map(entry => entry.taskId)
  assert.ok(ids.includes(taskA.taskId) && ids.includes(taskB.taskId))
}

// --- 20. Доставка в общий origin без потери изменений ----------------------
// Alex: merge в свой canonical → push в общий origin.
{
  const merge = await alexRt.workspaces.startMerge({ projectId: 'auth-app', sourceBranch: wsA.branch, targetBranch: 'main' })
  assert.equal(merge.status, 'COMPLETED')
  await git(['-C', alexClone, 'push', 'origin', 'main'])
  await alexRt.tasks.transition(taskA.taskId, 'MERGED')
}
// Peter: подтягивает origin (там уже A), мержит своё, пушит.
{
  await git(['-C', peterClone, 'fetch', 'origin', '+refs/heads/*:refs/heads/*'])
  const merge = await peterRt.workspaces.startMerge({ projectId: 'auth-app', sourceBranch: wsB.branch, targetBranch: 'main' })
  assert.equal(merge.status, 'COMPLETED', `merge B: ${merge.status} ${merge.error ?? ''}`)
  await git(['-C', peterClone, 'push', 'origin', 'main'])
  await peterRt.tasks.transition(taskB.taskId, 'MERGED')
}
// Обе правки в общем origin: ни одна задача не перезаписала другую.
{
  const service = await git(['-C', projectOrigin, 'show', 'main:src/domain/auth/service.js'])
  const controller = await git(['-C', projectOrigin, 'show', 'main:src/application/auth-controller.js'])
  assert.match(service.stdout, /signed:\$\{now \+ 3600\}|signed:` \+ |signed:\$\{/, 'изменение Alex дожило до origin')
  assert.match(service.stdout, /now \+ 3600/)
  assert.match(controller.stdout, /expiresAt/, 'изменение Peter дожило до origin')
  assert.ok(!controller.stdout.includes('infrastructure'), 'cross-layer shortcut не просочился')
  assert.notEqual(await revParse(projectOrigin, 'main'), wsA.baseSha)
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime two-runtime team E2E passed.')
