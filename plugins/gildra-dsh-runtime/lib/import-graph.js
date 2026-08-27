// Статический import-граф JS/TS-файлов (§9 плана модульности).
//
// Единственная ответственность: превратить набор файлов в граф «кто кого
// импортирует» и ответить на графовые вопросы (циклы, fan-in/out, рёбра
// модулей). Никакого знания о policy, задачах или git — это слой выше.
// Граф строится ИНСТРУМЕНТОМ, не LLM: рёбра приходят из фактических
// import/require-строк (extractImports), резолв — по известному списку
// файлов, без обращения к диску.

import { extractImports, resolveImport } from './claims.js'
import { normalizePath } from './globs.js'

const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts']
const INDEX_BASENAMES = SOURCE_EXTENSIONS.map(extension => `index${extension}`)
const MAX_CYCLES_REPORTED = 20

export function isSourceFile(path) {
  return SOURCE_EXTENSIONS.some(extension => normalizePath(path).endsWith(extension))
}

// Резолв специфier'а в реальный файл репозитория: точное имя, добавление
// расширения или index-файла каталога. Нерезолвленное ребро честно
// отбрасывается (пакетные импорты сюда не попадают вовсе).
export function resolveToFile(fromFile, specifier, fileSet) {
  const bare = resolveImport(fromFile, specifier)
  if (fileSet.has(bare)) return bare
  for (const extension of SOURCE_EXTENSIONS) {
    if (fileSet.has(`${bare}${extension}`)) return `${bare}${extension}`
  }
  for (const index of INDEX_BASENAMES) {
    if (fileSet.has(`${bare}/${index}`)) return `${bare}/${index}`
  }
  return undefined
}

// files: пути репозитория; read(path) → исходник (или undefined).
// Возвращает рёбра файлов: Map<from, Set<to>>.
export async function buildImportGraph({ files, read }) {
  const sources = files.map(normalizePath).filter(isSourceFile)
  const fileSet = new Set(sources)
  const edges = new Map()
  for (const file of sources) {
    const source = await read(file)
    if (typeof source !== 'string') continue
    const targets = new Set()
    for (const specifier of extractImports(source)) {
      const resolved = resolveToFile(file, specifier, fileSet)
      if (resolved && resolved !== file) targets.add(resolved)
    }
    if (targets.size > 0) edges.set(file, targets)
  }
  return edges
}

// Поиск циклов итеративным DFS с раскраской. Возвращает список циклов
// (каждый — массив узлов, замкнутый по смыслу), ограниченный сверху: для
// gate важен факт и пример, а не полный перебор.
export function findCycles(edges) {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map()
  const cycles = []
  const stack = []

  function visit(node) {
    color.set(node, GRAY)
    stack.push(node)
    for (const next of edges.get(node) ?? []) {
      const state = color.get(next) ?? WHITE
      if (state === GRAY) {
        const start = stack.indexOf(next)
        if (cycles.length < MAX_CYCLES_REPORTED) cycles.push([...stack.slice(start), next])
      } else if (state === WHITE) {
        visit(next)
      }
    }
    stack.pop()
    color.set(node, BLACK)
  }

  for (const node of edges.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node)
  }
  return cycles
}

// Рёбра на уровне модулей: fileToModule(file) → id | undefined.
// Самоссылки модулей отбрасываются — внутренние импорты не ребро.
export function moduleEdges(fileEdges, fileToModule) {
  const edges = new Map()
  for (const [from, targets] of fileEdges) {
    const fromModule = fileToModule(from)
    if (!fromModule) continue
    for (const to of targets) {
      const toModule = fileToModule(to)
      if (!toModule || toModule === fromModule) continue
      if (!edges.has(fromModule)) edges.set(fromModule, new Set())
      edges.get(fromModule).add(toModule)
    }
  }
  return edges
}

export function fanMetrics(edges) {
  const fanOut = new Map()
  const fanIn = new Map()
  for (const [from, targets] of edges) {
    fanOut.set(from, targets.size)
    for (const to of targets) fanIn.set(to, (fanIn.get(to) ?? 0) + 1)
  }
  return { fanIn, fanOut }
}

// Новые рёбра между графами «до» и «после» — сырьё для NEW_DEPENDENCY_CYCLE
// и анализа изменений связности.
export function addedEdges(before, after) {
  const added = []
  for (const [from, targets] of after) {
    const previous = before.get(from) ?? new Set()
    for (const to of targets) {
      if (!previous.has(to)) added.push({ from, to })
    }
  }
  return added
}
