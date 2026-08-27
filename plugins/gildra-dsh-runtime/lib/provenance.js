// Ревизии требований (§14 плана модульности): стабильные отпечатки того, ЧТО
// проверялось. Evidence и review без этих отпечатков — «одобрение вообще»:
// меняешь критерии после ревью, и старое одобрение продолжает считаться.
// Ответственность модуля узкая: канонические хэши spec/policy/сигналов —
// никакой логики readiness, store или git.

import { createHash } from 'node:crypto'

// Канонический JSON: ключи объектов сортируются на всех уровнях, поэтому
// одинаковые по смыслу структуры дают одинаковый отпечаток.
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalize(value[key])
    }
    return out
  }
  return value
}

export function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex').slice(0, 16)
}

// Отпечаток постановки задачи: всё, что определяет «что считается сделанным»,
// включая Module Change Plan (§9) — смена плана меняет контракт работы.
export function taskSpecHash(task) {
  return stableHash({
    title: task.title,
    kind: task.kind,
    acceptanceCriteria: task.acceptanceCriteria ?? [],
    expectedAreas: task.expectedAreas ?? [],
    modulePlan: task.modulePlan
      ? {
        modulesToChange: task.modulePlan.modulesToChange ?? [],
        newModules: task.modulePlan.newModules ?? [],
        publicContractsChanged: task.modulePlan.publicContractsChanged ?? [],
        dependenciesAdded: task.modulePlan.dependenciesAdded ?? [],
        testsRequired: task.modulePlan.testsRequired ?? [],
        risks: task.modulePlan.risks ?? [],
      }
      : null,
  })
}

export function claimsHash(task) {
  return stableHash(task.claims ?? [])
}

export function overlapDecisionHash(task) {
  return stableHash(task.overlapDecision
    ? { decision: task.overlapDecision.decision, fingerprint: task.overlapDecision.overlapFingerprint ?? null }
    : null)
}

export function qualityPolicyHash(project) {
  const raw = project.qualityPolicy ?? {}
  // Архитектурная секция хэшируется отдельно — у неё свой жизненный цикл.
  const { architecture, ...rest } = raw
  void architecture
  return stableHash(rest)
}

export function architectureHash(project) {
  return stableHash(project.qualityPolicy?.architecture ?? null)
}

// Отпечаток одного сигнала анализа: kind + его детали. Acknowledgment,
// сделанный для другого содержимого сигнала, недействителен (§15).
export function signalFingerprint(kind, detail) {
  return stableHash({ kind, detail: detail ?? null })
}

// Сводный отпечаток набора сигналов конкретного анализа.
export function analysisHash(signals) {
  return stableHash((signals ?? []).map(signal => signalFingerprint(signal.kind, signal.detail)).sort())
}

// Ревизии, к которым привязываются evidence и review (§9): смена ЛЮБОГО
// значимого контракта — постановки, плана, claims, решения по пересечению,
// политики (включая delivery и определения команд), базы, профиля или
// CODEOWNERS — делает старое доказательство ответом на другой вопрос.
export function requirementRevisions({ task, project, profile }) {
  return {
    taskSpecHash: taskSpecHash(task),
    claimsHash: claimsHash(task),
    overlapDecisionHash: overlapDecisionHash(task),
    baseSha: task.baseSha ?? null,
    qualityPolicyHash: qualityPolicyHash(project),
    architecturePolicyHash: architectureHash(project),
    deliveryPolicyHash: stableHash(project.qualityPolicy?.delivery ?? null),
    commandDefinitionsHash: stableHash({
      checks: Object.fromEntries(Object.entries(project.qualityPolicy?.checks ?? {}).map(([id, check]) => [id, check?.argv ?? null])),
      approved: (project.approvedCommands ?? []).map(entry => entry.definitionHash ?? null).sort(),
    }),
    ...(profile?.commit ? { repositoryProfileRevision: profile.commit } : {}),
    codeownersRevision: stableHash(profile?.owners?.rules ?? null),
  }
}

const REQUIRED_REVISION_FIELDS = Object.freeze([
  'taskSpecHash', 'claimsHash', 'overlapDecisionHash', 'baseSha',
  'qualityPolicyHash', 'architecturePolicyHash', 'deliveryPolicyHash',
  'commandDefinitionsHash', 'codeownersRevision',
])

export function revisionsMatch(a, b) {
  if (!a || !b) return false
  // Все обязательные ревизии сравниваются ПО-НАСТОЯЩЕМУ (§9): отсутствие
  // поля в старой записи — тоже несоответствие, а не «совпало по умолчанию».
  return REQUIRED_REVISION_FIELDS.every(field => a[field] !== undefined && a[field] === b[field])
}
