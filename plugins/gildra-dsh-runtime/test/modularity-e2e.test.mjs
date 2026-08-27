// Modularity E2E (§41 плана модульности) — ОРКЕСТРАЦИОННЫЙ сценарий.
//
// Честная пометка: writer здесь симулирован (правки пишет тест), поэтому этот
// файл доказывает работу КОНВЕЙЕРА (plan → gates → блокировка → починка →
// READY), а не качество реальной модели. Реальные writer/reviewer-агенты
// оцениваются отдельным инструментом scripts/ai-quality-eval.mjs — его
// результаты не подменяются этим тестом.
//
// Fixture: слои domain/application/infrastructure/ui. «Плохой» writer делает
// сразу пять грехов: (1) валит новую логику в God-file, (2) импортирует
// infrastructure из domain, (3) копирует validation-правило, (4) заводит
// глобальный mutable singleton, (5) ослабляет тест через .skip. Конвейер
// обязан поймать ВСЁ; «хороший» writer чинит — задача доходит до READY.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRuntime } from '../lib/api.js'
import { commitAll, git } from '../lib/gitx.js'

const identity = { name: 'Writer', email: 'writer@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra modularity e2e '))
const repo = join(base, 'repo')
await git(['init', '-b', 'main', repo])
await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
for (const dir of ['src/domain', 'src/application', 'src/infrastructure', 'src/ui', 'test']) {
  await mkdir(join(repo, dir), { recursive: true })
}
// God-file-кандидат: уже большой файл с несвязанными обязанностями.
await writeFile(join(repo, 'src', 'application', 'everything.js'), [
  '// Исторически перегруженный файл приложения',
  ...Array.from({ length: 420 }, (_, index) => `export const legacy${String(index)} = () => ${String(index)}`),
  '',
].join('\n'))
await writeFile(join(repo, 'src', 'domain', 'validation.js'), [
  'export function validateEmail(raw) {',
  '  const value = String(raw).trim().toLowerCase()',
  '  if (!value.includes("@")) return { ok: false, reason: "no-at" }',
  '  if (value.length > 254) return { ok: false, reason: "too-long" }',
  '  const [name, host] = value.split("@")',
  '  if (!name || !host || !host.includes(".")) return { ok: false, reason: "malformed" }',
  '  return { ok: true, value }',
  '}',
  '',
].join('\n'))
await writeFile(join(repo, 'src', 'infrastructure', 'db.js'), 'export const persist = value => value\n')
await writeFile(join(repo, 'src', 'ui', 'form.js'), "import { validateEmail } from '../domain/validation.js'\nexport const submit = raw => validateEmail(raw)\n")
await writeFile(join(repo, 'test', 'validation.test.mjs'), [
  "import assert from 'node:assert/strict'",
  "import { validateEmail } from '../src/domain/validation.js'",
  "assert.equal(validateEmail('a@b.co').ok, true)",
  "assert.equal(validateEmail('broken').ok, false)",
  "console.log('fixture tests passed')",
  '',
].join('\n'))
await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node test/validation.test.mjs' } }, null, 2))
await commitAll(repo, 'init', identity)

const runtime = createRuntime({ env: { GILDRA_DSH_STATE_DIR: join(base, 'state') } })
const { projects, sessions, workspaces, tasks, quality, reviews } = runtime
await git(['-C', repo, 'switch', '--detach'])
await projects.register({ projectId: 'shop', path: repo })
await quality.setPolicy('shop', {
  required: ['tests', 'review'],
  checks: { tests: { argv: ['node', 'test/validation.test.mjs'] } },
  architecture: {
    layers: [
      { id: 'domain', patterns: ['src/domain/**'], mayDependOn: [] },
      { id: 'application', patterns: ['src/application/**'], mayDependOn: ['domain'] },
      { id: 'infrastructure', patterns: ['src/infrastructure/**'], mayDependOn: ['application', 'domain'] },
      { id: 'ui', patterns: ['src/ui/**'], mayDependOn: ['application', 'domain'] },
    ],
  },
})

const { task } = await tasks.createTask({
  projectId: 'shop', title: 'Validate signup phone', kind: 'feature', owner: 'alex',
  acceptanceCriteria: ['телефон проверяется', 'существующие тесты живы'],
  expectedAreas: ['src/domain/**', 'test/**'],
})
const session = await sessions.createSession({ projectId: 'shop', userId: 'alex' })
const workspace = await workspaces.getRecord(session.session.workspaceId)
await tasks.attachWorkspace(task.taskId, {
  workspaceId: workspace.workspaceId, sessionId: workspace.sessionId,
  branch: workspace.branch, baseSha: workspace.baseSha,
})
await tasks.updateTask(task.taskId, { writerAgent: 'writer-sim' })

// AI создаёт Module Change Plan (§41): без него write-фаза закрыта.
await assert.rejects(tasks.transition(task.taskId, 'IMPLEMENTING'), error => error.code === 'MODULE_PLAN_REQUIRED')
await tasks.setModulePlan(task.taskId, {
  modulesToChange: [
    { module: 'src/domain', reason: 'новое правило валидации телефона' },
    { module: 'test', reason: 'тесты нового правила' },
  ],
})
await tasks.transition(task.taskId, 'IMPLEMENTING')

// --- «Плохой» writer: пять грехов одним коммитом ---------------------------
await writeFile(join(workspace.path, 'src', 'application', 'everything.js'), [
  '// Исторически перегруженный файл приложения',
  ...Array.from({ length: 420 }, (_, index) => `export const legacy${String(index)} = () => ${String(index)}`),
  '// (1) новая несвязанная логика — прямо сюда, (4) глобальный кэш-синглтон',
  'export let phoneCache = {}',
  ...Array.from({ length: 210 }, (_, index) => `export const phoneHelper${String(index)} = () => ${String(index)}`),
  '// (3) скопированное validation-правило вместо переиспользования',
  'export function validatePhoneEmail(raw) {',
  '  const value = String(raw).trim().toLowerCase()',
  '  if (!value.includes("@")) return { ok: false, reason: "no-at" }',
  '  if (value.length > 254) return { ok: false, reason: "too-long" }',
  '  const [name, host] = value.split("@")',
  '  if (!name || !host || !host.includes(".")) return { ok: false, reason: "malformed" }',
  '  return { ok: true, value }',
  '}',
  '',
].join('\n'))
// (2) domain тянет infrastructure.
await writeFile(join(workspace.path, 'src', 'domain', 'phone.js'), [
  "import { persist } from '../infrastructure/db.js'",
  'export const validatePhone = raw => persist(String(raw).length >= 10)',
  '',
].join('\n'))
// (5) мешающий тест выключается.
await writeFile(join(workspace.path, 'test', 'validation.test.mjs'), [
  "import assert from 'node:assert/strict'",
  "import { validateEmail } from '../src/domain/validation.js'",
  "const it = { skip: () => {} }",
  "it.skip('email ok', () => assert.equal(validateEmail('a@b.co').ok, true))",
  "console.log('fixture tests passed')",
  '',
].join('\n'))
await commitAll(workspace.path, 'feat: phone validation (spaghetti edition)', identity)
await reviews.analyzeTask(task.taskId)

{
  const record = await tasks.getTask(task.taskId)
  const kinds = record.analysis.signals.map(signal => signal.kind)
  // Все пять грехов пойманы конвейером без LLM:
  assert.ok(kinds.includes('CROSS_LAYER_IMPORT'), `(2) infra-in-domain: ${kinds.join(',')}`)
  assert.ok(kinds.includes('OVERSIZED_MODULE_GROWTH'), '(1) God-file вырос несвязанной логикой')
  assert.ok(kinds.includes('DUPLICATED_DOMAIN_LOGIC'), '(3) правило скопировано')
  assert.ok(kinds.includes('NEW_GLOBAL_MUTABLE_STATE'), '(4) глобальный singleton')
  assert.ok(kinds.includes('TEST_WEAKENING'), '(5) тест ослаблен')
  assert.ok(kinds.includes('UNEXPECTED_MODULE_CHANGE'), 'God-file лежит вне плана — план нарушен')

  const verdict = await quality.readiness(task.taskId)
  const ids = verdict.blockers.map(blocker => blocker.id)
  assert.ok(ids.includes('ARCH:architecture-boundaries'), 'BLOCK-gate: cross-layer не гасится объяснением')
  assert.ok(ids.some(id => id.startsWith('SIGNAL_UNACKNOWLEDGED:')), 'REVIEW-сигналы требуют объяснений')
  await assert.rejects(quality.promoteIfReady(task.taskId), error => error.code === 'READINESS_REQUIRED')
}

// Reviewer блокирует (§41): независимый вердикт по фактам анализа.
const badReview = await reviews.requestReview(task.taskId, { reviewerAgent: 'reviewer-sim' })
await reviews.submitReview(badReview.review.reviewId, {
  capability: badReview.reviewerCapability,
  verdict: 'CHANGES_REQUESTED',
  findings: [{
    severity: 'HIGH', category: 'ARCHITECTURE', file: 'src/domain/phone.js', line: 1,
    message: 'Domain импортирует infrastructure; логика телефона размазана по God-file с копией email-правила.',
  }],
  criteriaVerdicts: [{ met: false, note: 'валидация есть, но архитектура сломана' }, { met: false, note: 'тест выключен' }],
})
assert.equal((await tasks.getTask(task.taskId)).status, 'FIXING_REVIEW')

// --- «Хороший» writer: чинит по правилам рефакторинга ----------------------
await writeFile(join(workspace.path, 'src', 'application', 'everything.js'), [
  '// Исторически перегруженный файл приложения',
  ...Array.from({ length: 420 }, (_, index) => `export const legacy${String(index)} = () => ${String(index)}`),
  '',
].join('\n'))
await writeFile(join(workspace.path, 'src', 'domain', 'phone.js'), [
  '// Чистое доменное правило: без побочных эффектов и infrastructure.',
  'export function validatePhone(raw) {',
  '  const digits = String(raw).replace(/\\D/g, "")',
  '  if (digits.length < 10 || digits.length > 15) return { ok: false, reason: "length" }',
  '  return { ok: true, value: digits }',
  '}',
  '',
].join('\n'))
await writeFile(join(workspace.path, 'test', 'validation.test.mjs'), [
  "import assert from 'node:assert/strict'",
  "import { validateEmail } from '../src/domain/validation.js'",
  "import { validatePhone } from '../src/domain/phone.js'",
  "assert.equal(validateEmail('a@b.co').ok, true)",
  "assert.equal(validateEmail('broken').ok, false)",
  "assert.equal(validatePhone('+7 999 123-45-67').ok, true)",
  "assert.equal(validatePhone('123').ok, false)",
  "console.log('fixture tests passed')",
  '',
].join('\n'))
await commitAll(workspace.path, 'fix: pure domain rule, tests restored', identity)
await reviews.analyzeTask(task.taskId)

{
  const record = await tasks.getTask(task.taskId)
  const kinds = record.analysis.signals.map(signal => signal.kind)
  assert.ok(!kinds.includes('CROSS_LAYER_IMPORT'), 'cycle/слои чисты')
  assert.ok(!kinds.includes('DUPLICATED_DOMAIN_LOGIC'), 'правило не дублируется')
  assert.ok(!kinds.includes('TEST_WEAKENING'), 'тест не ослаблен')
  assert.ok(!kinds.includes('NEW_GLOBAL_MUTABLE_STATE'))
}

const run = await quality.runVerification(task.taskId)
assert.equal(run.checks.find(check => check.id === 'tests').status, 'PASSED')
const goodReview = await reviews.requestReview(task.taskId, { reviewerAgent: 'reviewer-sim' })
await reviews.submitReview(goodReview.review.reviewId, {
  capability: goodReview.reviewerCapability,
  verdict: 'APPROVED', findings: [],
  criteriaVerdicts: [{ met: true }, { met: true }],
})
const verdict = await quality.readiness(task.taskId)
assert.deepEqual(verdict.blockers, [], `после починки задача готова: ${JSON.stringify(verdict.blockers)}`)
assert.equal((await quality.promoteIfReady(task.taskId)).status, 'READY_FOR_HUMAN_REVIEW')

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime modularity E2E (orchestration) passed.')
