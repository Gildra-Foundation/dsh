// Идентификаторы и имена веток Gildra Runtime.
//
// Все пути workspace строятся сервером из трёх сегментов
// projectId/userId/sessionId, каждый из которых обязан пройти SAFE_SEGMENT.
// Это делает traversal/абсолютные пути невозможными по построению; проверка
// containment в paths.js остаётся защитой в глубину.

import { randomBytes } from 'node:crypto'
import { userInfo } from 'node:os'
import { RuntimeError } from './errors.js'

export const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/
// Составные идентификаторы записей (workspaceKey = project--user--session)
// длиннее одиночного path-сегмента, но алфавит тот же.
export const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,199}$/

// Основание 32 без неоднозначных символов; строчные, чтобы сегменты были
// безопасны и для файловой системы, и для git-веток.
const ALPHABET = 'abcdefghjkmnpqrstvwxyz0123456789'

function encode(bytes) {
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return out
}

export function generateId(prefix, randomLength = 16) {
  // Временной префикс даёт лексикографическую сортировку по времени создания.
  const time = Date.now().toString(32).padStart(9, '0')
  return `${prefix}-${time}${encode(randomBytes(randomLength))}`
}

export function generateSessionId() {
  return generateId('sess')
}

export function generateOwnerToken() {
  return randomBytes(24).toString('hex')
}

export function assertSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new RuntimeError('INVALID_ID', `${label} должен состоять из строчных латинских букв, цифр и дефисов (до 64 символов).`, { [label]: String(value ?? '') })
  }
  return value
}

export function assertId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new RuntimeError('INVALID_ID', `${label} содержит недопустимые символы.`, { [label]: String(value ?? '') })
  }
  return value
}

export function sanitizeSegment(raw, fallback) {
  const value = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return SAFE_SEGMENT.test(value) ? value : fallback
}

export function currentUserId() {
  // На сервере каждому человеку соответствует отдельный Unix-пользователь —
  // это и есть граница изоляции credentials/state (см. architecture.md 0а.5).
  return sanitizeSegment(userInfo().username, 'user')
}

// Консервативное подмножество правил git check-ref-format: достаточно для
// имён, которые генерирует Runtime, и отклоняет всё подозрительное.
export function isValidBranchName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return false
  if (/[\s\\~^:?*[\]\x00-\x1f\x7f]/.test(name)) return false
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false
  for (const segment of name.split('/')) {
    if (segment === '' || segment.startsWith('.') || segment.endsWith('.lock')) return false
  }
  return true
}

export function assertBranchName(name) {
  if (!isValidBranchName(name)) {
    throw new RuntimeError('INVALID_BRANCH', 'Недопустимое имя ветки.', { branch: String(name ?? '') })
  }
  return name
}

export function sessionBranch(userId, sessionId) {
  return assertBranchName(`session/${assertSegment(userId, 'userId')}/${assertSegment(sessionId, 'sessionId')}`)
}

export function mergeBranch(mergeId) {
  return assertBranchName(`merge/${assertSegment(mergeId, 'mergeId')}`)
}

export const DEFAULT_PROTECTED_BRANCHES = Object.freeze(['main', 'master', 'production', 'release/*'])

export function isProtectedBranch(branch, patterns = DEFAULT_PROTECTED_BRANCHES) {
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      if (branch.startsWith(pattern.slice(0, -1))) return true
    } else if (branch === pattern) {
      return true
    }
  }
  return false
}

export function assertWritableBranch(branch, patterns) {
  assertBranchName(branch)
  if (isProtectedBranch(branch, patterns)) {
    throw new RuntimeError('PROTECTED_BRANCH', `Прямая запись в защищённую ветку «${branch}» запрещена: используйте merge workflow.`, { branch })
  }
  return branch
}
