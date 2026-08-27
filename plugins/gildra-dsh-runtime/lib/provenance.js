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

// Отпечаток постановки задачи: всё, что определяет «что считается сделанным».
export function taskSpecHash(task) {
  return stableHash({
    title: task.title,
    kind: task.kind,
    acceptanceCriteria: task.acceptanceCriteria ?? [],
    expectedAreas: task.expectedAreas ?? [],
  })
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

// Ревизии, к которым привязываются evidence и review.
export function requirementRevisions({ task, project, profileCommit }) {
  return {
    taskSpecHash: taskSpecHash(task),
    qualityPolicyHash: qualityPolicyHash(project),
    architecturePolicyHash: architectureHash(project),
    ...(profileCommit ? { repositoryProfileRevision: profileCommit } : {}),
  }
}

export function revisionsMatch(a, b) {
  if (!a || !b) return false
  return a.taskSpecHash === b.taskSpecHash
    && a.qualityPolicyHash === b.qualityPolicyHash
    && a.architecturePolicyHash === b.architecturePolicyHash
}
