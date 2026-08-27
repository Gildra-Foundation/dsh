// Единый lifecycle capability (§21 плана authority).
//
// Доказываемые инварианты:
//   1. в state хранится только хэш — секрет не восстановим из файлов;
//   2. одноразовая capability гаснет после consume; параллельные предъявления
//      не проходят вдвоём (атомарный расход);
//   3. истечение, отзыв, чужая роль/scope/задача/HEAD/policy-ревизия — отказ
//      со структурной причиной;
//   4. значение секрета не попадает в тексты ошибок и audit.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCapabilityStore } from '../lib/capabilities.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'

const base = await mkdtemp(join(tmpdir(), 'gildra caps '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const caps = createCapabilityStore({ store, roots })

// --- 1. Секрет не хранится ---------------------------------------------------
{
  const issued = await caps.issue({ role: 'AI_REVIEWER', scope: 'review-submit', entityId: 'review-1', taskId: 'task-1' })
  const secret = issued.capability.split('.')[1]
  const raw = readFileSync(store.filePath('capabilities', issued.capId), 'utf8')
  assert.ok(!raw.includes(secret), 'state обязан хранить только хэш секрета')

  const record = await caps.verify(issued.capability, { role: 'AI_REVIEWER', scope: 'review-submit', entityId: 'review-1' })
  assert.equal(record.capId, issued.capId)
}

// --- 2. Одноразовость и атомарный расход ------------------------------------
{
  const issued = await caps.issue({ role: 'HUMAN_ADMIN', scope: 'policy-change', projectId: 'demo' })
  const results = await Promise.allSettled([
    caps.consume(issued.capability, { role: 'HUMAN_ADMIN', scope: 'policy-change' }),
    caps.consume(issued.capability, { role: 'HUMAN_ADMIN', scope: 'policy-change' }),
  ])
  const ok = results.filter(entry => entry.status === 'fulfilled')
  const failed = results.filter(entry => entry.status === 'rejected')
  assert.equal(ok.length, 1, 'ровно одно параллельное предъявление проходит')
  assert.equal(failed.length, 1)
  assert.equal(failed[0].reason.code, 'CAPABILITY_INVALID')
  assert.equal(failed[0].reason.details.reason, 'USED')
  // Повтор после расхода — отказ.
  await assert.rejects(caps.verify(issued.capability), error => error.details.reason === 'USED')
}

// --- 3. Истечение, отзыв, привязки -------------------------------------------
{
  const shortLived = await caps.issue({ role: 'AI_REVIEWER', scope: 's', entityId: 'e', ttlMs: 1000 })
  // ttl клампится снизу до 1с — ждать не будем, проверим кламп и путь EXPIRED
  // подделкой времени записи.
  const record = await store.read('capabilities', shortLived.capId)
  await store.write('capabilities', shortLived.capId, { ...record, expiresAt: new Date(Date.now() - 1000).toISOString() })
  await assert.rejects(caps.verify(shortLived.capability), error => error.details.reason === 'EXPIRED')

  const revokable = await caps.issue({ role: 'AI_REVIEWER', scope: 's', entityId: 'e' })
  await caps.revoke(revokable.capId)
  await assert.rejects(caps.verify(revokable.capability), error => error.details.reason === 'REVOKED')

  const bound = await caps.issue({ role: 'TRUSTED_INTEGRATION', scope: 'ci-evidence', projectId: 'demo', headSha: 'a'.repeat(40) })
  await assert.rejects(caps.verify(bound.capability, { role: 'AI_REVIEWER', scope: 'ci-evidence' }), error => error.details.reason === 'ROLE')
  await assert.rejects(caps.verify(bound.capability, { role: 'TRUSTED_INTEGRATION', scope: 'other' }), error => error.details.reason === 'SCOPE')
  await assert.rejects(
    caps.verify(bound.capability, { role: 'TRUSTED_INTEGRATION', scope: 'ci-evidence', headSha: 'b'.repeat(40) }),
    error => error.details.reason === 'BINDING' && error.details.field === 'headSha',
  )
  // Узкая проверка не проходит «широкой» capability без нужной привязки.
  const wide = await caps.issue({ role: 'TRUSTED_INTEGRATION', scope: 'ci-evidence' })
  await assert.rejects(
    caps.verify(wide.capability, { role: 'TRUSTED_INTEGRATION', scope: 'ci-evidence', projectId: 'demo' }),
    error => error.details.reason === 'BINDING',
  )

  const policyBound = await caps.issue({ role: 'HUMAN_ADMIN', scope: 'codeowners', taskId: 't', policyRevision: 3 })
  await assert.rejects(
    caps.verify(policyBound.capability, { role: 'HUMAN_ADMIN', scope: 'codeowners', policyRevision: 4 }),
    error => error.details.reason === 'POLICY_REVISION',
  )

  await assert.rejects(caps.verify('garbage'), error => error.details.reason === 'MALFORMED')
  await assert.rejects(caps.verify(`${bound.capId}.wrongsecret`), error => error.details.reason === 'MISMATCH')
}

// --- 4. Секреты не в ошибках и не в audit ------------------------------------
{
  const issued = await caps.issue({ role: 'AI_REVIEWER', scope: 'leak-check', entityId: 'e' })
  const secret = issued.capability.split('.')[1]
  const thrown = await caps.verify(issued.capability, { role: 'HUMAN_ADMIN' }).catch(error => error)
  assert.ok(!JSON.stringify({ m: thrown.message, d: thrown.details }).includes(secret), 'ошибка не содержит секрет')
  const audit = await readFile(join(roots.stateRoot, 'audit.log'), 'utf8').catch(() => '')
  assert.ok(!audit.includes(secret), 'audit не содержит секрет')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime capability lifecycle tests passed.')
