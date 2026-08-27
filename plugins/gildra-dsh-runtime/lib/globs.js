// Единый glob-матчинг для scope задач, work claims, protected areas,
// generated-файлов и CODEOWNERS.
//
// Одна реализация вместо четырёх разных regex по модулям: семантика областей
// («какие файлы считаются частью src/auth/**») обязана быть одинаковой в
// claims, diff-анализе и policy — расхождение дало бы задачу, которая «не
// пересекается» по claims, но «вышла за scope» по тем же самым файлам.
//
// Поддерживается ровно то, что нужно слою качества:
//   `**`  — любое число сегментов пути (включая ноль);
//   `*`   — любой фрагмент внутри одного сегмента;
//   `?`   — один символ внутри сегмента.
// Пути сравниваются в POSIX-виде ('/'); Windows-разделители нормализуются.
// Это НЕ полный gitignore: отрицаний (`!`) и классов (`[abc]`) нет — в
// policy-файлах слоя качества они не используются, а честный отказ лучше
// полуподдержки.

const GLOB_CACHE = new Map()
const GLOB_CACHE_LIMIT = 500

export function normalizePath(path) {
  return String(path).replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function segmentToRegExp(segment) {
  let out = ''
  for (const char of segment) {
    if (char === '*') out += '[^/]*'
    else if (char === '?') out += '[^/]'
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return out
}

export function globToRegExp(pattern) {
  const cached = GLOB_CACHE.get(pattern)
  if (cached) return cached
  const normalized = normalizePath(pattern)
  const segments = normalized.split('/').filter(Boolean)
  // Финальный `**` эквивалентен «каталог и всё под ним» — это ровно то, что
  // делает универсальный хвост (?:/.*)? ниже, поэтому сегмент просто снимаем:
  // `src/**` ≡ `src` + потомки. Одинокий `**` матчит всё.
  if (segments.at(-1) === '**') segments.pop()
  const parts = []
  for (const segment of segments) {
    if (segment === '**') {
      // `**` в середине покрывает и ноль сегментов: `src/**/x.js` ⊇ `src/x.js`.
      parts.push('(?:[^/]+/)*')
    } else {
      // `a**b` внутри сегмента — почти всегда опечатка в policy; трактуем
      // строго как `*` внутри одного сегмента, чтобы не расширять права молча.
      parts.push(`${segmentToRegExp(segment.replaceAll('**', '*'))}/`)
    }
  }
  let source = parts.join('')
  if (source.endsWith('/')) source = source.slice(0, -1)
  // Паттерн покрывает сам путь И его потомков (семантика gitignore): area
  // `src/auth` считает своим и файл src/auth, и src/auth/token.js.
  const regExp = source === '' ? /^.*$/ : new RegExp(`^${source}(?:/.*)?$`)
  if (GLOB_CACHE.size >= GLOB_CACHE_LIMIT) GLOB_CACHE.clear()
  GLOB_CACHE.set(pattern, regExp)
  return regExp
}

export function matchesGlob(path, pattern) {
  if (typeof pattern !== 'string' || pattern.trim() === '') return false
  return globToRegExp(pattern.trim()).test(normalizePath(path))
}

export function matchesAny(path, patterns) {
  if (!Array.isArray(patterns)) return false
  return patterns.some(pattern => matchesGlob(path, pattern))
}

// Пересечение двух НАБОРОВ паттернов (для claims): паттерны пересекаются,
// если существует путь, подходящий обоим. Точной алгебры глобов не строим —
// достаточное и честное приближение: A и B пересекаются, когда литеральный
// префикс одного матчится глобом другого (в любую сторону).
export function literalPrefix(pattern) {
  const normalized = normalizePath(pattern)
  const segments = []
  for (const segment of normalized.split('/')) {
    if (segment.includes('*') || segment.includes('?')) break
    if (segment !== '') segments.push(segment)
  }
  return segments.join('/')
}

export function globsIntersect(patternA, patternB) {
  const prefixA = literalPrefix(patternA)
  const prefixB = literalPrefix(patternB)
  // Паттерн, начинающийся с wildcard («**/…», «*.js»), может дотянуться до
  // любого каталога: консервативно считаем пересечение возможным — лишнее
  // предупреждение лучше пропущенного (claims — сигнал кооперации, не замок).
  if (prefixA === '' || prefixB === '') return true
  if (matchesGlob(prefixA, patternB) || matchesGlob(prefixB, patternA)) return true
  // Литеральные префиксы вложены друг в друга: src/auth и src.
  return prefixA.startsWith(`${prefixB}/`) || prefixB.startsWith(`${prefixA}/`)
}
