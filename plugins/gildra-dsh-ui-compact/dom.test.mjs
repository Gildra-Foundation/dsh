// Поведенческие DOM-тесты оверлея на happy-dom (нужен dev-профиль:
// `npm install`, затем `npm run test:dom`; verify.sh запускает их только при
// наличии node_modules). Ключевая проверка — конвейер не создаёт вечную
// петлю observer → rAF → рендер в idle-состоянии.
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
// Сеть в тесте недоступна: /ssh-remotes и прочие маршруты отвечают отказом.
globalThis.fetch = async () => ({
  ok: false,
  status: 503,
  json: async () => ({ ok: false }),
})

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
const disposers = []
const ctx = {
  locale: {
    getLocale: () => currentLocale,
    register: () => () => {},
    subscribe: () => () => {},
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

const settle = async (frames = 4) => {
  for (let index = 0; index < frames; index++) {
    await new Promise(resolveFrame => windowInstance.requestAnimationFrame(resolveFrame))
    await new Promise(resolveTick => setTimeout(resolveTick, 5))
  }
}
await settle(6)

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

// 4. Главное: в idle-состоянии конвейер не порождает новых мутаций.
// Одна внешняя мутация будит observer → проходит полный конвейер → после
// этого DOM обязан молчать: любая самопроизвольная запись означала бы
// возвращение вечной петли observer → rAF → рендер.
let mutationCount = 0
const loopProbe = new windowInstance.MutationObserver((records) => {
  mutationCount += records.length
})
loopProbe.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
})
const poke = document.createElement('span')
document.body.appendChild(poke)
poke.remove()
await settle(4)
const afterPipeline = mutationCount
await settle(8)
assert.equal(
  mutationCount,
  afterPipeline,
  `конвейер продолжает мутировать DOM в idle (${String(mutationCount - afterPipeline)} лишних записей)`,
)
loopProbe.disconnect()

// 5. Повторный проход по неизменному состоянию не пишет в DOM: тексты и
// атрибуты остаются теми же объектами/значениями.
const badgeTextNode = badge.firstChild
const poke2 = document.createElement('span')
document.body.appendChild(poke2)
poke2.remove()
await settle(4)
assert.equal(badge.firstChild, badgeTextNode, 'текстовый узел бейджа пересоздан без изменения состояния')

// 6. Явный выбор English отключает русские DOM-словари: новый EN-узел
// системного монитора остаётся непереведённым, пока выбор — English, и
// переводится после переключения на русский.
windowInstance.localStorage.setItem('gildra.language-choice.v1', 'done')
currentLocale = 'en'
const enLabel = document.createElement('span')
enLabel.textContent = 'DISK'
document.querySelector('.sysmon').appendChild(enLabel)
await settle(4)
assert.equal(enLabel.textContent, 'DISK', 'при явном English перевод не должен применяться')
currentLocale = 'ru'
const poke3 = document.createElement('span')
document.body.appendChild(poke3)
poke3.remove()
await settle(4)
assert.equal(enLabel.textContent, 'ДИСК', 'после возврата на русский перевод должен примениться')

for (const dispose of disposers) dispose()
await windowInstance.happyDOM.abort()
windowInstance.close()

console.log('Gildra UI DOM behavior tests passed.')
