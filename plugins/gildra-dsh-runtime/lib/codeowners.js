// Парсер CODEOWNERS и резолв владельцев файлов.
//
// Выделен в собственный модуль после того, как Modularity Analyzer нашёл
// цикл repo-intel ↔ architecture: оба слоя нуждаются во владельцах, значит
// владельцы — их ОБЩАЯ нижележащая зависимость, а не повод для цикла.
// Минимальный парсер обычных паттернов (§31 плана AI-качества): комментарии,
// якоря `/`, basename-паттерны без слэша. Семантика GitHub: ПОСЛЕДНЕЕ
// совпавшее правило решает.

import { matchesAny, normalizePath } from './globs.js'

export function parseCodeowners(text) {
  const rules = []
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const [rawPattern, ...owners] = line.split(/\s+/)
    if (!rawPattern || owners.length === 0) continue
    let pattern = rawPattern.replace(/^\//, '')
    // Паттерн без '/' в CODEOWNERS матчит basename на любой глубине.
    if (!pattern.includes('/')) pattern = `**/${pattern}`
    if (pattern.endsWith('/')) pattern = pattern.slice(0, -1)
    rules.push({ pattern, owners: owners.filter(owner => owner.length <= 100).slice(0, 20) })
  }
  return rules
}

export function ownersForFiles(rules, files) {
  const owners = new Set()
  for (const file of files) {
    // Последнее совпавшее правило побеждает — как в GitHub.
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      if (matchesAny(normalizePath(file), [rules[index].pattern])) {
        for (const owner of rules[index].owners) owners.add(owner)
        break
      }
    }
  }
  return [...owners].sort()
}
