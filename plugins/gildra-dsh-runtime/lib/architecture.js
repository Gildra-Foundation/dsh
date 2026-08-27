// Architecture Policy и Module Map (§4–§5 плана модульности).
//
// Ответственность модуля: нормализовать архитектурную политику проекта,
// построить машиночитаемую карту модулей из ФАКТОВ (структура каталогов,
// import-граф, CODEOWNERS, policy) и отвечать на вопросы о границах
// (слой файла, модуль файла, нарушения направлений, deep-import мимо
// публичного входа). Ничего про задачи, diff и readiness — это слой выше.
//
// Отсутствие политики не ломает проект: без слоёв проверки слоёв просто не
// применяются, карта строится по каталогам.

import { createHash } from 'node:crypto'

import { RuntimeError } from './errors.js'
import { matchesAny, matchesGlob, normalizePath } from './globs.js'
import { buildImportGraph, fanMetrics, isSourceFile, moduleEdges } from './import-graph.js'
import { ownersForFiles } from './repo-intel.js'

const MAX_LAYERS = 20
const MAX_MODULES = 200
// Дефолтные лимиты (§4): review-сигнал, не приговор.
export const DEFAULT_LIMITS = Object.freeze({
  fileLinesWarning: 400,
  functionLinesWarning: 80,
  moduleGrowthWarning: 200,
})

// Дефолтные gate-решения сигналов (§8); проект переопределяет.
export const DEFAULT_GATES = Object.freeze({
  NEW_DEPENDENCY_CYCLE: 'BLOCK',
  CROSS_LAYER_IMPORT: 'BLOCK',
  UNEXPLAINED_PUBLIC_API_CHANGE: 'BLOCK',
  ANALYSIS_INCOMPLETE: 'BLOCK',
  DEEP_INTERNAL_IMPORT: 'REVIEW',
  OVERSIZED_MODULE_GROWTH: 'REVIEW',
  OVERSIZED_FUNCTION_GROWTH: 'REVIEW',
  NEW_GLOBAL_MUTABLE_STATE: 'REVIEW',
  DUPLICATED_DOMAIN_LOGIC: 'REVIEW',
  MIXED_RESPONSIBILITIES: 'REVIEW',
  UNEXPECTED_MODULE_CHANGE: 'REVIEW',
})

export const GATE_ACTIONS = Object.freeze(['BLOCK', 'REVIEW', 'IGNORE'])

function cleanPatterns(raw, label) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new RuntimeError('INVALID_INPUT', `${label}: нужен непустой массив glob-паттернов.`)
  }
  return raw.map(pattern => {
    if (typeof pattern !== 'string' || pattern.trim() === '' || pattern.length > 200) {
      throw new RuntimeError('INVALID_INPUT', `${label}: паттерн — непустая строка до 200 символов.`)
    }
    return normalizePath(pattern.trim())
  })
}

// Нормализация архитектурной секции Quality Policy. Пустой вход — валидная
// «политика по умолчанию» (без слоёв и явных модулей).
export function normalizeArchitecturePolicy(raw) {
  const policy = raw && typeof raw === 'object' ? raw : {}
  const layers = []
  const layerIds = new Set()
  for (const layer of policy.layers ?? []) {
    if (typeof layer?.id !== 'string' || layer.id === '' || layer.id.length > 60) {
      throw new RuntimeError('INVALID_INPUT', 'architecture.layers: у слоя обязан быть id.')
    }
    if (layerIds.has(layer.id)) throw new RuntimeError('INVALID_INPUT', `architecture.layers: слой «${layer.id}» объявлен дважды.`)
    layerIds.add(layer.id)
    layers.push({
      id: layer.id,
      patterns: cleanPatterns(layer.patterns, `слой «${layer.id}»`),
      mayDependOn: (layer.mayDependOn ?? []).map(String),
    })
  }
  if (layers.length > MAX_LAYERS) throw new RuntimeError('LIMIT_EXCEEDED', `Слишком много слоёв (максимум ${String(MAX_LAYERS)}).`)
  for (const layer of layers) {
    for (const dependency of layer.mayDependOn) {
      if (!layerIds.has(dependency)) {
        throw new RuntimeError('INVALID_INPUT', `Слой «${layer.id}» ссылается на неизвестный слой «${dependency}».`)
      }
    }
  }
  const modules = []
  const moduleIds = new Set()
  for (const module of policy.modules ?? []) {
    if (typeof module?.id !== 'string' || module.id === '' || module.id.length > 80) {
      throw new RuntimeError('INVALID_INPUT', 'architecture.modules: у модуля обязан быть id.')
    }
    if (moduleIds.has(module.id)) throw new RuntimeError('INVALID_INPUT', `Модуль «${module.id}» объявлен дважды.`)
    moduleIds.add(module.id)
    modules.push({
      id: module.id,
      patterns: cleanPatterns(module.patterns, `модуль «${module.id}»`),
      publicEntrypoints: (module.publicEntrypoints ?? []).map(entry => normalizePath(String(entry))),
      ...(typeof module.responsibility === 'string' ? { responsibility: module.responsibility.slice(0, 200) } : {}),
    })
  }
  if (modules.length > MAX_MODULES) throw new RuntimeError('LIMIT_EXCEEDED', `Слишком много модулей (максимум ${String(MAX_MODULES)}).`)
  const gates = { ...DEFAULT_GATES }
  for (const [signal, action] of Object.entries(policy.gates ?? {})) {
    if (!GATE_ACTIONS.includes(action)) {
      throw new RuntimeError('INVALID_INPUT', `architecture.gates.${signal}: допустимо BLOCK, REVIEW или IGNORE.`, { allowed: GATE_ACTIONS })
    }
    gates[signal] = action
  }
  return {
    layers,
    modules,
    limits: {
      ...DEFAULT_LIMITS,
      ...(Number.isInteger(policy.limits?.fileLinesWarning) ? { fileLinesWarning: policy.limits.fileLinesWarning } : {}),
      ...(Number.isInteger(policy.limits?.functionLinesWarning) ? { functionLinesWarning: policy.limits.functionLinesWarning } : {}),
      ...(Number.isInteger(policy.limits?.moduleGrowthWarning) ? { moduleGrowthWarning: policy.limits.moduleGrowthWarning } : {}),
    },
    gates,
    configured: layers.length > 0 || modules.length > 0,
  }
}

export function architecturePolicyHash(policy) {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 16)
}

export function layerOf(path, layers) {
  const normalized = normalizePath(path)
  for (const layer of layers) {
    if (matchesAny(normalized, layer.patterns)) return layer.id
  }
  return undefined
}

// Автогруппировка файлов вне явных модулей: каталог до второго уровня —
// честный fallback-модуль («plugins/gildra-dsh-runtime», «src/auth»).
export function fallbackModuleId(path) {
  const segments = normalizePath(path).split('/')
  if (segments.length === 1) return '(root)'
  return segments.slice(0, Math.min(2, segments.length - 1)).join('/')
}

export function moduleOf(path, modules) {
  const normalized = normalizePath(path)
  for (const module of modules) {
    if (matchesAny(normalized, module.patterns)) return module.id
  }
  return fallbackModuleId(normalized)
}

// --- Module Map ------------------------------------------------------------
// files/read — как в Repository Intelligence (закоммиченное состояние).
export async function buildModuleMap({ files, read, policy, ownersRules = [] }) {
  const normalized = normalizeArchitecturePolicy(policy)
  const sourceFiles = files.filter(isSourceFile)
  const fileEdges = await buildImportGraph({ files: sourceFiles, read })
  const toModule = file => moduleOf(file, normalized.modules)
  const byModule = new Map()
  for (const file of sourceFiles) {
    const id = toModule(file)
    if (!byModule.has(id)) byModule.set(id, [])
    byModule.get(id).push(file)
  }
  const edges = moduleEdges(fileEdges, toModule)
  const { fanIn, fanOut } = fanMetrics(edges)
  const modules = []
  for (const [id, moduleFiles] of [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let lines = 0
    for (const file of moduleFiles) {
      const source = await read(file)
      if (typeof source === 'string') lines += source.split('\n').length
    }
    const declared = normalized.modules.find(module => module.id === id)
    modules.push({
      id,
      files: moduleFiles.length,
      lines,
      patterns: declared?.patterns ?? [fallbackModuleId(moduleFiles[0] ?? '')],
      publicEntrypoints: declared?.publicEntrypoints ?? [],
      ...(declared?.responsibility ? { responsibility: declared.responsibility } : {}),
      dependsOn: [...(edges.get(id) ?? [])].sort(),
      fanIn: fanIn.get(id) ?? 0,
      fanOut: fanOut.get(id) ?? 0,
      owners: ownersForFiles(ownersRules, moduleFiles),
    })
  }
  return { modules, fileEdges, moduleEdges: edges, policy: normalized }
}

// --- Проверки границ -------------------------------------------------------

// CROSS_LAYER_IMPORT: ребро файла нарушает mayDependOn слоёв.
export function checkLayerViolations(fileEdges, layers) {
  if (layers.length === 0) return []
  const allowed = new Map(layers.map(layer => [layer.id, new Set([layer.id, ...layer.mayDependOn])]))
  const violations = []
  for (const [from, targets] of fileEdges) {
    const fromLayer = layerOf(from, layers)
    if (!fromLayer) continue
    for (const to of targets) {
      const toLayer = layerOf(to, layers)
      if (!toLayer || allowed.get(fromLayer)?.has(toLayer)) continue
      violations.push({ code: 'CROSS_LAYER_IMPORT', from, to, fromLayer, toLayer })
    }
  }
  return violations
}

// DEEP_INTERNAL_IMPORT: файл чужого модуля импортируется мимо объявленного
// публичного входа. Применимо только к модулям с publicEntrypoints.
export function checkDeepImports(fileEdges, modules) {
  const withEntrypoints = modules.filter(module => (module.publicEntrypoints ?? []).length > 0)
  if (withEntrypoints.length === 0) return []
  const violations = []
  for (const [from, targets] of fileEdges) {
    for (const to of targets) {
      for (const module of withEntrypoints) {
        if (!matchesAny(to, module.patterns)) continue
        if (matchesAny(from, module.patterns)) continue // внутренние импорты законны
        if (!module.publicEntrypoints.some(entry => matchesGlob(to, entry))) {
          violations.push({ code: 'DEEP_INTERNAL_IMPORT', from, to, module: module.id, entrypoints: module.publicEntrypoints })
        }
      }
    }
  }
  return violations
}

// --- Draft policy (§4): предложение, которое активирует только человек -----
export function draftPolicyFromMap(map) {
  const layers = []
  const seen = new Set()
  for (const module of map.modules) {
    const top = module.id.split('/')[0]
    if (top && !seen.has(top) && module.id !== '(root)') {
      seen.add(top)
      layers.push({ id: top, patterns: [`${top}/**`], mayDependOn: [] })
    }
  }
  return {
    draft: true,
    note: 'Черновик от Repository Intelligence: проверьте направления зависимостей и активируйте политикой качества явно.',
    layers,
    modules: map.modules
      .filter(module => module.files >= 3)
      .map(module => ({ id: module.id, patterns: module.patterns })),
  }
}
