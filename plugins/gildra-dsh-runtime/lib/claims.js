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

export function normalizeClaims(raw) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new RuntimeError('INVALID_INPUT', 'claims должен быть массивом.')
  if (raw.length > MAX_CLAIMS) {
    throw new RuntimeError('LIMIT_EXCEEDED', `Слишком много claims (максимум ${String(MAX_CLAIMS)}).`)
  }
  return raw.map(entry => {
    const area = typeof entry === 'string' ? entry : entry?.area
    const mode = typeof entry === 'object' && entry !== null && entry.mode !== undefined ? entry.mode : 'CLAIMED'
    if (typeof area !== 'string' || area.trim() === '' || area.length > MAX_PATTERN_LENGTH || area.includes('\0')) {
      throw new RuntimeError('INVALID_INPUT', 'Каждый claim — непустой glob-паттерн до 200 символов.')
    }
    if (!CLAIM_MODES.includes(mode)) {
      throw new RuntimeError('INVALID_INPUT', `Недопустимый режим claim «${String(mode)}».`, { allowed: CLAIM_MODES })
    }
    return { area: normalizePath(area.trim()), mode }
  })
}

// Пересечения кандидата с чужими активными задачами. Кандидат — либо набор
// claims (при создании/обновлении задачи), либо фактические файлы (при
// diff-анализе). SHARED-claim объявляет «здесь можно всем» и в пересечения
// не попадает ни с одной стороны.
export function detectOverlaps({ claims = [], files = [] }, others) {
  const overlaps = []
  for (const other of others) {
    for (const foreign of other.claims ?? []) {
      if (foreign.mode === 'SHARED') continue
      const byClaim = claims.some(own => own.mode !== 'SHARED' && globsIntersect(own.area, foreign.area))
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
  }
  return overlaps
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
