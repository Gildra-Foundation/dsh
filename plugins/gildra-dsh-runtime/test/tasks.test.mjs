// Инженерная модель Task и Work Claims (§8, §10, §13, §26–§30, §39, §44, §70).
//
// Доказываемые инварианты:
//   1. READY_FOR_HUMAN_REVIEW НЕВОЗМОЖНО назначить транзишеном — только gate;
//   2. MERGED достижим только из READY_FOR_HUMAN_REVIEW;
//   3. FAILED всегда несёт failureKind (§70);
//   4. dirty workspace не присваивается задаче молча (§39);
//   5. claims: CLAIMED-пересечение — предупреждение, EXCLUSIVE — блок (§26–27);
//   6. семантическая связность по import-графу без LLM (§28);
//   7. сигналы гасятся только содержательным объяснением;
//   8. CI-падения ограничены: после лимита задача BLOCKED, а не вечный цикл;
//   9. миграция v1→v2 переводит старые статусы, а READY честно возвращает
//      в REVIEWING (старый READY не имел evidence).

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, git } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createTaskManager, ACKNOWLEDGEABLE_SIGNALS, TASK_STATUSES } from '../lib/tasks.js'
import { extractImports, normalizeClaims, relatedByImports, resolveImport } from '../lib/claims.js'

const base = await mkdtemp(join(tmpdir(), 'gildra tasks '))
const repo = join(base, 'repo')
await git(['init', '-b', 'main', repo])
await writeFile(join(repo, 'README.md'), '# demo\n')
await commitAll(repo, 'init', { name: 'Seed', email: 'seed@test' })

const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
await projects.register({ projectId: 'demo', path: repo })
const tasks = createTaskManager({ store, roots, projects })

// --- 1–3. Guard'ы жизненного цикла ---------------------------------------
{
  const { task } = await tasks.createTask({ projectId: 'demo', title: 'Fix updater lock race', kind: 'bugfix', owner: 'alex' })
  assert.equal(task.status, 'PLANNED')
  assert.ok(TASK_STATUSES.includes('READY_FOR_HUMAN_REVIEW'))

  await assert.rejects(
    tasks.transition(task.taskId, 'READY_FOR_HUMAN_REVIEW'),
    error => error.code === 'READINESS_REQUIRED',
    'готовность нельзя объявить словами — только вычислить gate’ом',
  )
  await assert.rejects(
    tasks.transition(task.taskId, 'MERGED'),
    error => error.code === 'READINESS_REQUIRED',
    'MERGED без пройденного gate недостижим',
  )
  await assert.rejects(
    tasks.transition(task.taskId, 'FAILED'),
    error => error.code === 'INVALID_INPUT',
    'FAILED без failureKind — слепой статус, он запрещён',
  )
  const failed = await tasks.transition(task.taskId, 'FAILED', { failureKind: 'VERIFICATION' })
  assert.equal(failed.failureKind, 'VERIFICATION')
  // Возврат в работу очищает причину прошлой остановки.
  const resumed = await tasks.transition(task.taskId, 'IMPLEMENTING')
  assert.equal(resumed.failureKind, undefined)
}

// --- 3б. Module Change Plan обязателен перед реализацией (§6) --------------
{
  const { task } = await tasks.createTask({ projectId: 'demo', title: 'Plan gate', owner: 'alex' })
  await tasks.attachWorkspace(task.taskId, {
    workspaceId: 'ws-plan', sessionId: 'sess-plan', branch: 'session/alex/plan', baseSha: 'b'.repeat(40),
  })
  await assert.rejects(
    tasks.transition(task.taskId, 'IMPLEMENTING'),
    error => error.code === 'MODULE_PLAN_REQUIRED',
    'write-фаза без плана модулей запрещена',
  )
  await assert.rejects(tasks.setModulePlan(task.taskId, { modulesToChange: [] }), /хотя бы один/)
  await assert.rejects(
    tasks.setModulePlan(task.taskId, { modulesToChange: [{ module: 'x', reason: 'ok' }] }),
    /почему меняется/,
  )
  await assert.rejects(
    tasks.setModulePlan(task.taskId, { newModules: [{ id: 'dump' }] }),
    /ответственность/,
    'новый модуль без ответственности — будущая свалка',
  )
  await tasks.setModulePlan(task.taskId, {
    modulesToChange: [{ module: 'runtime.sessions', reason: 'добавить review lifecycle' }],
    newModules: [{ id: 'runtime.review', responsibility: 'независимое структурное ревью задач' }],
    testsRequired: ['session lifecycle'],
    risks: ['stale evidence'],
  })
  const planned = await tasks.transition(task.taskId, 'IMPLEMENTING')
  assert.equal(planned.status, 'IMPLEMENTING')
  assert.equal(planned.modulePlan.modulesToChange[0].module, 'runtime.sessions')

  // Задача без workspace (чистое планирование) план не требует.
  const { task: paper } = await tasks.createTask({ projectId: 'demo', title: 'Paper task', owner: 'alex' })
  await tasks.transition(paper.taskId, 'IMPLEMENTING')
}

// --- 4. Dirty precondition (§39) ------------------------------------------
{
  const { task } = await tasks.createTask({ projectId: 'demo', title: 'Dirty check', owner: 'alex' })
  await assert.rejects(
    tasks.attachWorkspace(task.taskId, {
      workspaceId: 'ws-1', sessionId: 'sess-x1', branch: 'session/alex/x1', baseSha: 'a'.repeat(40),
      dirtyFiles: ['leftover.js'],
    }),
    error => error.code === 'WORKSPACE_DIRTY',
    'чужой dirty diff не присваивается задаче молча',
  )
  const attached = await tasks.attachWorkspace(task.taskId, {
    workspaceId: 'ws-1', sessionId: 'sess-x1', branch: 'session/alex/x1', baseSha: 'a'.repeat(40),
    dirtyFiles: ['leftover.js'], acceptDirty: true,
  })
  assert.deepEqual(attached.preexistingDirty, ['leftover.js'], 'существующие изменения фиксируются явно')
}

// --- 5. Claims: предупреждение vs блок ------------------------------------
{
  const alex = await tasks.createTask({
    projectId: 'demo', title: 'Auth service', owner: 'alex',
    claims: ['src/auth/**'],
  })
  assert.deepEqual(alex.overlaps, [], 'первая задача ничего не пересекает')

  // CLAIMED-пересечение: создаётся, но с предупреждением.
  const peter = await tasks.createTask({
    projectId: 'demo', title: 'Token handling', owner: 'peter',
    claims: [{ area: 'src/auth/token.js', mode: 'CLAIMED' }],
  })
  assert.equal(peter.overlaps.length, 1)
  assert.equal(peter.overlaps[0].owner, 'alex')
  assert.equal(peter.overlaps[0].area, 'src/auth/**')

  // EXCLUSIVE чужой claim блокирует без подтверждения.
  await tasks.setClaims(alex.task.taskId, [{ area: 'src/auth/**', mode: 'EXCLUSIVE' }], { confirmExclusiveOverlap: true })
  await assert.rejects(
    tasks.createTask({ projectId: 'demo', title: 'Third', owner: 'kim', claims: ['src/auth/session.js'] }),
    error => error.code === 'CLAIM_CONFLICT' && error.details.overlaps[0].taskId === alex.task.taskId,
  )
  // …но с явным подтверждением — создаётся.
  const confirmed = await tasks.createTask({
    projectId: 'demo', title: 'Third confirmed', owner: 'kim',
    claims: ['src/auth/session.js'], confirmExclusiveOverlap: true,
  })
  assert.equal(confirmed.overlaps.length >= 1, true)

  // SHARED не считается пересечением ни с одной стороны.
  const shared = await tasks.createTask({
    projectId: 'demo', title: 'Docs pass', owner: 'dana',
    claims: [{ area: 'src/auth/**', mode: 'SHARED' }],
  })
  assert.deepEqual(shared.overlaps.filter(overlap => overlap.owner === 'dana'), [])

  // Пересечение по ФАКТИЧЕСКИМ файлам (для diff-этапа).
  const byFiles = await tasks.overlapsFor('demo', { files: ['src/auth/oauth.js'] })
  assert.ok(byFiles.some(overlap => overlap.kind === 'FILES' && overlap.owner === 'alex'))

  // Обзор команды видит пересечения и владельцев (§29, §47).
  const overview = await tasks.teamOverview('demo')
  assert.ok(overview.byOwner.alex?.length >= 1)
  assert.ok(overview.overlaps.length >= 1, 'team view обязан показывать пересечения')

  // Валидация claims.
  assert.throws(() => normalizeClaims([{ area: '', mode: 'CLAIMED' }]), /непустой glob/)
  assert.throws(() => normalizeClaims([{ area: 'x', mode: 'LOCKED' }]), /Недопустимый режим/)
}

// --- 6. Семантическая связность по импортам (§28, без LLM) ----------------
{
  const source = [
    "import { login } from '../auth/service.js'",
    "const helper = require('./helper.js')",
    "import config from 'external-package'",
    "export { token } from '../auth/token.js'",
  ].join('\n')
  const imports = extractImports(source)
  assert.deepEqual(imports.sort(), ['../auth/service.js', '../auth/token.js', './helper.js'],
    'пакетные импорты не считаются связью областей')
  assert.equal(resolveImport('src/login/controller.js', '../auth/service.js'), 'src/auth/service.js')

  const related = relatedByImports({
    filesA: ['src/login/controller.js'],
    importsOfA: new Map([['src/login/controller.js', ['../auth/service.js']]]),
    filesB: ['src/auth/service.js'],
  })
  assert.equal(related, true, 'изменённый файл импортирует файл соседней задачи → связаны')

  const unrelated = relatedByImports({
    filesA: ['src/login/controller.js'],
    importsOfA: new Map([['src/login/controller.js', ['./helper.js']]]),
    filesB: ['docs/readme.md'],
  })
  assert.equal(unrelated, false)
}

// --- 7. Acknowledgments: сигнал гасится только объяснением ----------------
{
  const { task } = await tasks.createTask({ projectId: 'demo', title: 'Ack check', owner: 'alex' })
  await assert.rejects(
    tasks.acknowledgeSignal(task.taskId, { signal: 'TEST_WEAKENING', explanation: 'ok' }),
    /содержательным/,
    'отписка из двух букв — не объяснение',
  )
  await assert.rejects(
    tasks.acknowledgeSignal(task.taskId, { signal: 'MADE_UP', explanation: 'достаточно длинное объяснение' }),
    /Неизвестный сигнал/,
  )
  const acked = await tasks.acknowledgeSignal(task.taskId, {
    signal: 'TEST_WEAKENING',
    explanation: 'Тест удалён, потому что проверяемое поведение вынесено в отдельный набор merge.test.',
  })
  assert.equal(acked.acknowledgments.length, 1)
  assert.ok(ACKNOWLEDGEABLE_SIGNALS.includes('PROTECTED_AREA_CHANGE'))
}

// --- 8. CI-петля ограничена (§44) -----------------------------------------
{
  const { task } = await tasks.createTask({ projectId: 'demo', title: 'CI loop', owner: 'alex' })
  await tasks.recordDelivery(task.taskId, { mode: 'PR', prUrl: 'https://github.com/acme/x/pull/7', prNumber: 7 })
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const after = await tasks.recordDelivery(task.taskId, { ciStatus: 'FAILED' })
    assert.equal(after.failureKind, 'CI')
    assert.equal(after.status === 'BLOCKED', false, `попытка ${String(attempt)} ещё в лимите`)
  }
  const exhausted = await tasks.recordDelivery(task.taskId, { ciStatus: 'FAILED' })
  assert.equal(exhausted.status, 'BLOCKED', 'после лимита CI-починок задача останавливается и ждёт человека')
  assert.match(exhausted.blockReason, /CI/)

  await assert.rejects(tasks.recordDelivery(task.taskId, { prUrl: 'http://insecure.example/pr/1' }), /https/)
  await assert.rejects(tasks.recordDelivery(task.taskId, { ciStatus: 'GREENISH' }), /ciStatus/)
}

// --- 9. Миграция v1 → v2 --------------------------------------------------
{
  // Пишем сырые v1-записи напрямую (как их оставил бы старый Runtime).
  const legacy = [
    { id: 'task-legacy-1', status: 'IN_PROGRESS', expected: 'IMPLEMENTING' },
    { id: 'task-legacy-2', status: 'TESTING', expected: 'VERIFYING' },
    { id: 'task-legacy-3', status: 'READY', expected: 'REVIEWING' },
    { id: 'task-legacy-4', status: 'FAILED', expected: 'FAILED' },
  ]
  for (const entry of legacy) {
    await store.write('tasks', entry.id, {
      schemaVersion: 1, taskId: entry.id, projectId: 'demo', title: 'legacy',
      baseBranch: 'main', status: entry.status, sessions: [], agents: [], workspaces: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
  }
  for (const entry of legacy) {
    const migrated = await tasks.getTask(entry.id)
    assert.equal(migrated.status, entry.expected, `${entry.status} → ${entry.expected}`)
    assert.deepEqual(migrated.acknowledgments, [], 'новые поля инициализированы')
  }
  const readyMigrated = await tasks.getTask('task-legacy-3')
  assert.match(readyMigrated.blockReason ?? '', /gate/, 'старый READY требует нового прохождения gate')
  const failedMigrated = await tasks.getTask('task-legacy-4')
  assert.equal(failedMigrated.failureKind, 'IMPLEMENTATION', 'FAILED получает дефолтный failureKind')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime task model tests passed.')
