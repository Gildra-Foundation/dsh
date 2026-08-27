// Modularity Analyzer и архитектурные gates (§7–§8, §20 плана модульности).
//
// Доказываемые инварианты:
//   1. НОВЫЙ цикл блокирует (gate FAILED); существовавший в базе — нет;
//   2. НОВЫЙ cross-layer импорт блокирует; legacy-нарушение — preexisting;
//   3. рост файлов контекстен: большой файл + существенный рост несвязанного
//      кода — сигнал; новый большой файл-словарь — нет;
//   4. функция длиннее лимита — REVIEW-сигнал, не блок;
//   5. новый top-level let — NEW_GLOBAL_MUTABLE_STATE;
//   6. скопированный блок домена — DUPLICATED_DOMAIN_LOGIC;
//   7. новый файл с fs+network+process — MIXED_RESPONSIBILITIES;
//   8. модуль вне плана — UNEXPECTED_MODULE_CHANGE;
//   9. усечённый анализ — ANALYSIS_INCOMPLETE и gate FAILED (§20);
//  10. интеграция: реальный workspace с новым циклом не проходит readiness,
//      и никакое acknowledgment это не обходит.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { analyzeModularity, functionLengths } from '../lib/modularity.js'
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

function tree(files) {
  return { files: Object.keys(files), read: async path => files[path] }
}

const LAYERS = {
  layers: [
    { id: 'domain', patterns: ['src/domain/**'], mayDependOn: [] },
    { id: 'infrastructure', patterns: ['src/infrastructure/**'], mayDependOn: ['domain'] },
  ],
}

async function run({ before, after, changed, added = {}, architecture, modulePlan, truncated = false }) {
  const beforeTree = tree(before)
  const afterTree = tree(after)
  return analyzeModularity({
    filesBefore: beforeTree.files,
    readBefore: beforeTree.read,
    filesAfter: afterTree.files,
    readAfter: afterTree.read,
    changedFiles: changed,
    addedByFile: new Map(Object.entries(added)),
    architecture,
    modulePlan,
    analysisTruncated: truncated,
  })
}

const codesOf = result => result.signals.map(signal => signal.code)
const checkOf = (result, id) => result.checks.find(check => check.id === id)

// --- 1. Новый цикл блокирует; старый — нет ---------------------------------
{
  const before = {
    'src/a.js': "import { b } from './b.js'\nexport const a = () => b\n",
    'src/b.js': 'export const b = 1\n',
  }
  const withCycle = {
    'src/a.js': "import { b } from './b.js'\nexport const a = () => b\n",
    'src/b.js': "import { a } from './a.js'\nexport const b = () => a\n",
  }
  const fresh = await run({ before, after: withCycle, changed: ['src/b.js'] })
  assert.deepEqual(codesOf(fresh), ['NEW_DEPENDENCY_CYCLE'])
  assert.equal(checkOf(fresh, 'dependency-cycles').status, 'FAILED', 'новый цикл — BLOCK по умолчанию')

  // Цикл уже был в базе: задача его не создавала — не блокируем её.
  const legacy = await run({ before: withCycle, after: withCycle, changed: ['src/a.js'] })
  assert.ok(!codesOf(legacy).includes('NEW_DEPENDENCY_CYCLE'))
  assert.equal(checkOf(legacy, 'dependency-cycles').status, 'PASSED')
}

// --- 2. Cross-layer: новые блокируют, legacy — preexisting -----------------
{
  const before = {
    'src/domain/user.js': 'export const user = 1\n',
    'src/infrastructure/db.js': "import { user } from '../domain/user.js'\nexport const db = () => user\n",
  }
  const after = {
    ...before,
    'src/domain/report.js': "import { db } from '../infrastructure/db.js'\nexport const report = () => db()\n",
  }
  const result = await run({ before, after, changed: ['src/domain/report.js'], architecture: LAYERS })
  assert.ok(codesOf(result).includes('CROSS_LAYER_IMPORT'))
  assert.equal(checkOf(result, 'architecture-boundaries').status, 'FAILED')

  // Нарушение существовало до задачи → preexisting, gate не валится.
  const legacyBefore = { ...after }
  const legacyResult = await run({ before: legacyBefore, after: legacyBefore, changed: ['src/domain/user.js'], architecture: LAYERS })
  assert.ok(!codesOf(legacyResult).includes('CROSS_LAYER_IMPORT'))
  assert.equal(legacyResult.preexisting.length, 1, 'legacy-нарушение видно отдельным списком')
  assert.equal(checkOf(legacyResult, 'architecture-boundaries').status, 'PASSED')
}

// --- 3. Контекстный рост файла ---------------------------------------------
{
  const bigBefore = `export const map = {\n${'  x: 1,\n'.repeat(450)}}\n`
  const grown = `${bigBefore}${'export const extra = () => 1\n'.repeat(220)}`
  const before = { 'src/big.js': bigBefore }
  const growth = await run({ before, after: { 'src/big.js': grown }, changed: ['src/big.js'] })
  assert.ok(codesOf(growth).includes('OVERSIZED_MODULE_GROWTH'), 'рост уже большого файла — сигнал')

  // Новый большой файл-словарь: до него файла не было — сигнала нет.
  const dictionary = await run({
    before: {},
    after: { 'src/dict.js': `export const dict = {\n${'  ключ: "значение",\n'.repeat(600)}}\n` },
    changed: ['src/dict.js'],
  })
  assert.ok(!codesOf(dictionary).includes('OVERSIZED_MODULE_GROWTH'), 'большой словарь — не God-файл')
}

// --- 4. Длинная функция — REVIEW-сигнал ------------------------------------
{
  const longFunction = `export function huge() {\n${'  step()\n'.repeat(120)}}\n`
  assert.equal(functionLengths(longFunction)[0].lines > 80, true)
  const result = await run({
    before: { 'src/f.js': 'export function small() {\n  return 1\n}\n' },
    after: { 'src/f.js': longFunction },
    changed: ['src/f.js'],
  })
  assert.ok(codesOf(result).includes('OVERSIZED_FUNCTION_GROWTH'))
  assert.equal(checkOf(result, 'module-scope').status, 'WARNING', 'REVIEW-сигнал — предупреждение, не FAILED')
}

// --- 5–7. Global state, дубли, смешанные ответственности -------------------
{
  const sharedRule = [
    'export function validateEmail(raw) {',
    '  const value = String(raw).trim().toLowerCase()',
    '  if (!value.includes("@")) return { ok: false, reason: "no-at" }',
    '  if (value.length > 254) return { ok: false, reason: "too-long" }',
    '  const [name, host] = value.split("@")',
    '  if (!name || !host || !host.includes(".")) return { ok: false, reason: "malformed" }',
    '  return { ok: true, value }',
    '}',
  ].join('\n')
  const before = { 'src/domain/validation.js': `${sharedRule}\n` }
  const copiedLines = sharedRule.split('\n')
  const after = {
    ...before,
    'src/copy.js': `${sharedRule}\n`,
    'src/state.js': 'export let counter = 0\nlet cache = {}\nexport const bump = () => (counter += 1, cache)\n',
    'src/kitchen-sink.js': "import { readFileSync } from 'node:fs'\nimport { request } from 'node:https'\nimport { spawn } from 'node:child_process'\nexport const doAll = () => [readFileSync, request, spawn]\n",
  }
  const result = await run({
    before,
    after,
    changed: ['src/copy.js', 'src/state.js', 'src/kitchen-sink.js'],
    added: {
      'src/copy.js': copiedLines,
      'src/state.js': ['export let counter = 0', 'let cache = {}'],
    },
  })
  const codes = codesOf(result)
  assert.ok(codes.includes('DUPLICATED_DOMAIN_LOGIC'), `дубль правила должен быть найден: ${codes.join(',')}`)
  assert.equal(result.signals.find(signal => signal.code === 'DUPLICATED_DOMAIN_LOGIC').detail.duplicates[0].duplicatedFrom, 'src/domain/validation.js')
  assert.ok(codes.includes('NEW_GLOBAL_MUTABLE_STATE'))
  assert.ok(codes.includes('MIXED_RESPONSIBILITIES'))
}

// --- 8. План против факта ---------------------------------------------------
{
  const result = await run({
    before: { 'src/a.js': 'export const a = 1\n' },
    after: { 'src/a.js': 'export const a = 2\n', 'lib/sneaky.js': 'export const s = 1\n' },
    changed: ['src/a.js', 'lib/sneaky.js'],
    modulePlan: { modulesToChange: [{ module: 'src', reason: 'основная правка' }] },
  })
  const signal = result.signals.find(entry => entry.code === 'UNEXPECTED_MODULE_CHANGE')
  assert.ok(signal, 'модуль вне плана обязан быть замечен')
  assert.deepEqual(signal.detail.modules, ['lib'])
}

// --- 9. Усечённый анализ блокирует (§20) -----------------------------------
{
  const result = await run({ before: {}, after: {}, changed: [], truncated: true })
  assert.ok(codesOf(result).includes('ANALYSIS_INCOMPLETE'))
  assert.equal(checkOf(result, 'analysis-completeness').status, 'FAILED', 'обрезанный diff нельзя считать проверенным')
}

// --- 10. Интеграция: цикл в реальном workspace не проходит readiness -------
{
  const identity = { name: 'Alex', email: 'alex@test' }
  const base = await mkdtemp(join(tmpdir(), 'gildra modularity '))
  const repo = join(base, 'repo')
  await git(['init', '-b', 'main', repo])
  await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
  await mkdir(join(repo, 'src'), { recursive: true })
  await writeFile(join(repo, 'src', 'a.js'), "import { b } from './b.js'\nexport const a = () => b\n")
  await writeFile(join(repo, 'src', 'b.js'), 'export const b = 1\n')
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
const adminSetPolicy = (id, policy) => quality.setPolicy(id, policy, { verifiedAdmin: { actorId: 'test-admin' } })
  const repoIntel = createRepoIntel({ store, roots, projects })
  const reviews = createReviewManager({ store, roots, projects, tasks, workspaces, repoIntel })
  await adminSetPolicy('demo', { required: ['tests', 'review'], checks: { tests: { argv: ['node', '-e', 'process.exit(0)'] } } })

  const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-m1' })
  const { task } = await tasks.createTask({
    projectId: 'demo', title: 'Cycle temptation', owner: 'alex',
    acceptanceCriteria: ['b узнаёт про a'], expectedAreas: ['src/**'],
  })
  await tasks.attachWorkspace(task.taskId, {
    workspaceId: workspace.workspaceId, sessionId: 'sess-m1',
    branch: workspace.branch, baseSha: workspace.baseSha,
  })
  await tasks.setModulePlan(task.taskId, { modulesToChange: [{ module: 'src', reason: 'связать a и b' }] })

  // «Соблазн цикла»: простейшее решение — обратный импорт.
  await writeFile(join(workspace.path, 'src', 'b.js'), "import { a } from './a.js'\nexport const b = () => a\n")
  await commitAll(workspace.path, 'introduce cycle', identity)
  await reviews.analyzeTask(task.taskId)

  const verdict = await quality.readiness(task.taskId)
  const blocker = verdict.blockers.find(entry => entry.id === 'ARCH:dependency-cycles')
  assert.ok(blocker, `цикл обязан блокировать readiness: ${JSON.stringify(verdict.blockers)}`)
  assert.match(blocker.message, /объяснением это не закрывается/)

  // Починка (без цикла) снимает блокер.
  await writeFile(join(workspace.path, 'src', 'b.js'), 'export const b = () => 2\n')
  await commitAll(workspace.path, 'break cycle', identity)
  await reviews.analyzeTask(task.taskId)
  const fixed = await quality.readiness(task.taskId)
  assert.ok(!fixed.blockers.some(entry => entry.id === 'ARCH:dependency-cycles'))

  await rm(base, { recursive: true, force: true })
}

console.log('Gildra Runtime modularity analyzer tests passed.')
