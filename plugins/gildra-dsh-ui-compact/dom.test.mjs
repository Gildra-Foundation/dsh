// Поведенческие DOM-тесты оверлея на happy-dom (нужен dev-профиль:
// `npm install`, затем `npm run test:dom`; verify.sh запускает их только при
// наличии node_modules).
//
// Важное ограничение среды: MutationObserver в happy-dom доставляет только
// ПЕРВУЮ пачку мутаций и замолкает (проверено изолированно), поэтому
// конвейер здесь запускается детерминированно — напрямую через callback,
// который apply() регистрирует в ctx.locale.subscribe. Отсутствие вечной
// петли доказывается эквивалентным инвариантом: повторный проход по
// неизменному состоянию не делает НИ ОДНОЙ записи в DOM (снапшот разметки
// байт-в-байт совпадает, текстовые узлы не пересоздаются) — именно записи
// «того же значения» и питали петлю observer → rAF → рендер.
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const windowInstance = new Window({ url: 'http://127.0.0.1:3080/' })
const { document } = windowInstance

let definition
windowInstance.__ModuleLoader__ = {
  load(value) {
    definition = value
  },
}

globalThis.window = windowInstance
globalThis.document = document
globalThis.NodeFilter = windowInstance.NodeFilter
globalThis.MutationObserver = windowInstance.MutationObserver
globalThis.HTMLElement = windowInstance.HTMLElement
globalThis.HTMLInputElement = windowInstance.HTMLInputElement
globalThis.HTMLTextAreaElement = windowInstance.HTMLTextAreaElement
globalThis.HTMLButtonElement = windowInstance.HTMLButtonElement
globalThis.SVGElement = windowInstance.SVGElement
globalThis.Element = windowInstance.Element
globalThis.Event = windowInstance.Event
globalThis.CustomEvent = windowInstance.CustomEvent
globalThis.localStorage = windowInstance.localStorage
globalThis.sessionStorage = windowInstance.sessionStorage
Object.defineProperty(globalThis, 'navigator', {
  value: windowInstance.navigator,
  configurable: true,
})
// Сеть в тесте: маршруты Gildra Runtime отвечают фикстурами (панель
// Workspaces должна отрисоваться), всё остальное — отказом.
const RUNTIME_FIXTURES = {
  '/gildra/v1/health': { ok: true, health: { runtime: 'READY', ready: true, apiVersion: 1, runtimeVersion: 3 } },
  '/gildra/v1/merges/list?activeOnly=1': {
    ok: true,
    merges: [{
      mergeId: 'merge-dom1',
      status: 'CONFLICT',
      sourceBranch: 'session/alex/sess-dom1',
      targetBranch: 'main',
      path: '/tmp/merge-dom1',
      conflicts: ['src/a.ts', 'README.md'],
    }],
  },
  '/gildra/v1/projects': { ok: true, projects: [{ projectId: 'demo', defaultBranch: 'main' }] },
  '/gildra/v1/sessions?activeOnly=1': {
    ok: true,
    sessions: [{
      sessionId: 'sess-dom1',
      userId: 'alex',
      projectId: 'demo',
      status: 'ACTIVE',
      mode: 'write',
      branch: 'session/alex/sess-dom1',
      workspaceId: 'demo--alex--sess-dom1',
    }],
  },
  '/gildra/v1/workspaces': {
    ok: true,
    workspaces: [{ workspaceId: 'demo--alex--sess-dom1', dirtyFiles: 0, ahead: 1, lease: { state: 'ACTIVE' } }],
  },
  '/gildra/v1/team': {
    ok: true,
    provider: 'github',
    team: {
      activeTasks: 2,
      byOwner: {
        alex: [{ taskId: 'task-dom-a', title: 'Auth service', status: 'REVIEWING' }],
        peter: [{ taskId: 'task-dom-b', title: 'Token handling', status: 'READY_FOR_HUMAN_REVIEW' }],
        kim: [{ taskId: 'task-dom-c', title: 'Remote work', status: 'IMPLEMENTING', remote: true, affectedModules: ['auth.service'] }],
      },
      agents: [{ agent: 'writer-17', role: 'writer', taskId: 'task-dom-a' }],
      overlaps: [{
        tasks: [{ taskId: 'task-dom-a', owner: 'alex' }, { taskId: 'task-dom-b', owner: 'peter' }],
        areas: ['src/auth/**'],
      }],
      waitingReview: ['task-dom-a'],
      ciFailures: [],
    },
  },
  '/gildra/v1/tasks/quality?taskId=task-dom-a': {
    ok: true,
    quality: {
      taskId: 'task-dom-a',
      ready: false,
      blockers: [
        { id: 'CHECK_FAILED:tests', message: 'Проверка «tests» в статусе FAILED.' },
        { id: 'REVIEW_MISSING', message: 'Независимое ревью не выполнялось.' },
      ],
      facts: [
        { kind: 'architecture', id: 'dependency-cycles', status: 'FAILED' },
        { kind: 'architecture', id: 'architecture-boundaries', status: 'PASSED' },
      ],
    },
  },
  '/gildra/v1/tasks/quality?taskId=task-dom-b': {
    ok: true,
    quality: { taskId: 'task-dom-b', ready: true, blockers: [] },
  },
}
globalThis.fetch = async (url) => {
  const fixture = RUNTIME_FIXTURES[String(url)]
  if (fixture) {
    return { ok: true, status: 200, json: async () => fixture }
  }
  return { ok: false, status: 503, json: async () => ({ ok: false }) }
}

await import('./lib/client.js')
assert.equal(typeof definition?.factory, 'function')
const clientModule = definition.factory()

// Разметка-фикстура: бренд-слот, слот workspaces и системный монитор.
document.body.innerHTML = [
  '<div data-slot="sidebar.brand.name">Gildra</div>',
  '<div data-slot="sidebar.workspaces"><div><p>workspace list</p></div></div>',
  '<div class="sysmon"><span class="sysmon-label">MEM</span>',
  '<div class="sysmon__head"><button class="sysmon__toggle">+</button></div></div>',
].join('')

let currentLocale = 'ru'
let runPass = null
const disposers = []
const ctx = {
  locale: {
    getLocale: () => currentLocale,
    register: () => () => {},
    subscribe(callback) {
      // apply() подписывает полный проход конвейера на смену локали —
      // используем этот callback как детерминированный запуск прохода.
      runPass = callback
      return () => {}
    },
  },
  sessions: { list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: [], sessions: {} }) } },
  remote: { $on: () => () => {} },
  connection: {},
  modelDirectories: {},
  workspaces: {},
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') disposers.push(dispose)
  },
}

clientModule.apply(ctx)
assert.equal(typeof runPass, 'function', 'apply должен подписаться на смену локали')

// Дать отработать асинхронному первичному refreshEnvironmentState (fetch-стаб).
const tick = () => new Promise(resolveTick => setTimeout(resolveTick, 10))
await tick()
await tick()
runPass()

// 1. Бейдж среды и заголовок отрисованы для локального режима.
const badge = document.querySelector('.gildra-brand-environment')
assert.ok(badge, 'бейдж среды должен появиться в бренд-слоте')
assert.equal(badge.textContent, 'Локально')
assert.equal(document.title, 'Gildra DSH — Локально')

// 2. Свёрнутый сайдбар (happy-dom отдаёт нулевые размеры → collapsed):
// переключатель сред скрыт, индикатор без активного сервера тоже скрыт.
const environments = document.querySelector('.gildra-environments')
assert.ok(environments, 'контейнер сред должен быть создан')
assert.equal(environments.hidden, true)
const indicator = document.querySelector('.gildra-collapsed-environment')
assert.ok(indicator, 'индикатор свёрнутой панели должен существовать')
assert.equal(indicator.hidden, true)

// 3. Русская локаль: переводы системного монитора применяются, toggle
// получает aria-label, контейнер — маркер свёрнутости.
assert.equal(document.querySelector('.sysmon-label').textContent, 'ОЗУ')
assert.equal(
  document.querySelector('.sysmon__toggle').getAttribute('aria-label'),
  'Открыть системный монитор',
)
assert.equal(document.querySelector('.sysmon').dataset.gildraCollapsed, 'true')

// 3а. Панель Workspaces (Gildra Runtime): идентификация Project/Session/
// Branch/Mode и строка сессии с действиями отрисованы из fixture-данных.
{
  const identity = document.querySelector('.gildra-workspace-identity')
  assert.ok(identity, 'идентификация workspace должна отображаться')
  assert.match(identity.textContent, /Проект: demo/)
  assert.match(identity.textContent, /session\/alex\/sess-dom1/)
  assert.match(identity.textContent, /WRITE/)
  const row = document.querySelector('.gildra-workspace-row')
  assert.ok(row, 'строка сессии должна отображаться')
  assert.match(row.textContent, /alex/)
  const buttons = [...row.querySelectorAll('button')].map(button => button.textContent)
  assert.ok(buttons.includes('Merge'), 'чистая ahead-сессия предлагает Merge')
  const cleanupButton = [...row.querySelectorAll('button')].find(button => button.textContent === 'Завершить')
  assert.equal(cleanupButton.disabled, true, 'без owner-token завершение чужой сессии выключено')

  // Конфликт merge показывается явно, с файлами и действиями (§45): UI не
  // пытается разрешить его сам.
  const conflictRow = [...document.querySelectorAll('.gildra-workspace-row')]
    .find(candidate => candidate.dataset.state === 'conflict')
  assert.ok(conflictRow, 'конфликтный merge должен отображаться отдельной строкой')
  assert.match(conflictRow.textContent, /Конфликт: session\/alex\/sess-dom1 → main/)
  assert.match(conflictRow.textContent, /2 файл/)
  const conflictActions = [...conflictRow.querySelectorAll('button')].map(button => button.textContent)
  assert.deepEqual(conflictActions, ['Завершить merge', 'Отменить'])

  // Team View (§47–§49): факты Definition of Done, а не «quality score».
  const rows = [...document.querySelectorAll('.gildra-workspace-row')]
  const taskRow = rows.find(candidate => /Auth service/.test(candidate.textContent))
  assert.ok(taskRow, 'задача команды должна отображаться')
  assert.match(taskRow.textContent, /alex · Auth service/)
  assert.match(taskRow.textContent, /⚠ CHECK_FAILED, REVIEW_MISSING/,
    'непройденные ворота показываются фактами')
  const readyRow = rows.find(candidate => /Token handling/.test(candidate.textContent))
  assert.match(readyRow.textContent, /✓ готова к human review/)
  assert.doesNotMatch(document.body.textContent, /quality score/i)

  // §35: архитектурные факты видны в строке задачи.
  assert.match(taskRow.textContent, /✗ архитектура/, 'проваленный архитектурный gate виден сразу')
  // §34: задача другого Runtime помечена и показывает модули, не пути.
  const remoteRow = rows.find(candidate => /Remote work/.test(candidate.textContent))
  assert.ok(remoteRow, 'задача другого Runtime отображается')
  assert.match(remoteRow.textContent, /другой Runtime/)
  assert.match(remoteRow.textContent, /auth\.service/)
  assert.match(document.body.textContent, /Команда · github/, 'backend провайдера виден команде')

  const overlapRow = rows.find(candidate => candidate.dataset.state === 'overlap')
  assert.ok(overlapRow, 'пересечение claims должно быть видно команде')
  assert.match(overlapRow.textContent, /alex ↔ peter/)
  assert.match(overlapRow.textContent, /src\/auth\/\*\*/)
  assert.match(document.body.textContent, /ждут ревью: 1/)
}

// 4. Идемпотентность (доказательство отсутствия петли): три повторных
// прохода по неизменному состоянию не меняют ни байта разметки и не
// пересоздают текстовые узлы. Любая запись «того же значения» изменила бы
// идентичность узла и снапшот — именно такие записи питали вечную петлю.
const badgeTextNode = badge.firstChild
const sysmonTextNode = document.querySelector('.sysmon-label').firstChild
const snapshotBefore = document.body.innerHTML
const titleBefore = document.title
runPass()
runPass()
runPass()
assert.equal(document.body.innerHTML, snapshotBefore, 'повторный проход изменил разметку')
assert.equal(document.title, titleBefore)
assert.equal(badge.firstChild, badgeTextNode, 'текстовый узел бейджа пересоздан без изменения состояния')
assert.equal(
  document.querySelector('.sysmon-label').firstChild,
  sysmonTextNode,
  'текстовый узел монитора пересоздан без изменения состояния',
)

// 5. Явный выбор English отключает русские DOM-словари: новый EN-узел
// системного монитора остаётся непереведённым, пока выбор — English, и
// переводится после переключения на русский.
windowInstance.localStorage.setItem('gildra.language-choice.v1', 'done')
currentLocale = 'en'
const enLabel = document.createElement('span')
enLabel.textContent = 'DISK'
document.querySelector('.sysmon').appendChild(enLabel)
runPass()
assert.equal(enLabel.textContent, 'DISK', 'при явном English перевод не должен применяться')
currentLocale = 'ru'
runPass()
assert.equal(enLabel.textContent, 'ДИСК', 'после возврата на русский перевод должен примениться')

// 7. Таргетирование тяжёлого скана (§42): брендовый TreeWalker обходит
// переданный скоуп; полный проход (locale-канал) — весь body; mutationScope
// сводит несколько целей к их ближайшему общему предку.
{
  const scans = clientModule.__testables
  const sysmonRoot = document.querySelector('.sysmon')
  scans.applyBrandHeadline(sysmonRoot)
  assert.equal(scans.getLastBrandWalkRoot(), sysmonRoot, 'скоуп-проход обходит только поддерево')
  runPass()
  assert.equal(scans.getLastBrandWalkRoot(), document.body, 'полный проход обходит body')

  const label = document.querySelector('.sysmon-label')
  const toggle = document.querySelector('.sysmon__toggle')
  assert.equal(scans.mutationScope([{ target: label }]), label)
  assert.equal(scans.mutationScope([{ target: label }, { target: toggle }]), sysmonRoot,
    'скоуп двух целей — их ближайший общий предок')
  assert.equal(scans.mutationScope([{ target: label }, { target: document.body }]), document.body)
}

for (const dispose of disposers) dispose()
await windowInstance.happyDOM.abort()
windowInstance.close()

console.log('Gildra UI DOM behavior tests passed.')
