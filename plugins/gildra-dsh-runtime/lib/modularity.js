// Modularity Analyzer (§7–§8 плана модульности): не-LLM сигналы о спагетти.
//
// Ответственность: сравнить состояние «до» (baseSha) и «после» (HEAD) на
// уровне import-графа и структуры и выдать сигналы + результаты архитектурных
// gates. Сигналы КОНТЕКСТНЫ, а не построчны: блокируются только НОВЫЕ циклы и
// НОВЫЕ нарушения слоёв — legacy-нарушения репортятся отдельно и не душат
// проект задним числом. Количество строк само по себе никогда не блокирует:
// рост УЖЕ большого файла несвязанной логикой — сигнал, большой словарь — нет.

import { createHash } from 'node:crypto'

import { normalizeArchitecturePolicy, checkDeepImports, checkLayerViolations, moduleOf } from './architecture.js'
import { addedEdges, buildImportGraph, findCycles, isSourceFile } from './import-graph.js'
import { isTestPath } from './diff-analyzer.js'
import { matchesAny as matchesAnyCompat, normalizePath } from './globs.js'

const DUPLICATE_WINDOW_LINES = 6
const MAX_DUPLICATE_SCAN_FILES = 400
export const SIDE_EFFECT_SURFACES = [
  { id: 'fs', pattern: /['"]node:fs|['"]fs['"]|['"]fs\// },
  { id: 'network', pattern: /['"]node:https?['"]|['"]node:net['"]|fetch\s*\(/ },
  { id: 'process', pattern: /['"]node:child_process['"]|process\.exit|process\.kill/ },
  { id: 'dom', pattern: /document\.|window\./ },
]

function cycleKey(cycle) {
  return [...new Set(cycle)].sort().join('→')
}

function violationKey(violation) {
  return `${violation.from}→${violation.to}`
}

// Значимые строки для поиска дублей: без пустых, комментариев и скобок.
function significantLines(source) {
  return String(source).split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 3 && !line.startsWith('//') && !line.startsWith('*') && !/^[{}()[\];,]+$/.test(line))
}

function windowHashes(lines, window = DUPLICATE_WINDOW_LINES) {
  const hashes = new Map()
  for (let index = 0; index + window <= lines.length; index += 1) {
    const key = createHash('sha256').update(lines.slice(index, index + window).join('\n')).digest('hex').slice(0, 16)
    if (!hashes.has(key)) hashes.set(key, index)
  }
  return hashes
}

// Верхнеуровневые функции файла и их длины: грубая балансировка фигурных
// скобок. Точности AST не обещается — это REVIEW-сигнал, а не приговор.
export function functionLengths(source) {
  const lines = String(source).split('\n')
  const lengths = []
  let depth = 0
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const opens = (line.match(/\{/g) ?? []).length
    const closes = (line.match(/\}/g) ?? []).length
    if (start === -1 && opens > 0 && /(^|\s)(async\s+)?function\b|=>\s*\{|\w+\s*\([^)]*\)\s*\{/.test(line)) {
      start = index
    }
    depth += opens - closes
    if (start !== -1 && depth <= 0) {
      lengths.push({ startLine: start + 1, lines: index - start + 1 })
      start = -1
      depth = 0
    }
  }
  return lengths
}

export async function analyzeModularity({
  filesBefore,
  readBefore,
  filesAfter,
  readAfter,
  changedFiles,
  addedByFile = new Map(),
  removedByFile = new Map(),
  architecture,
  modulePlan,
  analysisTruncated = false,
}) {
  const policy = normalizeArchitecturePolicy(architecture)
  const signals = []
  const preexisting = []
  const note = (code, detail) => signals.push({ code, detail })

  const changed = changedFiles.map(normalizePath)
  const changedSources = changed.filter(isSourceFile)

  // --- Граф до/после -------------------------------------------------------
  const beforeEdges = await buildImportGraph({ files: filesBefore, read: readBefore })
  const afterEdges = await buildImportGraph({ files: filesAfter, read: readAfter })

  // NEW_DEPENDENCY_CYCLE: цикл, которого не было в базе.
  const cyclesBefore = new Set(findCycles(beforeEdges).map(cycleKey))
  const newCycles = findCycles(afterEdges).filter(cycle => !cyclesBefore.has(cycleKey(cycle)))
  if (newCycles.length > 0) {
    note('NEW_DEPENDENCY_CYCLE', { cycles: newCycles.slice(0, 5) })
  }

  // CROSS_LAYER_IMPORT / DEEP_INTERNAL_IMPORT: только НОВЫЕ нарушения
  // блокируют; существующие — отдельным списком (legacy не душим).
  if (policy.layers.length > 0) {
    const beforeViolations = new Set(checkLayerViolations(beforeEdges, policy.layers).map(violationKey))
    const afterViolations = checkLayerViolations(afterEdges, policy.layers)
    const fresh = afterViolations.filter(violation => !beforeViolations.has(violationKey(violation)))
    if (fresh.length > 0) note('CROSS_LAYER_IMPORT', { violations: fresh.slice(0, 10) })
    preexisting.push(...afterViolations.filter(violation => beforeViolations.has(violationKey(violation))))
  }
  {
    const beforeDeep = new Set(checkDeepImports(beforeEdges, policy.modules).map(violationKey))
    const freshDeep = checkDeepImports(afterEdges, policy.modules).filter(violation => !beforeDeep.has(violationKey(violation)))
    if (freshDeep.length > 0) note('DEEP_INTERNAL_IMPORT', { violations: freshDeep.slice(0, 10) })
  }

  // --- Модули: план против факта (§6) --------------------------------------
  const changedModules = [...new Set(changedSources.map(file => moduleOf(file, policy.modules)))]
  if (modulePlan) {
    const planned = new Set([
      ...(modulePlan.modulesToChange ?? []).map(entry => entry.module),
      ...(modulePlan.newModules ?? []).map(entry => entry.id),
    ])
    const unplanned = changedModules.filter(module => !planned.has(module))
    if (unplanned.length > 0) note('UNEXPECTED_MODULE_CHANGE', { modules: unplanned, planned: [...planned] })
  }

  // --- Рост файлов и функций (§7): контекстно ------------------------------
  for (const file of changedSources) {
    if (isTestPath(file)) continue
    const before = await readBefore(file)
    const after = await readAfter(file)
    if (typeof after !== 'string') continue
    const beforeLines = typeof before === 'string' ? before.split('\n').length : 0
    const afterLines = after.split('\n').length
    const growth = afterLines - beforeLines
    // Сигнал только когда УЖЕ большой файл продолжает расти существенно:
    // новый файл на 500 строк или словарь — не повод.
    if (beforeLines >= policy.limits.fileLinesWarning && growth >= policy.limits.moduleGrowthWarning) {
      note('OVERSIZED_MODULE_GROWTH', { file, beforeLines, afterLines, growth })
    }
    const longBefore = typeof before === 'string'
      ? functionLengths(before).filter(entry => entry.lines > policy.limits.functionLinesWarning).length
      : 0
    const longAfter = functionLengths(after).filter(entry => entry.lines > policy.limits.functionLinesWarning)
    if (longAfter.length > longBefore) {
      note('OVERSIZED_FUNCTION_GROWTH', {
        file,
        limit: policy.limits.functionLinesWarning,
        functions: longAfter.slice(0, 3),
      })
    }
  }

  // --- NEW_GLOBAL_MUTABLE_STATE: добавленный top-level let/var -------------
  for (const [file, lines] of addedByFile) {
    if (!isSourceFile(file) || isTestPath(file)) continue
    const hits = lines.filter(line => /^(export\s+)?(let|var)\s+[A-Za-z_$]/.test(line))
    if (hits.length > 0) note('NEW_GLOBAL_MUTABLE_STATE', { file, lines: hits.slice(0, 3) })
  }

  // --- MIXED_RESPONSIBILITIES / NEW_LARGE_MODULE / RESPONSIBILITY_EXPANSION -
  for (const file of changedSources) {
    if (isTestPath(file)) continue
    const before = await readBefore(file)
    const after = await readAfter(file)
    if (typeof after !== 'string') continue
    const surfacesAfter = SIDE_EFFECT_SURFACES.filter(surface => surface.pattern.test(after)).map(surface => surface.id)

    if (typeof before !== 'string') {
      // Новый файл. MIXED: несколько side-effect слоёв сразу.
      if (surfacesAfter.length >= 3) note('MIXED_RESPONSIBILITIES', { file, surfaces: surfacesAfter })
      // NEW_LARGE_MODULE (§16): не «много строк», а КОМБИНАЦИЯ метрик —
      // большой декларативный словарь функций/exports почти не имеет и
      // сигнала не даёт.
      const lines = after.split('\n').length
      const functions = functionLengths(after)
      const exportsCount = (after.match(/^export /gm) ?? []).length
      const fanOut = (afterEdges.get(file) ?? new Set()).size
      const largest = functions.reduce((max, entry) => Math.max(max, entry.lines), 0)
      if (lines >= 300 && functions.length >= 10
        && (exportsCount >= 10 || surfacesAfter.length >= 2 || fanOut >= 8)) {
        note('NEW_LARGE_MODULE', {
          file, lines, functions: functions.length, exports: exportsCount,
          fanOut, sideEffectSurfaces: surfacesAfter, largestFunctionLines: largest,
        })
      }
    } else {
      // RESPONSIBILITY_EXPANSION (§17): существующий файл обзавёлся новыми
      // side-effect поверхностями — domain-логика начала ходить в fs/сеть.
      const surfacesBefore = SIDE_EFFECT_SURFACES.filter(surface => surface.pattern.test(before)).map(surface => surface.id)
      const gained = surfacesAfter.filter(surface => !surfacesBefore.includes(surface))
      if (gained.length > 0) {
        note('RESPONSIBILITY_EXPANSION', { file, before: surfacesBefore, after: surfacesAfter, gained })
      }
    }
  }

  // --- UNEXPLAINED_PUBLIC_API_CHANGE (§18): gate существует в КОДЕ ----------
  // Удалённые/переименованные export-имена; declared в plan.publicContracts-
  // Changed или подпадающие под policy-классификацию совместимых — не
  // «unexplained».
  {
    const declared = new Set((modulePlan?.publicContractsChanged ?? []).map(String))
    const compatibleGlobs = policy.publicApiCompatible ?? []
    const exportName = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/
    const removedExports = []
    for (const [file, lines] of removedByFile) {
      if (!isSourceFile(file) || isTestPath(file)) continue
      if (compatibleGlobs.length > 0 && matchesAnyCompat(file, compatibleGlobs)) continue
      const addedNames = new Set((addedByFile.get(file) ?? [])
        .map(line => exportName.exec(line)?.[1]).filter(Boolean))
      for (const line of lines) {
        const name = exportName.exec(line)?.[1]
        if (!name) continue
        if (addedNames.has(name)) continue // правка тела с той же сигнатурой
        if (declared.has(name) || declared.has(file) || declared.has(`${file}#${name}`)) continue
        const stillExported = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${name}\\b|^export\\s*\\{[^}]*\\b${name}\\b`, 'm')
          .test(await readAfter(file) ?? '')
        if (stillExported) continue
        removedExports.push({ file, name, kind: addedNames.size > 0 ? 'renamed-or-removed' : 'removed' })
      }
    }
    // Изменение declared public entrypoint модуля — тоже контракт.
    for (const module of policy.modules) {
      for (const entry of module.publicEntrypoints ?? []) {
        if (changed.includes(entry) && !declared.has(entry) && (removedByFile.get(entry) ?? []).some(line => exportName.test(line))) {
          const already = removedExports.some(item => item.file === entry)
          if (!already) removedExports.push({ file: entry, name: '(entrypoint)', kind: 'entrypoint-changed' })
        }
      }
    }
    if (removedExports.length > 0) {
      note('UNEXPLAINED_PUBLIC_API_CHANGE', { changes: removedExports.slice(0, 20) })
    }
  }

  // --- DUPLICATED_DOMAIN_LOGIC: добавленный блок уже существует в другом
  // файле (не изменённом этой задачей).
  {
    const changedSet = new Set(changed)
    const targets = filesAfter
      .filter(file => isSourceFile(file) && !isTestPath(file) && !changedSet.has(normalizePath(file)))
      .slice(0, MAX_DUPLICATE_SCAN_FILES)
    const index = new Map()
    for (const file of targets) {
      const source = await readAfter(file)
      if (typeof source !== 'string') continue
      for (const [hash] of windowHashes(significantLines(source))) {
        if (!index.has(hash)) index.set(hash, file)
      }
    }
    const duplicates = []
    for (const [file, lines] of addedByFile) {
      if (!isSourceFile(file) || isTestPath(file)) continue
      const added = significantLines(lines.join('\n'))
      for (const [hash] of windowHashes(added)) {
        const existing = index.get(hash)
        if (existing) {
          duplicates.push({ file, duplicatedFrom: existing })
          break
        }
      }
    }
    if (duplicates.length > 0) note('DUPLICATED_DOMAIN_LOGIC', { duplicates: duplicates.slice(0, 5) })
  }

  if (analysisTruncated) {
    note('ANALYSIS_INCOMPLETE', { reason: 'diff превысил лимиты анализа — обрезанный diff нельзя считать проверенным' })
  }

  // --- Архитектурные gates (§8) --------------------------------------------
  const byCode = new Map()
  for (const signal of signals) byCode.set(signal.code, signal)
  const gateChecks = [
    { id: 'dependency-cycles', codes: ['NEW_DEPENDENCY_CYCLE'], configured: true },
    { id: 'architecture-boundaries', codes: ['CROSS_LAYER_IMPORT', 'DEEP_INTERNAL_IMPORT'], configured: policy.layers.length > 0 || policy.modules.length > 0 },
    { id: 'module-scope', codes: ['UNEXPECTED_MODULE_CHANGE', 'OVERSIZED_MODULE_GROWTH', 'MIXED_RESPONSIBILITIES', 'DUPLICATED_DOMAIN_LOGIC', 'NEW_GLOBAL_MUTABLE_STATE', 'OVERSIZED_FUNCTION_GROWTH', 'NEW_LARGE_MODULE', 'RESPONSIBILITY_EXPANSION'], configured: true },
    { id: 'public-api', codes: ['UNEXPLAINED_PUBLIC_API_CHANGE'], configured: true },
    { id: 'analysis-completeness', codes: ['ANALYSIS_INCOMPLETE'], configured: true },
  ]
  const checks = gateChecks.map(gate => {
    if (!gate.configured) return { id: gate.id, status: 'NOT_CONFIGURED' }
    const present = gate.codes.filter(code => byCode.has(code))
    const blocking = present.filter(code => policy.gates[code] === 'BLOCK')
    const review = present.filter(code => policy.gates[code] === 'REVIEW')
    return {
      id: gate.id,
      status: blocking.length > 0 ? 'FAILED' : review.length > 0 ? 'WARNING' : 'PASSED',
      ...(present.length > 0 ? { findings: present.map(code => ({ code, gate: policy.gates[code], detail: byCode.get(code).detail })) } : {}),
    }
  })

  // Новые рёбра модулей — для semantic overlap и метрик «до/после».
  const newEdges = addedEdges(beforeEdges, afterEdges)

  return {
    signals,
    checks,
    preexisting,
    changedModules,
    newEdges: newEdges.slice(0, 50),
    gates: policy.gates,
    limits: policy.limits,
  }
}
