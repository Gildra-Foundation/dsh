// Authority abuse (§22 плана): десять сценариев подделки полномочий.
// Каждый сценарий — попытка writer'а обойти конвейер штатными вызовами;
// каждая обязана закончиться структурным отказом.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRuntime } from '../lib/api.js'
import { commitAll, git } from '../lib/gitx.js'

const identity = { name: 'Writer', email: 'w@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra authority '))
const repo = join(base, 'repo')
await git(['init', '-b', 'main', repo])
await writeFile(join(repo, 'app.js'), 'export const ok = 1\n')
await commitAll(repo, 'init', identity)

const runtime = createRuntime({ env: { GILDRA_DSH_STATE_DIR: join(base, 'state') } })
const { projects, sessions, workspaces, tasks, quality, reviews, repoIntel, capabilities, leases } = runtime
await projects.register({ projectId: 'demo', path: repo })
await quality.setPolicy('demo', {
  required: ['review'],
  checks: {},
  delivery: { requireCodeOwners: false },
}, { verifiedAdmin: { actorId: 'bootstrap-admin' } })

// Writer-задача с workspace и коммитом.
const writerSession = await sessions.createSession({ projectId: 'demo', userId: 'writer' })
const workspace = await workspaces.getRecord(writerSession.session.workspaceId)
const { task } = await tasks.createTask({ projectId: 'demo', title: 'Authority probes', owner: 'writer', acceptanceCriteria: ['ok'] })
await tasks.attachWorkspace(task.taskId, {
  workspaceId: workspace.workspaceId, sessionId: workspace.sessionId,
  branch: workspace.branch, baseSha: workspace.baseSha,
})
await tasks.updateTask(task.taskId, { writerAgent: 'writer-1' })
await writeFile(join(workspace.path, 'app.js'), 'export const ok = 2\n')
await commitAll(workspace.path, 'change', identity)

// Независимая read-сессия НАСТОЯЩЕГО ревьюера.
const reviewerRead = await sessions.createSession({ projectId: 'demo', userId: 'reviewer', mode: 'read', attachTo: workspace.workspaceId })

// --- 1. Fake reviewer name: имя без сессии/capability ----------------------
await assert.rejects(
  reviews.requestReview(task.taskId, { reviewerAgent: 'reviewer' }),
  error => error.code === 'INVALID_INPUT' && /read-сессии/.test(error.message),
  'имя ревьюера без независимой сессии не принимается',
)

// --- 2. Writer не получает review capability из request --------------------
const requested = await reviews.requestReview(task.taskId, {
  reviewerAgent: 'reviewer', reviewerSessionId: reviewerRead.session.sessionId,
})
assert.equal(requested.reviewerCapability, undefined, 'request не отдаёт capability вызывающему')
assert.equal(JSON.stringify(requested).includes('capabilityHash'), false)

// --- 3. Claim чужой сессией / чужим токеном --------------------------------
const strangerRead = await sessions.createSession({ projectId: 'demo', userId: 'stranger', mode: 'read', attachTo: workspace.workspaceId })
await assert.rejects(
  reviews.claimReview(requested.review.reviewId, { sessionId: strangerRead.session.sessionId, ownerToken: strangerRead.ownerToken }),
  error => error.code === 'WRITER_REVIEWER_CONFLICT',
  'claim разрешён только сессии из review request',
)
await assert.rejects(
  reviews.claimReview(requested.review.reviewId, { sessionId: reviewerRead.session.sessionId, ownerToken: writerSession.ownerToken }),
  error => error.code === 'UNAUTHORIZED_SESSION',
  'writer-токен не открывает reviewer-сессию',
)

// --- 4. Reviewer session = write-сессия (write lease) ----------------------
await assert.rejects(
  reviews.requestReview(task.taskId, { reviewerAgent: 'rev2', reviewerSessionId: writerSession.session.sessionId }),
  error => error.code === 'WRITER_REVIEWER_CONFLICT' && /read-сессии/.test(error.message),
  'сессия с write-lease не бывает независимым reviewer’ом',
)
// Sanity: lease workspace задачи действительно у writer-сессии.
assert.equal((await leases.stateOf(workspace.workspaceId)).sessionId, workspace.sessionId)

// --- 5. Fake human: слово «human» без capability ----------------------------
await assert.rejects(
  tasks.recordHumanApproval(task.taskId, { kind: 'CODEOWNERS', actorId: 'totally-a-human' }),
  error => error.code === 'CAPABILITY_REQUIRED',
)

// --- 6. Fake CI: выдуманный workflowRunId без интеграции --------------------
await assert.rejects(
  tasks.recordCiEvidence(task.taskId, {
    commitSha: 'a'.repeat(40), conclusion: 'success', workflowRunId: 'totally-real-run', source: 'github',
  }),
  error => error.code === 'CAPABILITY_REQUIRED',
)

// --- 7. Writer меняет Quality Policy ---------------------------------------
await assert.rejects(
  quality.setPolicy('demo', { required: [] }),
  error => error.code === 'CAPABILITY_REQUIRED',
  'writer не ослабляет собственный Definition of Done',
)

// --- 8. Writer одобряет verification command --------------------------------
await assert.rejects(
  repoIntel.approveCommands('demo', [{ id: 'test', argv: ['npm', 'test'] }]),
  error => error.code === 'CAPABILITY_REQUIRED',
)

// --- 9. Reused capability ----------------------------------------------------
{
  const oneTime = await capabilities.issue({ role: 'HUMAN_ADMIN', scope: 'human:CODEOWNERS', taskId: task.taskId })
  await capabilities.consume(oneTime.capability, { role: 'HUMAN_ADMIN', scope: 'human:CODEOWNERS', taskId: task.taskId })
  await assert.rejects(
    capabilities.consume(oneTime.capability, { role: 'HUMAN_ADMIN', scope: 'human:CODEOWNERS', taskId: task.taskId }),
    error => error.code === 'CAPABILITY_INVALID' && error.details.reason === 'USED',
  )
}

// --- 10. Expired + чужая задача/review --------------------------------------
{
  const short = await capabilities.issue({ role: 'AI_REVIEWER', scope: 'review-submit', entityId: 'review-x', taskId: task.taskId })
  const record = await runtime.store.read('capabilities', short.capId)
  await runtime.store.write('capabilities', short.capId, { ...record, expiresAt: new Date(Date.now() - 1000).toISOString() })
  await assert.rejects(capabilities.verify(short.capability), error => error.details.reason === 'EXPIRED')

  // Честный claim настоящим ревьюером; его capability не подходит к ЧУЖОМУ
  // review.
  const claimed = await reviews.claimReview(requested.review.reviewId, {
    sessionId: reviewerRead.session.sessionId, ownerToken: reviewerRead.ownerToken,
  })
  const foreign = await reviews.requestReview(task.taskId, {
    reviewerAgent: 'rev3', reviewerSessionId: strangerRead.session.sessionId,
  })
  await assert.rejects(
    reviews.submitReview(foreign.review.reviewId, {
      capability: claimed.reviewerCapability,
      verdict: 'APPROVED', findings: [], criteriaVerdicts: [{ met: true }],
    }),
    error => error.code === 'WRITER_REVIEWER_CONFLICT',
    'capability одного review не открывает другой',
  )
  // Правильная capability на СВОЁМ review работает.
  const submitted = await reviews.submitReview(requested.review.reviewId, {
    capability: claimed.reviewerCapability,
    verdict: 'APPROVED', findings: [], criteriaVerdicts: [{ met: true }],
  })
  assert.equal(submitted.verdict, 'APPROVED')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime authority abuse tests passed.')
