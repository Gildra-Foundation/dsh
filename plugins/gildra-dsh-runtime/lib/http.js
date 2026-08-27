// HTTP-обвязка Runtime API: строгие guard'ы запроса и идемпотентность.
//
// Границы безопасности здесь ровно две, и обе честные: API слушает только
// loopback (это обеспечивает сам Harness), а мутации требуют capability
// сессии. Origin/Content-Type проверяются не потому, что браузер — враг, а
// потому что любая локальная страница в том же браузере может отправить
// запрос на 127.0.0.1: строгий allowlist origin отсекает cross-origin
// form-POST и снижает поверхность DNS rebinding.

import { randomUUID } from 'node:crypto'
import { RuntimeError, asRuntimeError } from './errors.js'

export const MAX_BODY_BYTES = 64 * 1024
export const MAX_STRING_FIELD = 2048

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

// Разрешён только http(s) на loopback. Порт не фиксируем: локальный Harness и
// проброшенный по SSH удалённый слушают разные порты, но всегда на loopback.
export function isAllowedOrigin(origin) {
  if (typeof origin !== 'string' || origin === '') return false
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return LOOPBACK_HOSTS.has(url.hostname) || LOOPBACK_HOSTS.has(`[${url.hostname}]`)
}

// Host защищает от DNS rebinding: атакующий домен, отрезолвленный в 127.0.0.1,
// придёт с чужим Host. Пустой Host невозможен в HTTP/1.1.
export function isAllowedHost(host) {
  if (typeof host !== 'string' || host === '') return false
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0]
  return LOOPBACK_HOSTS.has(hostname)
}

// Мутации обязаны нести Origin: запрос без него приходит не от браузера
// (curl, расширение, другой процесс), и разрешать ему менять состояние
// сессий незачем — UI всегда шлёт Origin.
export function assertMutationRequest(req) {
  if (!isAllowedHost(req.headers?.host)) {
    throw new RuntimeError('UNAUTHORIZED_SESSION', 'Запрос отклонён: недопустимый Host.', {})
  }
  if (!isAllowedOrigin(req.headers?.origin)) {
    throw new RuntimeError('UNAUTHORIZED_SESSION', 'Мутации разрешены только из приложения Gildra DSH (loopback origin).', {})
  }
  const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    throw new RuntimeError('UNSUPPORTED_MEDIA_TYPE', 'Тело запроса должно иметь тип application/json.', {})
  }
}

export async function readJsonBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      throw new RuntimeError('INVALID_INPUT', `Тело запроса больше ${String(maxBytes)} байт.`, { maxBytes })
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  let value
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RuntimeError('INVALID_INPUT', 'Некорректный JSON в запросе.', {})
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeError('INVALID_INPUT', 'Тело запроса должно быть JSON-объектом.', {})
  }
  // Защита от случайного/вредоносного гигантского поля: длинная строка в
  // title/URL раздувает state-файл и audit.
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'string' && field.length > MAX_STRING_FIELD) {
      throw new RuntimeError('INVALID_INPUT', `Поле «${key}» длиннее ${String(MAX_STRING_FIELD)} символов.`, { field: key })
    }
  }
  return value
}

// Идемпотентность мутаций (§11): повтор запроса с тем же Idempotency-Key
// возвращает ПЕРВЫЙ результат вместо создания второй сессии/merge. Кэш
// живёт в памяти процесса и ограничен по размеру и времени: он защищает от
// ретрая клиента, а не заменяет durable-состояние.
export function createIdempotencyCache({ ttlMs = 10 * 60_000, maxEntries = 256, now = () => Date.now() } = {}) {
  const entries = new Map()

  function prune() {
    const cutoff = now() - ttlMs
    for (const [key, entry] of entries) {
      if (entry.at < cutoff) entries.delete(key)
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      entries.delete(oldest.value)
    }
  }

  return {
    keyOf(req, route) {
      const raw = req.headers?.['idempotency-key']
      if (typeof raw !== 'string' || raw.trim() === '') return undefined
      if (raw.length > 200) throw new RuntimeError('INVALID_INPUT', 'Idempotency-Key слишком длинный.', {})
      return `${route}:${raw.trim()}`
    },
    get(key) {
      if (!key) return undefined
      prune()
      const entry = entries.get(key)
      if (!entry) return undefined
      // Повторный запрос, пока первый ещё выполняется, ждёт его результат:
      // иначе ретрай по таймауту создал бы дубль.
      return entry.promise
    },
    remember(key, promise) {
      if (!key) return promise
      entries.set(key, { at: now(), promise })
      prune()
      // Неудачную операцию не кэшируем: повтор должен иметь шанс.
      promise.catch(() => entries.delete(key))
      return promise
    },
    size: () => entries.size,
  }
}

export function jsonResponse(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function errorResponse(res, error) {
  const runtimeError = asRuntimeError(error)
  jsonResponse(res, runtimeError.status, { ok: false, error: runtimeError.toJSON() })
}

export function requestId() {
  return `req-${randomUUID().slice(0, 8)}`
}
