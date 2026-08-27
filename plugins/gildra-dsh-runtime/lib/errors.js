// Структурированная модель ошибок Gildra Runtime.
//
// UI и агенты не должны парсить человекочитаемые строки: каждая ошибка несёт
// машинный code, HTTP-статус и details. API сериализует их как
// { ok: false, error: { code, message, details } }.

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_ID: 400,
  INVALID_BRANCH: 400,
  PROTECTED_BRANCH: 403,
  FOREIGN_OWNER: 403,
  UNAUTHORIZED_SESSION: 403,
  PROJECT_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  WORKSPACE_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  PROJECT_EXISTS: 409,
  SESSION_EXISTS: 409,
  WORKSPACE_EXISTS: 409,
  WORKSPACE_LOCKED: 409,
  WORKSPACE_DIRTY: 409,
  WORKSPACE_BUSY: 409,
  BRANCH_CHECKED_OUT: 409,
  MERGE_CONFLICT: 409,
  MERGE_TARGET_MOVED: 409,
  SESSION_ORPHANED: 409,
  LIVE_PROCESSES: 409,
  // Слой AI-качества: готовность вычисляется, а не назначается; claims
  // сигнализируют о пересечении работы.
  READINESS_REQUIRED: 409,
  MODULE_PLAN_REQUIRED: 409,
  ACK_REQUIRES_REVIEWER: 403,
  VERIFICATION_ACTIVE: 409,
  TEAM_STATE_CONFLICT: 409,
  CLAIM_CONFLICT: 409,
  WRITER_REVIEWER_CONFLICT: 409,
  REVIEW_NOT_FOUND: 404,
  LIMIT_EXCEEDED: 429,
  PORT_UNAVAILABLE: 503,
  PORT_POOL_EXHAUSTED: 503,
  GIT_UNAVAILABLE: 503,
  GIT_AUTH_REQUIRED: 502,
  GIT_TIMEOUT: 504,
  // Транзиентный сбой доступа к файлам репозитория (в основном Windows):
  // повтор уместен, поэтому 503, а не 502.
  GIT_TRANSIENT: 503,
  UNSUPPORTED_GIT_VERSION: 503,
  PROJECT_DEGRADED: 409,
  PROJECT_IN_USE: 409,
  RUNTIME_NOT_READY: 503,
  STORE_CORRUPT: 500,
  GIT_FAILED: 502,
  INTERNAL: 500,
})

export class RuntimeError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'RuntimeError'
    if (!(code in ERROR_CODES)) {
      // Неизвестный код — это баг вызывающего кода, но ошибку пользователю
      // всё равно нужно отдать, поэтому деградируем в INTERNAL.
      this.code = 'INTERNAL'
      this.details = { requestedCode: code, ...(details ?? {}) }
    } else {
      this.code = code
      this.details = details
    }
    this.status = ERROR_CODES[this.code]
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }
}

export function asRuntimeError(error) {
  if (error instanceof RuntimeError) return error
  return new RuntimeError('INTERNAL', error instanceof Error ? error.message : String(error))
}
