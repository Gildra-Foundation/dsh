// Версионированный loopback-API Gildra Runtime (/gildra/v1/*).
//
// Маршруты exact-типа (path-параметров у ctx.webServer нет): идентификаторы
// передаются в query/body и валидируются как SAFE_SEGMENT. Мутации требуют
// same-origin, application/json и owner-token сессии. Ошибки — структурные
// (errors.js); UI не парсит строки.

import { asRuntimeError } from './errors.js'

export const API_VERSION = 1

const MAX_BODY_BYTES = 64 * 1024

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

export async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw asRuntimeError(new Error('Тело запроса слишком большое.'))
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw asRuntimeError(new Error('Некорректный JSON в запросе.'))
  }
}

export function sameOriginRequest(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

export function registerRuntimeRoutes(ctx) {
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: '/gildra/v1/runtime',
      handler(req, res) {
        if (req.method !== 'GET') {
          jsonResponse(res, 405, { ok: false, error: { code: 'INVALID_INPUT', message: 'Метод не поддерживается.' } })
          return
        }
        jsonResponse(res, 200, { ok: true, runtime: { apiVersion: API_VERSION } })
      },
    }),
  ]
  return () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose()
    }
  }
}
