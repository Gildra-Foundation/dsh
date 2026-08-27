// Work Claims: логическая координация команды (§26–§28 плана AI-качества).
//
// Git worktree уже защищает ФАЙЛЫ от физического перетирания. Claims решают
// другую проблему: два человека/агента, не знающие друг о друге, неделю
// параллельно переписывают один модуль в разных ветках и встречаются на
// merge-конфликте. Claim — это сигнал «я работаю здесь», а НЕ файловый lock:
// CLAIMED-пересечение предупреждает, и только EXCLUSIVE блокирует создание
// конфликтующей заявки без явного подтверждения.

import { RuntimeError } from './errors.js'
import { globsIntersect, matchesGlob, normalizePath } from './globs.js'

export const CLAIM_MODES = Object.freeze(['SHARED', 'CLAIMED', 'EXCLUSIVE'])

const MAX_CLAIMS = 20
const MAX_PATTERN_LENGTH = 200

export const CLAIM_TYPES = Object.freeze(['PATH', 'MODULE'])

export function normalizeClaims(raw) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new RuntimeError('INVALID_INPUT', 'claims должен быть массивом.')
  if (raw.length > MAX_CLAIMS) {
    throw new RuntimeError('LIMIT_EXCEEDED', `Слишком много claims (максимум ${String(MAX_CLAIMS)}).`)
  }
  return raw.map(entry => {
    const mode = typeof entry === 'object' && entry !== null && entry.mode !== undefined ? entry.mode : 'CLAIMED'
    if (!CLAIM_MODES.includes(mode)) {
      throw new RuntimeError('INVALID_INPUT', `Недопустимый режим claim «${String(mode)}».`, { allowed: CLAIM_MODES })
    }
    // MODULE-claim (§26): заявка на модуль карты, а не на glob путей.
    if (typeof entry === 'object' && entry !== null && entry.type === 'MODULE') {
      const value = entry.value
      if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_PATTERN_LENGTH) {
        throw new RuntimeError('INVALID_INPUT', 'MODULE-claim требует value с id модуля.')
      }
      return { type: 'MODULE', value: value.trim(), mode }
    }
    const area = typeof entry === 'string' ? entry : (entry?.area ?? entry?.value)
    if (typeof area !== 'string' || area.trim() === '' || area.length > MAX_PATTERN_LENGTH || area.includes('\0')) {
      throw new RuntimeError('INVALID_INPUT', 'Каждый claim — непустой glob-паттерн до 200 символов.')
    }
    return { type: 'PATH', area: normalizePath(area.trim()), mode }
  })
}

// Пересечения кандидата с чужими активными задачами. Кандидат — либо набор
// claims (при создании/обновлении задачи), либо фактические файлы (при
// diff-анализе). SHARED-claim объявляет «здесь можно всем» и в пересечения
// не попадает ни с одной стороны.
export function detectOverlaps({ claims = [], files = [], modules = [] }, others) {
  const overlaps = []
  const myModules = new Set([
    ...modules,
    ...claims.filter(claim => claim.type === 'MODULE' && claim.mode !== 'SHARED').map(claim => claim.value),
  ])
  for (const other of others) {
    for (const foreign of other.claims ?? []) {
      if (foreign.mode === 'SHARED') continue
      if (foreign.type === 'MODULE' || (foreign.value && !foreign.area)) {
        const value = foreign.value
        if (myModules.has(value)) {
          overlaps.push({ taskId: other.taskId, owner: other.owner, area: value, mode: foreign.mode, kind: 'MODULE' })
        }
        continue
      }
      const byClaim = claims.some(own => own.type !== 'MODULE' && own.mode !== 'SHARED' && globsIntersect(own.area, foreign.area))
      const byFile = files.some(file => matchesGlob(file, foreign.area))
      if (!byClaim && !byFile) continue
      overlaps.push({
        taskId: other.taskId,
        owner: other.owner,
        area: foreign.area,
        mode: foreign.mode,
        kind: byFile ? 'FILES' : 'PATH',
      })
    }
    // MODULE-уровень против фактических модулей чужой задачи (из team-сводки).
    for (const module of other.affectedModules ?? []) {
      if (myModules.has(module) && !overlaps.some(entry => entry.taskId === other.taskId && entry.area === module)) {
        overlaps.push({ taskId: other.taskId, owner: other.owner, area: module, mode: 'CLAIMED', kind: 'MODULE' })
      }
    }
  }
  return overlaps
}

// Семантический уровень (§27): модули разные, но связаны рёбрами module-графа
// (1 шаг в любом направлении). Не LLM: рёбра приходят из import-графа карты.
export function detectSemanticOverlaps({ myModules = [], others = [], moduleEdges = new Map() }) {
  const neighbours = new Set()
  for (const module of myModules) {
    for (const to of moduleEdges.get(module) ?? []) neighbours.add(to)
    for (const [from, targets] of moduleEdges) {
      if (targets.has(module)) neighbours.add(from)
    }
  }
  const results = []
  for (const other of others) {
    const theirModules = new Set([
      ...(other.affectedModules ?? []),
      ...(other.claims ?? []).filter(claim => claim.type === 'MODULE').map(claim => claim.value),
    ])
    const shared = [...theirModules].filter(module => neighbours.has(module) && !myModules.includes(module))
    if (shared.length > 0) {
      results.push({ severity: 'HIGH', type: 'SEMANTIC_OVERLAP', taskId: other.taskId, owner: other.owner, sharedModules: shared.slice(0, 10) })
    }
  }
  return results
}

// --- Семантическая связность (MVP без LLM, §28) ---------------------------
// Извлечение import/require-путей из JS/TS-исходника. Только относительные
// импорты: пакетные ('react') не говорят о связи двух областей репозитория.
const IMPORT_PATTERNS = [
  /import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
]

export function extractImports(source) {
  const specifiers = new Set()
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of String(source).matchAll(pattern)) {
      if (match[1].startsWith('.')) specifiers.add(match[1])
    }
  }
  return [...specifiers]
}

// Резолв относительного специфier'а от файла-источника в нормализованный
// путь репозитория (без обращения к диску: расширения не угадываем, а
// сравниваем по пути без расширения).
export function resolveImport(fromFile, specifier) {
  const fromParts = normalizePath(fromFile).split('/').slice(0, -1)
  const parts = [...fromParts]
  for (const segment of normalizePath(specifier).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

function withoutExtension(path) {
  return normalizePath(path).replace(/\.[a-z]+$/i, '')
}

// Файлы двух задач «связаны», если файл одной импортирует файл другой
// (1 шаг по import-графу в любую сторону).
export function relatedByImports({ filesA, importsOfA = new Map(), filesB, importsOfB = new Map() }) {
  const bareA = new Set(filesA.map(withoutExtension))
  const bareB = new Set(filesB.map(withoutExtension))
  for (const [file, specifiers] of importsOfA) {
    for (const specifier of specifiers) {
      if (bareB.has(withoutExtension(resolveImport(file, specifier)))) return true
    }
  }
  for (const [file, specifiers] of importsOfB) {
    for (const specifier of specifiers) {
      if (bareA.has(withoutExtension(resolveImport(file, specifier)))) return true
    }
  }
  return false
}
