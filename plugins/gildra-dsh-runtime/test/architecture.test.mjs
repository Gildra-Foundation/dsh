// Architecture Policy, import-граф и Module Map (§4–§5, §9 плана модульности).
//
// Доказываемые инварианты:
//   1. граф строится из фактических import-строк и находит циклы;
//   2. CROSS_LAYER_IMPORT ловит нарушение направлений mayDependOn;
//   3. DEEP_INTERNAL_IMPORT ловит обход публичного входа модуля;
//   4. Module Map строится инструментами: файлы→модули, dependsOn, fan-in/out,
//      owners из CODEOWNERS; без политики работает fallback по каталогам;
//   5. политика валидируется (неизвестный слой, дубль id — ошибка), отсутствие
//      политики не ломает ничего;
//   6. draft policy — предложение с пометкой draft, не активация.

import assert from 'node:assert/strict'

import {
  DEFAULT_GATES,
  architecturePolicyHash,
  buildModuleMap,
  checkDeepImports,
  checkLayerViolations,
  draftPolicyFromMap,
  fallbackModuleId,
  layerOf,
  moduleOf,
  normalizeArchitecturePolicy,
} from '../lib/architecture.js'
import { addedEdges, buildImportGraph, findCycles, moduleEdges, resolveToFile } from '../lib/import-graph.js'
import { parseCodeowners } from '../lib/repo-intel.js'

// Фикстура-репозиторий в памяти: слои domain/application/infrastructure/ui.
const FILES = {
  'src/domain/auth/service.js': "import { rule } from './rules.js'\nexport const login = () => rule()\n",
  'src/domain/auth/rules.js': 'export const rule = () => 1\n',
  'src/domain/auth/index.js': "export { login } from './service.js'\n",
  'src/application/login-flow.js': "import { login } from '../domain/auth/index.js'\nexport const flow = () => login()\n",
  'src/infrastructure/db.js': "import { flow } from '../application/login-flow.js'\nexport const persist = () => flow()\n",
  // Нарушение: domain тянет infrastructure.
  'src/domain/report.js': "import { persist } from '../infrastructure/db.js'\nexport const report = () => persist()\n",
  // Обход публичного входа auth: ui лезет прямо в internals.
  'src/ui/panel.js': "import { rule } from '../domain/auth/rules.js'\nexport const panel = () => rule()\n",
  'README.md': '# docs\n',
}
const read = async path => FILES[path]
const files = Object.keys(FILES)

// --- 1. Граф и циклы --------------------------------------------------------
{
  const edges = await buildImportGraph({ files, read })
  assert.deepEqual([...edges.get('src/application/login-flow.js')], ['src/domain/auth/index.js'])
  assert.equal(edges.has('README.md'), false, 'не-исходники в граф не попадают')
  assert.equal(resolveToFile('src/a/x.js', './y', new Set(['src/a/y.js'])), 'src/a/y.js', 'расширение дорезолвивается')
  assert.equal(resolveToFile('src/a/x.js', '../b', new Set(['src/b/index.js'])), 'src/b/index.js', 'index-файл каталога')

  assert.deepEqual(findCycles(edges), [], 'фикстура без циклов')
  const cyclic = new Map([
    ['a.js', new Set(['b.js'])],
    ['b.js', new Set(['c.js'])],
    ['c.js', new Set(['a.js'])],
    ['solo.js', new Set(['a.js'])],
  ])
  const cycles = findCycles(cyclic)
  assert.equal(cycles.length, 1)
  assert.deepEqual(cycles[0], ['a.js', 'b.js', 'c.js', 'a.js'])

  const added = addedEdges(edges, new Map([...edges, ['x.js', new Set(['y.js'])]]))
  assert.deepEqual(added, [{ from: 'x.js', to: 'y.js' }])
}

// --- 2–3. Слои и deep imports ----------------------------------------------
const policy = normalizeArchitecturePolicy({
  layers: [
    { id: 'domain', patterns: ['src/domain/**'], mayDependOn: [] },
    { id: 'application', patterns: ['src/application/**'], mayDependOn: ['domain'] },
    { id: 'infrastructure', patterns: ['src/infrastructure/**'], mayDependOn: ['application', 'domain'] },
    { id: 'ui', patterns: ['src/ui/**'], mayDependOn: ['application', 'domain'] },
  ],
  modules: [
    { id: 'auth.service', patterns: ['src/domain/auth/**'], publicEntrypoints: ['src/domain/auth/index.js'] },
  ],
})
{
  const edges = await buildImportGraph({ files, read })
  const layerViolations = checkLayerViolations(edges, policy.layers)
  assert.equal(layerViolations.length, 1, 'ровно одно нарушение слоёв')
  assert.deepEqual(layerViolations[0], {
    code: 'CROSS_LAYER_IMPORT',
    from: 'src/domain/report.js',
    to: 'src/infrastructure/db.js',
    fromLayer: 'domain',
    toLayer: 'infrastructure',
  })

  const deep = checkDeepImports(edges, policy.modules)
  assert.equal(deep.length, 1, 'ui/panel лезет в internals auth мимо index')
  assert.equal(deep[0].from, 'src/ui/panel.js')
  assert.equal(deep[0].to, 'src/domain/auth/rules.js')
  // Легальный внутренний импорт (index → service) и легальный публичный
  // (application → index) нарушениями не считаются — только один deep.

  assert.equal(layerOf('src/domain/auth/service.js', policy.layers), 'domain')
  assert.equal(layerOf('scripts/tool.js', policy.layers), undefined, 'файл вне слоёв — не нарушение')
}

// --- 4. Module Map -----------------------------------------------------------
{
  const owners = parseCodeowners('src/domain/** @domain-team\n')
  const map = await buildModuleMap({ files, read, policy, ownersRules: owners })
  const auth = map.modules.find(module => module.id === 'auth.service')
  assert.ok(auth, 'явный модуль политики присутствует в карте')
  assert.equal(auth.files, 3)
  assert.ok(auth.lines > 0)
  assert.deepEqual(auth.owners, ['@domain-team'])
  const app = map.modules.find(module => module.id === 'src/application')
  assert.ok(app, 'файлы вне явных модулей группируются по каталогам')
  assert.deepEqual(app.dependsOn, ['auth.service'], 'dependsOn приходит из import-графа')
  assert.ok(auth.fanIn >= 2, 'auth.service используется application и ui')
  const modEdges = moduleEdges(map.fileEdges, file => moduleOf(file, policy.modules))
  assert.ok([...modEdges.get('src/ui') ?? []].includes('auth.service'))

  // Fallback без политики: карта всё равно строится.
  const bare = await buildModuleMap({ files, read, policy: undefined })
  assert.ok(bare.modules.some(module => module.id === 'src/domain'))
  assert.equal(fallbackModuleId('plugins/gildra-dsh-runtime/lib/tasks.js'), 'plugins/gildra-dsh-runtime')
  assert.equal(fallbackModuleId('README.md'), '(root)')

  // --- 6. Draft policy — предложение, не активация ------------------------
  const draft = draftPolicyFromMap(map)
  assert.equal(draft.draft, true)
  assert.ok(draft.layers.some(layer => layer.id === 'src'))
  assert.match(draft.note, /активируйте/)
}

// --- 5. Валидация политики ---------------------------------------------------
{
  assert.throws(() => normalizeArchitecturePolicy({ layers: [{ id: 'a', patterns: ['x/**'], mayDependOn: ['ghost'] }] }),
    /неизвестный слой/)
  assert.throws(() => normalizeArchitecturePolicy({
    layers: [
      { id: 'a', patterns: ['x/**'] },
      { id: 'a', patterns: ['y/**'] },
    ],
  }), /дважды/)
  assert.throws(() => normalizeArchitecturePolicy({ gates: { NEW_DEPENDENCY_CYCLE: 'MAYBE' } }), /BLOCK, REVIEW или IGNORE/)
  const empty = normalizeArchitecturePolicy(undefined)
  assert.equal(empty.configured, false, 'отсутствие политики — валидное состояние')
  assert.equal(empty.gates.NEW_DEPENDENCY_CYCLE, 'BLOCK', 'дефолтные gates действуют всегда')
  assert.deepEqual(Object.keys(DEFAULT_GATES).length >= 10, true)
  assert.equal(architecturePolicyHash(policy), architecturePolicyHash(policy))
  assert.notEqual(architecturePolicyHash(policy), architecturePolicyHash(empty))
}

console.log('Gildra Runtime architecture policy and module map tests passed.')
