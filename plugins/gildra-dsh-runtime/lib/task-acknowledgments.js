// Acknowledgments сигналов с provenance-отпечатками (§10, §15, §20).
//
// Выделен из tasks.js: только гашение сигналов проверенными акторами.

import { RuntimeError } from './errors.js'
import { appendAudit } from './audit.js'
import { signalFingerprint } from './provenance.js'
import { actor } from './task-store.js'

// Сигналы, чьё объяснение обязан дать reviewer или человек, а не сам writer
// (§15): ослабление тестов, protected-области, зависимости и публичный API.
export const REVIEWER_ACK_SIGNALS = Object.freeze([
  'TEST_WEAKENING', 'PROTECTED_AREA_CHANGE', 'DEPENDENCY_CHANGE', 'BACKWARD_COMPATIBILITY',
])

// Сигналы diff-анализа, требующие явного объяснения.
export const ACKNOWLEDGEABLE_SIGNALS = Object.freeze([
  'TEST_WEAKENING', 'UNEXPECTED_CHANGE', 'PROTECTED_AREA_CHANGE',
  'DEPENDENCY_CHANGE', 'GENERATED_FILE_EDIT', 'BACKWARD_COMPATIBILITY',
  'UPSTREAM_RELEVANT',
  'DEEP_INTERNAL_IMPORT', 'OVERSIZED_MODULE_GROWTH', 'OVERSIZED_FUNCTION_GROWTH',
  'NEW_GLOBAL_MUTABLE_STATE', 'DUPLICATED_DOMAIN_LOGIC', 'MIXED_RESPONSIBILITIES',
  'UNEXPECTED_MODULE_CHANGE', 'NEW_LARGE_MODULE', 'RESPONSIBILITY_EXPANSION',
])

export function createTaskAcknowledgments({ roots, taskStore }) {
  const { getTask, saveTask } = taskStore
  // Явное объяснение сигнала diff-анализа (§37, §15): молча сигнал не гаснет,
  // и объяснение привязывается к ОТПЕЧАТКУ текущего сигнала — прошлогоднее
  // объяснение TEST_WEAKENING не покрывает новое ослабление после следующего
  // коммита. verifiedActor обязан быть УЖЕ проверен вызывающим слоем
  // (capability ревьюера проверяет review-модуль/API).
  async function acknowledgeSignal(taskId, { signal, explanation, verifiedActor }) {
    const record = await getTask(taskId)
    if (!ACKNOWLEDGEABLE_SIGNALS.includes(signal)) {
      throw new RuntimeError('INVALID_INPUT', `Неизвестный сигнал «${String(signal)}».`, { allowed: ACKNOWLEDGEABLE_SIGNALS })
    }
    if (typeof explanation !== 'string' || explanation.trim().length < 10) {
      throw new RuntimeError('INVALID_INPUT', 'Объяснение сигнала обязано быть содержательным (минимум 10 символов).')
    }
    const actorInfo = verifiedActor && typeof verifiedActor === 'object'
      ? { type: String(verifiedActor.type ?? 'AI_WRITER'), id: actor(verifiedActor.id) }
      : { type: 'AI_WRITER' }
    if (REVIEWER_ACK_SIGNALS.includes(signal) && actorInfo.type !== 'AI_REVIEWER' && actorInfo.type !== 'HUMAN') {
      throw new RuntimeError('ACK_REQUIRES_REVIEWER', `Сигнал ${signal} гасится только reviewer'ом или человеком: объяснение writer'а — не приёмка собственной работы.`, { signal })
    }
    // Отпечаток: все текущие сигналы этого kind из последнего анализа. Для
    // UPSTREAM_RELEVANT привязка — к targetSha upstream-оценки.
    const matching = (record.analysis?.signals ?? []).filter(entry => entry.kind === signal)
    const fingerprint = signal === 'UPSTREAM_RELEVANT'
      ? signalFingerprint(signal, { targetSha: record.upstream?.targetSha })
      : signalFingerprint(signal, matching.map(entry => entry.fingerprint).sort())
    record.acknowledgments = [
      ...record.acknowledgments.filter(entry => entry.signal !== signal),
      {
        signal,
        fingerprint,
        headSha: record.analysis?.headSha,
        analysisHash: record.analysis?.analysisHash,
        ...(signal === 'UPSTREAM_RELEVANT' ? { targetSha: record.upstream?.targetSha } : {}),
        actorType: actorInfo.type,
        ...(actorInfo.id ? { actorId: actorInfo.id } : {}),
        explanation: explanation.trim().slice(0, 1000),
        createdAt: new Date().toISOString(),
      },
    ]
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.signal.acknowledged', { taskId, signal, actorType: actorInfo.type })
    return updated
  }

  // Доставка: PR-факты. CI-статус сюда НЕ принимается (§32) — только через
  // recordCiEvidence со структурной привязкой к commit SHA.

  return { acknowledgeSignal }
}
