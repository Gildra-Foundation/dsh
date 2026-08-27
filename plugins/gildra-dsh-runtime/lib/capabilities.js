// Единый lifecycle scoped-capability (§21 плана authority).
//
// Узкая ответственность: выдать, проверить, израсходовать и отозвать
// доказательство права на ОДНО действие. Ничего не знает о review, policy или
// CI — роли и scope задают вызывающие модули. Инварианты:
//   - в state хранится только SHA-256-хэш секрета (timing-safe сравнение);
//   - одноразовая capability гаснет атомарно (расход под локом);
//   - у каждой capability есть срок, сущность, роль и scope: чужая задача,
//     чужой review, старый HEAD, старая policy-ревизия — отказ;
//   - значение секрета не попадает в тексты ошибок, audit и diagnostics.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { RuntimeError } from './errors.js'
import { assertId, generateId } from './ids.js'
import { appendAudit } from './audit.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'

const CAPABILITIES = 'capabilities'
const DEFAULT_TTL_MS = 15 * 60_000
const MAX_TTL_MS = 24 * 60 * 60_000

export const CAPABILITY_ROLES = Object.freeze(['AI_REVIEWER', 'HUMAN_ADMIN', 'TRUSTED_INTEGRATION'])

function hashSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex')
}

function secretsMatch(given, storedHash) {
  if (typeof given !== 'string' || typeof storedHash !== 'string') return false
  const a = Buffer.from(hashSecret(given), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// Ошибка НИКОГДА не содержит значение capability; причина — структурным
// кодом в details.reason.
function invalid(reason, extra = {}) {
  return new RuntimeError('CAPABILITY_INVALID', 'Предъявленная capability не даёт права на это действие.', { reason, ...extra })
}

export function createCapabilityStore({ store, roots }) {
  // Выдача. Возвращает секрет РОВНО один раз; запись в state — без секрета.
  async function issue({ role, scope, entityId, projectId, taskId, headSha, policyRevision, ttlMs = DEFAULT_TTL_MS, oneTime = true }) {
    if (!CAPABILITY_ROLES.includes(role)) {
      throw new RuntimeError('INVALID_INPUT', `Неизвестная роль capability «${String(role)}».`, { allowed: CAPABILITY_ROLES })
    }
    if (typeof scope !== 'string' || scope === '' || scope.length > 80) {
      throw new RuntimeError('INVALID_INPUT', 'scope capability — непустая строка до 80 символов.')
    }
    const capId = generateId('cap')
    const secret = randomBytes(24).toString('hex')
    const now = Date.now()
    const record = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      capId,
      role,
      scope,
      ...(entityId !== undefined ? { entityId: String(entityId).slice(0, 120) } : {}),
      ...(projectId !== undefined ? { projectId: String(projectId).slice(0, 120) } : {}),
      ...(taskId !== undefined ? { taskId: String(taskId).slice(0, 120) } : {}),
      ...(headSha !== undefined ? { headSha: String(headSha).slice(0, 64) } : {}),
      ...(policyRevision !== undefined ? { policyRevision } : {}),
      secretHash: hashSecret(secret),
      oneTime: oneTime !== false,
      generation: 1,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.min(Math.max(ttlMs, 1000), MAX_TTL_MS)).toISOString(),
    }
    await store.write(CAPABILITIES, capId, record)
    await appendAudit(roots.stateRoot, 'capability.issued', { capId, role, scope, ...(record.taskId ? { taskId: record.taskId } : {}) })
    // Формат «id.secret»: verify находит запись напрямую, без перебора.
    return { capability: `${capId}.${secret}`, capId, expiresAt: record.expiresAt }
  }

  function parse(capability) {
    if (typeof capability !== 'string') throw invalid('MISSING')
    const dot = capability.indexOf('.')
    if (dot <= 0) throw invalid('MALFORMED')
    return { capId: capability.slice(0, dot), secret: capability.slice(dot + 1) }
  }

  async function load(capability) {
    const { capId, secret } = parse(capability)
    const record = await store.read(CAPABILITIES, assertId(capId, 'capId')).catch(() => undefined)
    if (!record) throw invalid('UNKNOWN')
    if (!secretsMatch(secret, record.secretHash)) throw invalid('MISMATCH')
    return record
  }

  // Проверка без расхода. expect сверяет роль/скоуп/сущность/привязки.
  async function verify(capability, expect = {}) {
    const record = await load(capability)
    if (record.revokedAt) throw invalid('REVOKED', { capId: record.capId })
    if (record.oneTime && record.usedAt) throw invalid('USED', { capId: record.capId })
    if (Date.parse(record.expiresAt) <= Date.now()) throw invalid('EXPIRED', { capId: record.capId })
    if (expect.role !== undefined && expect.role !== record.role) throw invalid('ROLE', { expected: expect.role })
    if (expect.scope !== undefined && expect.scope !== record.scope) throw invalid('SCOPE', { expected: expect.scope })
    for (const field of ['entityId', 'projectId', 'taskId', 'headSha']) {
      if (expect[field] !== undefined && record[field] !== undefined && expect[field] !== record[field]) {
        throw invalid('BINDING', { field })
      }
      // Привязка, которой ждёт проверяющий, но которой нет у capability, —
      // тоже отказ: нельзя «широкой» capability пройти узкую проверку.
      if (expect[field] !== undefined && record[field] === undefined) throw invalid('BINDING', { field })
    }
    if (expect.policyRevision !== undefined && record.policyRevision !== undefined && expect.policyRevision !== record.policyRevision) {
      throw invalid('POLICY_REVISION')
    }
    return record
  }

  // Расход одноразовой capability: verify + пометка usedAt под локом —
  // параллельные предъявления не проходят вдвоём.
  async function consume(capability, expect = {}) {
    const { capId } = parse(capability)
    return store.withLock(`cap-${capId.slice(0, 50)}`, async () => {
      const record = await verify(capability, expect)
      if (record.oneTime) {
        await store.write(CAPABILITIES, record.capId, { ...record, usedAt: new Date().toISOString() })
      }
      await appendAudit(roots.stateRoot, 'capability.used', { capId: record.capId, role: record.role, scope: record.scope })
      return record
    }, { timeoutMs: 10_000 })
  }

  async function revoke(capId) {
    const record = await store.read(CAPABILITIES, assertId(capId, 'capId'))
    if (!record) return { revoked: false }
    await store.write(CAPABILITIES, capId, { ...record, revokedAt: new Date().toISOString() })
    await appendAudit(roots.stateRoot, 'capability.revoked', { capId })
    return { revoked: true }
  }

  return { issue, verify, consume, revoke }
}
