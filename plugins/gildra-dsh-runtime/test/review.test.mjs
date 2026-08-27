// Независимое ревью и diff-анализ (§14–§22, §36–§38 плана AI-качества).
//
// Доказываемые инварианты:
//   1. writer НЕ может ревьюить сам себя (WRITER_REVIEWER_CONFLICT);
//   2. диff-анализ на реальном репозитории находит: ослабление тестов,
//      добавленную зависимость, опасный паттерн, выход за scope, правку
//      protected-области и generated-файла, изменение экспорта;
//   3. вердикт консистентен: APPROVED с открытым HIGH/BLOCKER или
//      неподтверждёнными критериями невозможен;
//   4. CHANGES_REQUESTED возвращает задачу в FIXING_REVIEW;
//   5. непогашенные сигналы блокируют готовность; после объяснения — нет;
//   6. high-risk diff требует adversarial-ревью; закрыть finding может только
//      reviewer;
//   7. APPROVED протухает вместе с headSha: новый коммит → verdict STALE.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, git } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { createProcessManager } from '../lib/processes.js'
import { createTaskManager } from '../lib/tasks.js'
import { createQualityManager } from '../lib/quality.js'
import { createRepoIntel } from '../lib/repo-intel.js'
import { createReviewManager } from '../lib/review.js'
import { dependencyDelta, isTestPath } from '../lib/diff-analyzer.js'

const identity = { name: 'Alex', email: 'alex@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra review '))
const repo = join(base, 'repo')
await git(['init', '-b', 'main', repo])
await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
await mkdir(join(repo, 'src'), { recursive: true })
await mkdir(join(repo, 'test'), { recursive: true })
await mkdir(join(repo, '.github', 'workflows'), { recursive: true })
await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { left: '1.0.0' } }, null, 2))
await writeFile(join(repo, 'src', 'auth.js'), 'export function login() {\n  return true\n}\n')
await writeFile(join(repo, 'test', 'auth.test.js'), 'assert(login())\nassert(logout())\n')
await writeFile(join(repo, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
await writeFile(join(repo, 'dist.generated.js'), 'generated artifact\n')
await commitAll(repo, 'init', identity)

const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
await projects.register({ projectId: 'demo', path: repo })
const processes = createProcessManager({ store, roots })
const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })
const tasks = createTaskManager({ store, roots, projects })
const quality = createQualityManager({ store, roots, projects, tasks, workspaces, processes })
const repoIntel = createRepoIntel({ store, roots, projects })
const reviews = createReviewManager({ store, roots, projects, tasks, workspaces, repoIntel })

await quality.setPolicy('demo', {
  required: ['tests', 'review'],
  checks: { tests: { argv: ['node', '-e', 'console.log("ok")'] } },
  protectedAreas: ['.github/workflows/**'],
  generatedFiles: ['*.generated.js'],
})

// --- Unit: dependencyDelta и isTestPath -----------------------------------
{
  const delta = dependencyDelta(
    JSON.stringify({ dependencies: { left: '1.0.0', gone: '2.0.0' } }),
    JSON.stringify({ dependencies: { left: '1.1.0' }, devDependencies: { fresh: '3.0.0' } }),
  )
  assert.deepEqual(delta.added, [{ name: 'fresh', section: 'devDependencies', version: '3.0.0' }])
  assert.deepEqual(delta.removed, [{ name: 'gone', section: 'dependencies' }])
  assert.deepEqual(delta.changed, [{ name: 'left', section: 'dependencies', from: '1.0.0', to: '1.1.0' }])

  assert.equal(isTestPath('test/auth.test.js'), true)
  assert.equal(isTestPath('src/deep/thing.spec.ts'), true)
  assert.equal(isTestPath('pkg/foo_test.go'), true)
  assert.equal(isTestPath('src/auth.js'), false)
}

// --- Задача с «плохим» diff: все сигналы ----------------------------------
const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-r1' })
const { task } = await tasks.createTask({
  projectId: 'demo', title: 'Auth change', owner: 'alex',
  acceptanceCriteria: ['логин работает', 'тесты добавлены'],
  expectedAreas: ['src/auth.js', 'test/**'],
})
await tasks.attachWorkspace(task.taskId, {
  workspaceId: workspace.workspaceId, sessionId: 'sess-r1',
  branch: workspace.branch, baseSha: workspace.baseSha,
})
await tasks.updateTask(task.taskId, { writerAgent: 'writer-17' })
// Module Change Plan (§6): без него переход в IMPLEMENTING запрещён.
await tasks.setModulePlan(task.taskId, {
  modulesToChange: [
    { module: 'src', reason: 'правка auth-сервиса' },
    { module: 'test', reason: 'обновление тестов auth' },
  ],
})

// Изменения: ослабленный тест, новая зависимость, опасный паттерн, файл вне
// scope, protected workflow, generated-файл, удалённый export.
await writeFile(join(workspace.path, 'src', 'auth.js'), 'export function loginRenamed() {\n  return spawn("x", { shell: true })\n}\n')
await writeFile(join(workspace.path, 'test', 'auth.test.js'), 'it.skip("login", () => {})\n')
await writeFile(join(workspace.path, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { left: '1.0.0', 'brand-new-dep': '9.9.9' } }, null, 2))
await writeFile(join(workspace.path, 'src', 'unrelated.js'), 'export const stray = 1\n')
await writeFile(join(workspace.path, '.github', 'workflows', 'ci.yml'), 'name: ci\non: push\n')
await writeFile(join(workspace.path, 'dist.generated.js'), 'manually edited\n')
await commitAll(workspace.path, 'risky change', identity)

{
  const analysis = await reviews.analyzeTask(task.taskId)
  const kinds = analysis.signals.map(signal => signal.kind)
  assert.ok(kinds.includes('TEST_WEAKENING'), `нет TEST_WEAKENING: ${kinds.join(',')}`)
  assert.ok(kinds.includes('DEPENDENCY_CHANGE'))
  assert.ok(kinds.includes('UNEXPECTED_CHANGE'))
  assert.ok(kinds.includes('PROTECTED_AREA_CHANGE'))
  assert.ok(kinds.includes('GENERATED_FILE_EDIT'))
  assert.ok(kinds.includes('BACKWARD_COMPATIBILITY'), 'удалённый export обязан дать сигнал совместимости')
  assert.ok(analysis.dangerous.some(entry => entry.id === 'shell-true'), 'shell: true — опасный паттерн')
  assert.ok(analysis.tests.weakening.some(entry => entry.id === 'test-skip'))
  assert.ok(analysis.tests.assertsRemoved > analysis.tests.assertsAdded)
  assert.deepEqual(analysis.dependencies.details.added.map(dep => dep.name), ['brand-new-dep'])
  assert.deepEqual(analysis.scope.unexpectedFiles.sort(), ['.github/workflows/ci.yml', 'dist.generated.js', 'package.json', 'src/unrelated.js'])
  assert.equal(analysis.highRisk, true, 'auth + workflows + опасный паттерн = high risk')

  // Сводка легла на задачу для readiness.
  const stored = (await tasks.getTask(task.taskId)).analysis
  assert.equal(stored.highRisk, true)
  assert.ok(stored.signals.length >= 5)
}

let firstReviewCapability

// --- 1. Writer не ревьюит сам себя ----------------------------------------
await assert.rejects(
  reviews.requestReview(task.taskId, { reviewerAgent: 'writer-17' }),
  error => error.code === 'WRITER_REVIEWER_CONFLICT',
)

// --- 3–4. Консистентность вердикта и возврат writer'у ---------------------
{
  const { review, packet, reviewerCapability } = await reviews.requestReview(task.taskId, { reviewerAgent: 'reviewer-4' })
  assert.equal(review.capabilityHash, undefined, 'хэш capability наружу не отдаётся')

  // §13: правильное ИМЯ без capability — подделка, отклоняется.
  await assert.rejects(
    reviews.submitReview(review.reviewId, {
      verdict: 'APPROVED', findings: [], criteriaVerdicts: [{ met: true }, { met: true }],
    }),
    error => error.code === 'WRITER_REVIEWER_CONFLICT' && /capability/.test(error.message),
    'имя ревьюера не является подтверждением личности',
  )
  await assert.rejects(
    reviews.submitReview(review.reviewId, {
      capability: 'a'.repeat(48),
      verdict: 'APPROVED', findings: [], criteriaVerdicts: [{ met: true }, { met: true }],
    }),
    error => error.code === 'WRITER_REVIEWER_CONFLICT',
  )
  assert.equal((await tasks.getTask(task.taskId)).status, 'REVIEWING')
  assert.equal(packet.acceptanceCriteria.length, 2, 'reviewer получает критерии')
  assert.ok(packet.diff.signals.length >= 5, 'reviewer получает сигналы анализа')
  assert.ok(packet.evidence === undefined || packet.evidence.checks, 'пакет структурный')

  const highFinding = {
    severity: 'HIGH', category: 'CORRECTNESS', file: 'src/auth.js', line: 2,
    message: 'login переименован — вызывающие сломаны, тесты пропущены через it.skip',
  }
  await assert.rejects(
    reviews.submitReview(review.reviewId, {
      capability: reviewerCapability,
      verdict: 'APPROVED', findings: [highFinding],
      criteriaVerdicts: [{ met: true }, { met: true }],
    }),
    /APPROVED невозможен/,
    'одобрить с открытым HIGH нельзя',
  )
  await assert.rejects(
    reviews.submitReview(review.reviewId, { capability: reviewerCapability, verdict: 'APPROVED', findings: [], criteriaVerdicts: [{ met: true }] }),
    /каждому из 2 критериев/,
  )
  const submitted = await reviews.submitReview(review.reviewId, {
    capability: reviewerCapability,
    verdict: 'CHANGES_REQUESTED',
    findings: [highFinding, { severity: 'NIT', category: 'MAINTAINABILITY', message: 'имя функции читается двусмысленно' }],
    criteriaVerdicts: [{ met: false, note: 'вызовы login() сломаны' }, { met: false, note: 'тест выключен' }],
  })
  assert.equal(submitted.findings.length, 2)
  firstReviewCapability = reviewerCapability
  const after = await tasks.getTask(task.taskId)
  assert.equal(after.status, 'FIXING_REVIEW', 'CHANGES_REQUESTED возвращает задачу writer’у')
  assert.equal(after.review.verdict, 'CHANGES_REQUESTED')
  assert.equal(after.review.openBySeverity.HIGH, 1)
}

// --- Writer чинит; re-review + adversarial; сигналы объясняются -----------
{
  // Чиним: возвращаем export, включаем тест, откатываем лишнее.
  await writeFile(join(workspace.path, 'src', 'auth.js'), 'export function login() {\n  return true\n}\nexport function loginRenamed() {\n  return login()\n}\n')
  await writeFile(join(workspace.path, 'test', 'auth.test.js'), 'assert(login())\nassert(loginRenamed())\nassert(logout())\n')
  await unlink(join(workspace.path, 'src', 'unrelated.js'))
  await writeFile(join(workspace.path, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
  await writeFile(join(workspace.path, 'dist.generated.js'), 'generated artifact\n')
  await commitAll(workspace.path, 'fix review findings', identity)
  await tasks.transition(task.taskId, 'IMPLEMENTING')

  const analysis = await reviews.analyzeTask(task.taskId)
  const kinds = analysis.signals.map(signal => signal.kind)
  assert.ok(!kinds.includes('PROTECTED_AREA_CHANGE'), 'откат protected-правки снимает сигнал')
  assert.ok(!kinds.includes('GENERATED_FILE_EDIT'))
  // Зависимость и scope package.json остались — их объясняем явно.
  assert.ok(kinds.includes('DEPENDENCY_CHANGE'))

  const verification = await quality.runVerification(task.taskId)
  assert.equal(verification.checks.find(check => check.id === 'tests').status, 'PASSED')

  const second = await reviews.requestReview(task.taskId, { reviewerAgent: 'reviewer-4' })
  await reviews.submitReview(second.review.reviewId, {
    capability: second.reviewerCapability,
    verdict: 'APPROVED', findings: [],
    criteriaVerdicts: [{ met: true }, { met: true }],
  })

  // --- 6. High-risk требует adversarial ----------------------------------
  let verdict = await quality.readiness(task.taskId)
  assert.ok(verdict.blockers.some(blocker => blocker.id === 'ADVERSARIAL_REQUIRED'),
    `high-risk без adversarial не готов: ${JSON.stringify(verdict.blockers)}`)

  const adversarial = await reviews.requestReview(task.taskId, { reviewerAgent: 'reviewer-9', mode: 'adversarial' })
  await reviews.submitReview(adversarial.review.reviewId, {
    capability: adversarial.reviewerCapability,
    verdict: 'APPROVED', findings: [],
    criteriaVerdicts: [{ met: true }, { met: true }],
    summary: 'Пытался сломать переименование и конкурентный вызов — не удалось.',
  })

  // --- 5. Сигналы гасятся только объяснением ------------------------------
  verdict = await quality.readiness(task.taskId)
  const unacknowledged = verdict.blockers.filter(blocker => blocker.id.startsWith('SIGNAL_UNACKNOWLEDGED'))
  assert.ok(unacknowledged.length >= 2, `сигналы не должны гаснуть молча: ${JSON.stringify(verdict.blockers)}`)
  await tasks.acknowledgeSignal(task.taskId, { signal: 'DEPENDENCY_CHANGE', explanation: 'brand-new-dep нужен для парсинга протокола; версия закреплена точно.' })
  await tasks.acknowledgeSignal(task.taskId, { signal: 'UNEXPECTED_CHANGE', explanation: 'package.json пришлось изменить ради новой зависимости — это и есть её манифест.' })
  await tasks.acknowledgeSignal(task.taskId, { signal: 'TEST_WEAKENING', explanation: 'Ассерты не потеряны: тест переписан, старый logout-ассерт сохранён, счётчик реагирует на перестановку строк.' })
  await tasks.acknowledgeSignal(task.taskId, { signal: 'BACKWARD_COMPATIBILITY', explanation: 'login() сохранён как алиас, удаления публичного API нет — сигнал от переписанной строки.' })

  verdict = await quality.readiness(task.taskId)
  assert.deepEqual(verdict.blockers, [], `после починки, ревью и объяснений задача готова: ${JSON.stringify(verdict.blockers)}`)
  const promoted = await quality.promoteIfReady(task.taskId)
  assert.equal(promoted.status, 'READY_FOR_HUMAN_REVIEW')
}

// --- 7. APPROVED протухает вместе с headSha -------------------------------
{
  await writeFile(join(workspace.path, 'src', 'auth.js'), 'export function login() {\n  return "changed again"\n}\n')
  await commitAll(workspace.path, 'post-approval change', identity)
  await reviews.analyzeTask(task.taskId)
  await reviews.refreshTaskReviewSummary(task.taskId)
  const stale = (await tasks.getTask(task.taskId)).review
  assert.equal(stale.verdict, 'STALE', 'новый коммит обесценивает старое одобрение')
  const verdict = await quality.readiness(task.taskId)
  assert.ok(verdict.blockers.some(blocker => blocker.id === 'REVIEW_MISSING' || blocker.id === 'STALE_EVIDENCE'))
}

// --- 6б. Finding закрывает только reviewer --------------------------------
{
  // Закрытие finding — тоже только по capability: writer с любым именем и
  // даже знание имени ревьюера не помогают.
  const firstReviewId = (await tasks.getTask(task.taskId)).reviews[0]
  await assert.rejects(
    reviews.resolveFinding(firstReviewId, { index: 0, capability: 'writer-guess', resolution: 'починил' }),
    error => error.code === 'WRITER_REVIEWER_CONFLICT',
  )
  const resolved = await reviews.resolveFinding(firstReviewId, { index: 0, capability: firstReviewCapability, resolution: 'проверил фикс: вызовы восстановлены' })
  assert.equal(resolved.findings[0].status, 'RESOLVED')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime review and diff analysis tests passed.')
