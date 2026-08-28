// Definition of Done (§19 плана authority): вычисление блокеров готовности и
// единственный путь в READY_FOR_HUMAN_REVIEW.
//
// Выделен из quality.js: readiness только ЧИТАЕТ факты (evidence, review,
// сигналы, delivery, upstream) и сверяет ревизии — ничего не исполняет.

import { RuntimeError } from './errors.js'
import { appendAudit } from './audit.js'
import { dirtyFiles, revParse } from './gitx.js'
import { requirementRevisions, revisionsMatch, signalFingerprint } from './provenance.js'
import { ACKNOWLEDGEABLE_SIGNALS } from './tasks.js'
import { qualityPolicyOf } from './quality-policy.js'
import { VERIFICATIONS } from './verification-evidence.js'

export const KNOWN_CHECK_STATUS = Object.freeze([
  'PASSED',
  'FAILED',
  'NOT_CONFIGURED',
  'CANCELLED',
  'TIMED_OUT',
  'TIMED_OUT_UNTERMINATED',
])

export function createReadiness({ store, roots, projects, tasks, workspaces, repoIntel }) {
  // Definition of Done: полный список блокеров готовности. Возвращает факты
  // для UI (§49) — никакого «quality score».
  async function readiness(taskId) {
    const task = await tasks.getTask(taskId)
    const project = await projects.get(task.projectId)
    const policy = qualityPolicyOf(project)
    const blockers = []
    const facts = []

    if ((task.acceptanceCriteria ?? []).length === 0) {
      blockers.push({ id: 'NO_CRITERIA', message: 'У задачи нет критериев приёмки.' })
    }

    // Evidence: существует, свежее (тот же HEAD) и получено на чистом дереве.
    const run = task.latestVerificationId
      ? await store.read(VERIFICATIONS, task.latestVerificationId)
      : undefined
    if (!run || run.status !== 'COMPLETED') {
      blockers.push({ id: 'NO_EVIDENCE', message: 'Нет завершённого verification-прогона.' })
    } else {
      let currentHead
      if (task.workspaceId) {
        const workspace = await workspaces.getRecord(task.workspaceId).catch(() => undefined)
        if (workspace) {
          currentHead = await revParse(workspace.path, 'HEAD')
          const dirtyNow = await dirtyFiles(workspace.path)
          if (dirtyNow.length > 0) {
            blockers.push({
              id: 'DIRTY_WORKSPACE',
              message: `В workspace ${String(dirtyNow.length)} незакоммиченных файлов — доказательство относится не к финальному состоянию.`,
            })
          }
        }
      }
      if (run.snapshot?.mode === 'UNCOMMITTED_SNAPSHOT' || run.dirtyAtRun > 0) {
        blockers.push({
          id: 'EVIDENCE_ON_DIRTY_TREE',
          message:
            'Evidence получено в режиме UNCOMMITTED_SNAPSHOT — для готовности прогоните проверки на закоммиченном HEAD.',
        })
      }
      if (currentHead && run.headSha !== currentHead) {
        blockers.push({
          id: 'STALE_EVIDENCE',
          message:
            'После последнего verification появились новые коммиты — прогоните проверки заново.',
        })
      }
      // §14: изменение критериев/скоупа/политики после прогона делает
      // доказательство недействительным — оно отвечало на другой вопрос.
      const currentRevisions = requirementRevisions({
        task,
        project,
        profile: repoIntel
          ? await repoIntel.getProfile(task.projectId).catch(() => undefined)
          : undefined,
      })
      if (!revisionsMatch(run.revisions, currentRevisions)) {
        blockers.push({
          id: 'STALE_EVIDENCE_REVISION',
          message:
            'Постановка задачи или политика изменились после verification — прогоните проверки заново.',
        })
      }
      for (const requiredId of policy.required) {
        if (requiredId === 'review') continue
        const check = run.checks.find((entry) => entry.id === requiredId)
        if (!check || check.status === 'NOT_CONFIGURED') {
          blockers.push({
            id: `CHECK_NOT_CONFIGURED:${requiredId}`,
            message: `Обязательная проверка «${requiredId}» не настроена в политике проекта.`,
          })
        } else if (check.status !== 'PASSED') {
          blockers.push({
            id: `CHECK_FAILED:${requiredId}`,
            message: `Проверка «${requiredId}» в статусе ${check.status}.`,
          })
        }
      }
      facts.push(
        ...run.checks.map((check) => ({ kind: 'check', id: check.id, status: check.status })),
      )
    }

    // Независимое ревью (§14–§16): writer ≠ reviewer гарантирует review.js,
    // здесь проверяются вердикт и незакрытые findings по gate проекта.
    if (policy.required.includes('review')) {
      const review = task.review
      if (!review || review.verdict !== 'APPROVED') {
        blockers.push({
          id: 'REVIEW_MISSING',
          message: review ? 'Ревью не одобрено.' : 'Независимое ревью не выполнялось.',
        })
      } else {
        for (const severity of policy.reviewGate.blocking) {
          const count = review.openBySeverity?.[severity] ?? 0
          if (count > 0) {
            blockers.push({
              id: 'REVIEW_BLOCKED',
              message: `Незакрытых findings уровня ${severity}: ${String(count)}.`,
            })
          }
        }
        if (review.criteriaVerified !== true) {
          blockers.push({
            id: 'CRITERIA_UNVERIFIED',
            message: 'Reviewer не подтвердил критерии приёмки по пунктам.',
          })
        }
        if (review.headSha && run?.headSha && review.headSha !== run.headSha) {
          blockers.push({
            id: 'STALE_REVIEW',
            message: 'Ревью относится к другому коммиту, чем evidence.',
          })
        }
        facts.push({ kind: 'review', verdict: review.verdict, modes: review.modes })
      }
      // Adversarial для high-risk diff (§17).
      if (task.analysis?.highRisk === true && !(task.review?.modes ?? []).includes('adversarial')) {
        blockers.push({
          id: 'ADVERSARIAL_REQUIRED',
          message: 'Изменение затрагивает high-risk область — требуется adversarial review.',
        })
      }
    }

    // Архитектурные gates (§8): FAILED-чек — блокер до устранения; никакое
    // объяснение BLOCK-код не гасит (в отличие от REVIEW-сигналов ниже).
    for (const check of task.analysis?.modularity?.checks ?? []) {
      if (check.status === 'FAILED') {
        // §18: public-api gate закрывается human-approval'ом breaking change
        // на текущем HEAD (пути: удалить изменение / декларировать в плане /
        // policy-классификация — они не доводят до FAILED вовсе).
        if (check.id === 'public-api') {
          const approval = (task.humanApprovals ?? []).find((entry) => entry.kind === 'PUBLIC_API')
          const currentHead = task.analysis?.headSha
          if (approval && (!currentHead || approval.headSha === currentHead)) {
            facts.push({ kind: 'architecture', id: check.id, status: 'APPROVED_BY_HUMAN' })
            continue
          }
        }
        const codes = (check.findings ?? []).map((finding) => finding.code).join(', ')
        blockers.push({
          id: `ARCH:${check.id}`,
          message: `Архитектурный gate «${check.id}» не пройден: ${codes}. Устраните — объяснением это не закрывается.`,
        })
      }
      facts.push({ kind: 'architecture', id: check.id, status: check.status })
    }

    // Сигналы diff-анализа: каждый либо отсутствует, либо объяснён — причём
    // объяснение действительно только для ТЕКУЩЕГО отпечатка сигнала (§15):
    // новое ослабление тестов не прикрывается старой отпиской.
    const signals = task.analysis?.signals ?? []
    const ackBySignal = new Map((task.acknowledgments ?? []).map((entry) => [entry.signal, entry]))
    for (const kind of new Set(signals.map((entry) => entry.kind))) {
      if (!ACKNOWLEDGEABLE_SIGNALS.includes(kind)) continue
      const ack = ackBySignal.get(kind)
      const currentFingerprint = signalFingerprint(
        kind,
        signals
          .filter((entry) => entry.kind === kind)
          .map((entry) => entry.fingerprint)
          .sort(),
      )
      if (!ack) {
        blockers.push({
          id: `SIGNAL_UNACKNOWLEDGED:${kind}`,
          message: `Сигнал ${kind} не объяснён и не устранён.`,
        })
      } else if (ack.fingerprint !== currentFingerprint) {
        blockers.push({
          id: `SIGNAL_ACK_STALE:${kind}`,
          message: `Объяснение сигнала ${kind} относится к другому содержимому — сигнал изменился, объяснитесь заново.`,
        })
      }
    }

    // Upstream (§23–§25): релевантный сдвиг цели требует явного решения,
    // привязанного к КОНКРЕТНОМУ targetSha — новый сдвиг требует нового.
    if (task.upstream?.status === 'UPSTREAM_RELEVANT') {
      const ack = ackBySignal.get('UPSTREAM_RELEVANT')
      if (!ack || ack.targetSha !== task.upstream.targetSha) {
        blockers.push({
          id: 'UPSTREAM_RELEVANT',
          message: `Цель ушла вперёд и затронула связанные файлы (${String(task.upstream.behind)} коммитов) — обновите базу или объясните, почему это безопасно.`,
        })
      }
    }

    // Delivery-gates (§31–§32): PR-доставка и доверенное CI, привязанное к
    // ТЕКУЩЕМУ HEAD; CODEOWNERS-область требует человеческого approve (§30).
    const currentHeadForDelivery = task.analysis?.headSha
    if (
      policy.delivery.requirePullRequest &&
      !(task.delivery?.mode === 'PR' && task.delivery?.prNumber)
    ) {
      blockers.push({
        id: 'DELIVERY_PR_REQUIRED',
        message: 'Политика проекта требует доставку через Pull Request.',
      })
    }
    if (policy.delivery.requirePushedBranch && task.delivery?.branchPushed !== true) {
      blockers.push({
        id: 'DELIVERY_PUSH_REQUIRED',
        message: 'Ветка задачи не отмечена как отправленная (branchPushed).',
      })
    }
    if (policy.delivery.requireCI) {
      const ci = task.delivery?.ci
      if (!ci || ci.conclusion !== 'success') {
        blockers.push({
          id: 'CI_EVIDENCE_REQUIRED',
          message: 'Нет успешного CI-evidence от доверенной интеграции.',
        })
      } else if (currentHeadForDelivery && ci.commitSha !== currentHeadForDelivery) {
        blockers.push({
          id: 'CI_EVIDENCE_STALE',
          message: 'CI-evidence относится к предыдущему коммиту — дождитесь CI на текущем HEAD.',
        })
      }
    }
    if (policy.delivery.requireCodeOwners) {
      const affectedOwners = task.analysis?.affectedOwners ?? []
      if (affectedOwners.length > 0) {
        const approval = (task.humanApprovals ?? []).find((entry) => entry.kind === 'CODEOWNERS')
        if (!approval || (currentHeadForDelivery && approval.headSha !== currentHeadForDelivery)) {
          blockers.push({
            id: 'CODEOWNERS_REVIEW_REQUIRED',
            message: `Изменение задевает области владельцев (${affectedOwners.join(', ')}) — требуется human-approval на текущем HEAD; AI-reviewer обязательного человека не заменяет.`,
          })
        }
      }
    }

    // Regression-first для bugfix (§18).
    if (task.kind === 'bugfix') {
      const regression = task.regression
      if (
        !regression ||
        (regression.status !== 'PROVEN' && regression.status !== 'MANUAL_REPRO_ONLY')
      ) {
        blockers.push({
          id: 'REGRESSION_REQUIRED',
          message:
            'Bugfix требует regression-доказательства (проваленный → прошедший прогон) или явного MANUAL_REPRO_ONLY.',
        })
      }
    }

    // Authority-факты (§27): кто что подтвердил — без сырых capabilities.
    facts.push({
      kind: 'authority',
      reviewerIndependent: Boolean(task.review && task.review.verdict === 'APPROVED'),
      humanApprovals: (task.humanApprovals ?? []).map(entry => entry.kind),
      ciVerifiedBy: task.delivery?.ci?.verifiedBy,
      overlapDecision: task.overlapDecision?.decision,
    })
    return { taskId, ready: blockers.length === 0, blockers, facts, status: task.status }
  }

  // Единственный путь в READY_FOR_HUMAN_REVIEW.
  async function promoteIfReady(taskId) {
    const verdict = await readiness(taskId)
    if (!verdict.ready) {
      throw new RuntimeError(
        'READINESS_REQUIRED',
        'Definition of Done не выполнена — см. blockers.',
        { taskId, blockers: verdict.blockers },
      )
    }
    const task = await tasks.getTask(taskId)
    const promoted = await tasks.saveTask({ ...task, status: 'READY_FOR_HUMAN_REVIEW' })
    await appendAudit(roots.stateRoot, 'task.promoted', { taskId })
    return promoted
  }

  return { readiness, promoteIfReady }
}
