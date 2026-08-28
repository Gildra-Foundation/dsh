// Доставка: PR-метаданные, доверенное CI-evidence и human-approvals
// (§7, §30–§32, §20).
//
// Выделен из tasks.js: только факты доставки; никакой готовности и claims.

import { RuntimeError } from './errors.js'
import { appendAudit } from './audit.js'
import { actor } from './task-store.js'

const DEFAULT_CI_FIX_LIMIT = 3

export function createTaskDelivery({ roots, taskStore }) {
  const { getTask, saveTask } = taskStore
  // Доставка: PR-факты. CI-статус сюда НЕ принимается (§32) — только через
  // recordCiEvidence со структурной привязкой к commit SHA.
  async function recordDelivery(taskId, { mode, prUrl, prNumber, ciStatus, branchPushed }) {
    if (ciStatus !== undefined) {
      throw new RuntimeError('INVALID_INPUT', 'ciStatus в delivery не принимается: CI-доказательство передаётся через /tasks/ci-evidence с commitSha и workflowRunId (§32).')
    }
    const record = await getTask(taskId)
    const delivery = { ...(record.delivery ?? { ciFixAttempts: 0 }) }
    if (mode !== undefined) {
      if (!['PR', 'LOCAL_MERGE'].includes(mode)) {
        throw new RuntimeError('INVALID_INPUT', 'delivery.mode: PR или LOCAL_MERGE.')
      }
      delivery.mode = mode
    }
    if (prUrl !== undefined) {
      let parsed
      try {
        parsed = new URL(String(prUrl))
      } catch {
        throw new RuntimeError('INVALID_INPUT', 'prUrl должен быть корректным https-URL.')
      }
      if (parsed.protocol !== 'https:') throw new RuntimeError('INVALID_INPUT', 'prUrl должен быть https.')
      delivery.prUrl = parsed.href
    }
    if (prNumber !== undefined) {
      if (!Number.isInteger(prNumber) || prNumber <= 0) throw new RuntimeError('INVALID_INPUT', 'prNumber — положительное целое.')
      delivery.prNumber = prNumber
    }
    if (branchPushed !== undefined) delivery.branchPushed = branchPushed === true
    record.delivery = delivery
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.delivery', { taskId, ...(delivery.prNumber ? { prNumber: delivery.prNumber } : {}) })
    return updated
  }

  // Доверенное CI-evidence (§32): произвольный {"ciStatus":"PASSED"} не
  // принимается. Обязательны commitSha (== headSha задачи), workflowRunId и
  // источник; новый коммит протухает доказательство сам собой (проверка в
  // readiness по commitSha).
  async function recordCiEvidence(taskId, evidence) {
    const record = await getTask(taskId)
    // §7: наличие полей в JSON — не доверие. Evidence принимается только от
    // слоя, проверившего TRUSTED_INTEGRATION-capability предъявителя.
    if (evidence?.verifiedIntegration?.provider === undefined) {
      throw new RuntimeError('CAPABILITY_REQUIRED', 'CI-evidence принимается только от доверенной интеграции (TRUSTED_INTEGRATION capability): поля source/workflowRunId сами по себе ничего не доказывают.', { taskId })
    }
    const commitSha = typeof evidence?.commitSha === 'string' ? evidence.commitSha : ''
    const conclusion = String(evidence?.conclusion ?? '')
    if (!/^[0-9a-f]{40}$/.test(commitSha)) {
      throw new RuntimeError('INVALID_INPUT', 'CI-evidence требует полный commitSha (40 hex).')
    }
    if (!['success', 'failure', 'cancelled', 'timed_out', 'neutral'].includes(conclusion)) {
      throw new RuntimeError('INVALID_INPUT', 'CI-evidence: conclusion — success/failure/cancelled/timed_out/neutral.')
    }
    if (typeof evidence?.workflowRunId !== 'string' && !Number.isInteger(evidence?.workflowRunId)) {
      throw new RuntimeError('INVALID_INPUT', 'CI-evidence требует workflowRunId доверенной интеграции.')
    }
    const currentHead = record.analysis?.headSha
    if (currentHead && commitSha !== currentHead) {
      throw new RuntimeError('CI_EVIDENCE_MISMATCH', `CI-evidence относится к ${commitSha.slice(0, 12)}, а HEAD задачи — ${String(currentHead).slice(0, 12)}: доказательство чужого коммита не принимается.`, {
        taskId, commitSha, headSha: currentHead,
      })
    }
    const delivery = { ...(record.delivery ?? { ciFixAttempts: 0 }) }
    delivery.ci = {
      commitSha,
      conclusion,
      workflowRunId: String(evidence.workflowRunId),
      ...(evidence.checkSuiteId ? { checkSuiteId: String(evidence.checkSuiteId).slice(0, 60) } : {}),
      ...(evidence.repository ? { repository: String(evidence.repository).slice(0, 200) } : {}),
      provider: String(evidence.verifiedIntegration.provider).slice(0, 60),
      verifiedBy: `${String(evidence.verifiedIntegration.provider).slice(0, 60)}-integration`,
      verifiedAt: new Date().toISOString(),
    }
    if (conclusion !== 'success') {
      delivery.ciFixAttempts = (delivery.ciFixAttempts ?? 0) + 1
      record.failureKind = 'CI'
      // Ограниченный CI-цикл: после лимита задача останавливается и ждёт
      // человека, а не чинит CI вечно.
      if (delivery.ciFixAttempts > DEFAULT_CI_FIX_LIMIT) {
        record.status = 'BLOCKED'
        record.blockReason = `CI падал ${String(delivery.ciFixAttempts)} раз подряд — автоматические починки исчерпаны, нужен человек.`
      }
    } else {
      delete record.failureKind
    }
    record.delivery = delivery
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.ci-evidence', { taskId, conclusion, workflowRunId: delivery.ci.workflowRunId })
    return updated
  }

  // Human-approval (§6 плана authority): фиксируется ТОЛЬКО после расхода
  // одноразовой HumanActionCapability, выданной интерактивным каналом
  // приложения. Флаг {"human": true} доказательством не является и не
  // принимается. verifiedHuman обязан прийти от слоя, который расходовал
  // capability (API/host) — сама задача ей не управляет.
  // Human-approval (§6 плана authority): фиксируется ТОЛЬКО после расхода
  // одноразовой HumanActionCapability, выданной интерактивным каналом
  // приложения. Флаг {"human": true} доказательством не является и не
  // принимается. verifiedHuman обязан прийти от слоя, который расходовал
  // capability (API/host) — сама задача ей не управляет.
  async function recordHumanApproval(taskId, { kind, actorId, note, verifiedHuman }) {
    const record = await getTask(taskId)
    const approvalKind = String(kind ?? '').slice(0, 60)
    if (approvalKind === '') throw new RuntimeError('INVALID_INPUT', 'Укажите kind human-approval (например CODEOWNERS).')
    if (verifiedHuman !== true) {
      throw new RuntimeError('CAPABILITY_REQUIRED', 'Human-approval фиксируется только по одноразовой HumanActionCapability из интерактивного канала — слово «я человек» не принимается.', { taskId, kind: approvalKind })
    }
    record.humanApprovals = [
      ...(record.humanApprovals ?? []).filter(entry => entry.kind !== approvalKind),
      {
        kind: approvalKind,
        actorType: 'HUMAN',
        actorId: actor(actorId) ?? 'human',
        headSha: record.analysis?.headSha,
        ...(note ? { note: String(note).slice(0, 500) } : {}),
        createdAt: new Date().toISOString(),
      },
    ]
    const updated = await saveTask(record)
    await appendAudit(roots.stateRoot, 'task.human-approval', { taskId, kind: approvalKind })
    return updated
  }

  // Обзор команды (§29, §47): активные задачи по людям и агентам, пересечения,
  // ожидающие ревью и CI-падения — данные для Team View.

  return { recordDelivery, recordCiEvidence, recordHumanApproval }
}
