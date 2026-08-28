// Quality Policy: нормализация, валидация и смена политики проекта.
//
// Выделено из quality.js (§19 плана authority): политика — отдельная
// ответственность со своим авторитетом (HUMAN_ADMIN) и провенансом
// (revision/approvedBy). Ничего про прогоны, снапшоты и readiness.

import { RuntimeError } from './errors.js'
import { appendAudit } from './audit.js'
import { assertCommandArgv } from './repo-intel.js'

const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60_000

export const DEFAULT_REVIEW_GATE = Object.freeze({ blocking: ['BLOCKER', 'HIGH'] })

// Политика по умолчанию: требуем тесты и независимое ревью. Меньшего
// Definition of Done для AI-написанного кода не существует.
const DEFAULT_REQUIRED = Object.freeze(['tests', 'review'])

// Нормализованная политика проекта. Не привязана к npm: checks — любые
// argv-команды любого стека.
export function qualityPolicyOf(project) {
  const raw = project.qualityPolicy ?? {}
  const checks = {}
  for (const [id, check] of Object.entries(raw.checks ?? {})) {
    if (Array.isArray(check?.argv)) {
      checks[id] = {
        argv: check.argv,
        timeoutMs:
          Number.isInteger(check.timeoutMs) && check.timeoutMs > 0
            ? check.timeoutMs
            : DEFAULT_CHECK_TIMEOUT_MS,
      }
    }
  }
  return {
    required:
      Array.isArray(raw.required) && raw.required.length > 0
        ? raw.required.map(String)
        : [...DEFAULT_REQUIRED],
    checks,
    verification: {
      allowedSecrets: Array.isArray(raw.verification?.allowedSecrets)
        ? raw.verification.allowedSecrets
            .map(String)
            .filter((name) => /^[A-Z][A-Z0-9_]{1,60}$/.test(name))
            .slice(0, 20)
        : [],
      allowUncommitted: raw.verification?.allowUncommitted === true,
      allowParallel: raw.verification?.allowParallel === true,
    },
    reviewGate: {
      blocking:
        Array.isArray(raw.reviewGate?.blocking) && raw.reviewGate.blocking.length > 0
          ? raw.reviewGate.blocking.map(String)
          : [...DEFAULT_REVIEW_GATE.blocking],
    },
    team: {
      mode: ['solo', 'best-effort', 'strict'].includes(raw.team?.mode)
        ? raw.team.mode
        : 'best-effort',
    },
    delivery: {
      requirePullRequest: raw.delivery?.requirePullRequest === true,
      requirePushedBranch: raw.delivery?.requirePushedBranch === true,
      requireCI: raw.delivery?.requireCI === true,
      requireCodeOwners: raw.delivery?.requireCodeOwners === true,
    },
    protectedAreas: Array.isArray(raw.protectedAreas) ? raw.protectedAreas.map(String) : [],
    highRiskAreas: Array.isArray(raw.highRiskAreas) ? raw.highRiskAreas.map(String) : [],
    generatedFiles: Array.isArray(raw.generatedFiles) ? raw.generatedFiles.map(String) : [],
  }
}

export function createPolicyManager({ store, roots, projects }) {
  // Политика меняется ТОЛЬКО человеком (§8): writer не ослабляет собственный
  // Definition of Done. verifiedAdmin приходит от слоя, расходовавшего
  // HUMAN_ADMIN-capability; сама модель флагам из body не верит.
  async function setPolicy(projectId, policy, { verifiedAdmin } = {}) {
    const project = await projects.get(projectId)
    if (!verifiedAdmin || typeof verifiedAdmin.actorId !== 'string') {
      throw new RuntimeError(
        'CAPABILITY_REQUIRED',
        'Изменение Quality/Architecture Policy требует HUMAN_ADMIN capability из интерактивного канала.',
        { projectId },
      )
    }
    if (!policy || typeof policy !== 'object')
      throw new RuntimeError('INVALID_INPUT', 'Ожидалась политика качества.')
    const checks = {}
    for (const [id, check] of Object.entries(policy.checks ?? {})) {
      if (typeof id !== 'string' || id === '' || id.length > 60) {
        throw new RuntimeError(
          'INVALID_INPUT',
          'Идентификатор проверки — непустая строка до 60 символов.',
        )
      }
      checks[id] = {
        argv: assertCommandArgv(check?.argv),
        ...(Number.isInteger(check?.timeoutMs) && check.timeoutMs > 0
          ? { timeoutMs: Math.min(check.timeoutMs, 60 * 60_000) }
          : {}),
      }
    }
    const required = Array.isArray(policy.required)
      ? policy.required.map(String).slice(0, 20)
      : undefined
    const record = {
      ...project,
      qualityPolicy: {
        ...(required ? { required } : {}),
        checks,
        ...(policy.team ? { team: policy.team } : {}),
        ...(policy.delivery ? { delivery: policy.delivery } : {}),
        ...(policy.verification ? { verification: policy.verification } : {}),
        ...(policy.architecture ? { architecture: policy.architecture } : {}),
        ...(policy.reviewGate
          ? { reviewGate: { blocking: (policy.reviewGate.blocking ?? []).map(String).slice(0, 5) } }
          : {}),
        ...(Array.isArray(policy.protectedAreas)
          ? { protectedAreas: policy.protectedAreas.map(String).slice(0, 50) }
          : {}),
        ...(Array.isArray(policy.highRiskAreas)
          ? { highRiskAreas: policy.highRiskAreas.map(String).slice(0, 50) }
          : {}),
        ...(Array.isArray(policy.generatedFiles)
          ? { generatedFiles: policy.generatedFiles.map(String).slice(0, 50) }
          : {}),
      },
    }
    // Ревизия и провенанс политики (§8): кто и когда одобрил; секретов нет.
    record.qualityPolicyRevision = (project.qualityPolicyRevision ?? 0) + 1
    record.qualityPolicyApprovedBy = verifiedAdmin.actorId.slice(0, 100)
    record.qualityPolicyApprovedAt = new Date().toISOString()
    await store.write('projects', projectId, record)
    await appendAudit(roots.stateRoot, 'quality.policy.set', {
      projectId,
      revision: record.qualityPolicyRevision,
      approvedBy: record.qualityPolicyApprovedBy,
      checks: Object.keys(checks).length,
    })
    return qualityPolicyOf(record)
  }

  return { setPolicy }
}
