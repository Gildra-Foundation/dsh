// Независимое структурное ревью (§14–§17 плана AI-качества).
//
// Writer никогда не финальный судья своей работы: reviewer — другой агент
// (WRITER_REVIEWER_CONFLICT проверяется здесь), работающий в отдельном
// read-контексте. Результат — машинно-структурированные findings с severity и
// категорией; вердикт обязан быть КОНСИСТЕНТНЫМ с findings (APPROVED при
// открытом BLOCKER невозможен — «одобрено, но всё сломано» не бывает).
// Reviewer получает компактный пакет: задачу, критерии, policy, статистику
// diff, evidence и сигналы анализа — но НЕ историю рассуждений writer'а.

import { createHash, timingSafeEqual } from 'node:crypto'

import { RuntimeError } from './errors.js'
import { assertId, generateId, generateOwnerToken } from './ids.js'
import { appendAudit } from './audit.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import { qualityPolicyOf } from './quality.js'
import { analyzeTaskDiff } from './diff-analyzer.js'
import { analyzeModularity } from './modularity.js'
import { git } from './gitx.js'

const REVIEWS = 'reviews'

// Capability ревьюера (§13): подтверждение личности — секрет, выданный при
// request, а не строка с именем. В store лежит только ХЭШ: чтение state не
// раскрывает capability, сравнение — константное по времени.
function capabilityHash(capability) {
  return createHash('sha256').update(String(capability)).digest('hex')
}

function capabilityMatches(capability, storedHash) {
  if (typeof capability !== 'string' || typeof storedHash !== 'string') return false
  const given = Buffer.from(capabilityHash(capability), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  return given.length === stored.length && timingSafeEqual(given, stored)
}

export const SEVERITIES = Object.freeze(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'NIT'])
export const CATEGORIES = Object.freeze([
  'CORRECTNESS', 'SECURITY', 'CONCURRENCY', 'DATA_LOSS', 'ARCHITECTURE',
  'BACKWARD_COMPATIBILITY', 'PERFORMANCE', 'TESTING', 'MAINTAINABILITY',
])
export const REVIEW_MODES = Object.freeze(['standard', 'adversarial', 'security', 'concurrency', 'performance', 'architecture'])

const MAX_FINDINGS = 100

function validateFindings(raw) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new RuntimeError('INVALID_INPUT', 'findings должен быть массивом.')
  if (raw.length > MAX_FINDINGS) throw new RuntimeError('LIMIT_EXCEEDED', `Слишком много findings (максимум ${String(MAX_FINDINGS)}).`)
  return raw.map((finding, index) => {
    if (!SEVERITIES.includes(finding?.severity)) {
      throw new RuntimeError('INVALID_INPUT', `finding[${String(index)}]: недопустимый severity.`, { allowed: SEVERITIES })
    }
    if (!CATEGORIES.includes(finding?.category)) {
      throw new RuntimeError('INVALID_INPUT', `finding[${String(index)}]: недопустимая категория.`, { allowed: CATEGORIES })
    }
    if (typeof finding.message !== 'string' || finding.message.trim().length < 10) {
      throw new RuntimeError('INVALID_INPUT', `finding[${String(index)}]: message обязан быть содержательным.`)
    }
    return {
      severity: finding.severity,
      category: finding.category,
      file: typeof finding.file === 'string' ? finding.file.slice(0, 300) : undefined,
      line: Number.isInteger(finding.line) && finding.line > 0 ? finding.line : undefined,
      message: finding.message.trim().slice(0, 1000),
      evidence: typeof finding.evidence === 'string' ? finding.evidence.slice(0, 1000) : undefined,
      status: 'OPEN',
    }
  })
}

export function createReviewManager({ store, roots, projects, tasks, workspaces, repoIntel }) {
  async function getReview(reviewId) {
    const record = await store.read(REVIEWS, assertId(reviewId, 'reviewId'))
    if (!record) throw new RuntimeError('REVIEW_NOT_FOUND', `Ревью «${reviewId}» не найдено.`, { reviewId })
    return record
  }

  // Дерево репозитория на конкретном SHA: files + ленивое чтение.
  async function treeAt(workspacePath, sha) {
    const { stdout } = await git(['-C', workspacePath, 'ls-tree', '-r', '--name-only', sha])
    const files = stdout.split('\n').filter(Boolean)
    const cache = new Map()
    const read = async path => {
      if (cache.has(path)) return cache.get(path)
      const shown = await git(['-C', workspacePath, 'show', `${sha}:${path}`], { allowFailure: true })
      const value = shown.failed ? undefined : shown.stdout
      cache.set(path, value)
      return value
    }
    return { files, read }
  }

  // Diff-анализ задачи: считается здесь, потому что его потребители — пакет
  // reviewer'а и сигналы readiness. Результат сохраняется на задаче.
  async function analyzeTask(taskId) {
    const task = await tasks.getTask(taskId)
    if (!task.workspaceId) throw new RuntimeError('INVALID_INPUT', 'У задачи нет workspace — анализировать нечего.', { taskId })
    const workspace = await workspaces.getRecord(task.workspaceId)
    const project = await projects.get(task.projectId)
    const policy = qualityPolicyOf(project)
    const profile = repoIntel ? await repoIntel.getProfile(task.projectId).catch(() => undefined) : undefined
    const analysis = await analyzeTaskDiff({
      workspacePath: workspace.path,
      baseSha: task.baseSha ?? workspace.baseSha,
      task,
      policy,
      profile,
    })
    // Modularity Analyzer (§7–§8): граф «до/после», сигналы и архитектурные
    // gates. Сигналы вливаются в общий список — REVIEW-коды гасятся
    // acknowledgment'ом, BLOCK-коды блокируют readiness до устранения.
    const before = await treeAt(workspace.path, analysis.baseSha)
    const after = await treeAt(workspace.path, 'HEAD')
    const modularity = await analyzeModularity({
      filesBefore: before.files,
      readBefore: before.read,
      filesAfter: after.files,
      readAfter: after.read,
      changedFiles: analysis.files.map(file => file.path),
      addedByFile: analysis.addedByFile,
      architecture: project.qualityPolicy?.architecture,
      modulePlan: task.modulePlan,
      analysisTruncated: analysis.truncated === true,
    })
    analysis.modularity = modularity
    for (const signal of modularity.signals) {
      analysis.signals.push({ kind: signal.code, detail: signal.detail })
    }
    // На задаче — компактная сводка; полные списки строк не тянем.
    const summary = {
      baseSha: analysis.baseSha,
      headSha: analysis.headSha,
      filesChanged: analysis.filesChanged,
      insertions: analysis.insertions,
      deletions: analysis.deletions,
      signals: analysis.signals.map(signal => ({ kind: signal.kind })),
      highRisk: analysis.highRisk,
      unexpectedFiles: analysis.scope.unexpectedFiles.slice(0, 20),
      dangerous: analysis.dangerous.slice(0, 20),
      importsOfChanged: analysis.importsOfChanged,
      changedFiles: analysis.files.slice(0, 100).map(file => file.path),
      modularity: {
        checks: analysis.modularity?.checks ?? [],
        changedModules: analysis.modularity?.changedModules ?? [],
        preexisting: (analysis.modularity?.preexisting ?? []).length,
      },
      analyzedAt: analysis.analyzedAt,
    }
    await tasks.saveTask({ ...(await tasks.getTask(taskId)), analysis: summary })
    await appendAudit(roots.stateRoot, 'task.analyzed', { taskId, filesChanged: analysis.filesChanged, signals: analysis.signals.length })
    return analysis
  }

  // Пакет reviewer'а (§14): всё нужное для суждения, ничего из внутренней
  // кухни writer'а.
  async function buildReviewPacket(task, analysis) {
    const project = await projects.get(task.projectId)
    const policy = qualityPolicyOf(project)
    const run = task.latestVerificationId ? await store.read('verifications', task.latestVerificationId) : undefined
    return {
      task: { taskId: task.taskId, title: task.title, kind: task.kind },
      acceptanceCriteria: task.acceptanceCriteria ?? [],
      expectedAreas: task.expectedAreas ?? [],
      reviewGate: policy.reviewGate,
      diff: analysis
        ? {
          filesChanged: analysis.filesChanged,
          insertions: analysis.insertions,
          deletions: analysis.deletions,
          signals: analysis.signals,
          highRisk: analysis.highRisk,
          unexpectedFiles: analysis.unexpectedFiles ?? analysis.scope?.unexpectedFiles ?? [],
        }
        : undefined,
      evidence: run
        ? { runId: run.runId, headSha: run.headSha, checks: run.checks.map(check => ({ id: check.id, status: check.status })) }
        : undefined,
      baseSha: task.baseSha,
      branch: task.branch,
    }
  }

  // Запрос ревью. Главный guard слоя: reviewer ≠ writer (§14, §74).
  async function requestReview(taskId, { reviewerAgent, reviewerSessionId, mode = 'standard' }) {
    const task = await tasks.getTask(taskId)
    const reviewer = typeof reviewerAgent === 'string' ? reviewerAgent.trim() : ''
    if (reviewer === '' || reviewer.length > 100) {
      throw new RuntimeError('INVALID_INPUT', 'Укажите reviewerAgent.')
    }
    if (!REVIEW_MODES.includes(mode)) {
      throw new RuntimeError('INVALID_INPUT', `Недопустимый режим ревью «${String(mode)}».`, { allowed: REVIEW_MODES })
    }
    if (task.writerAgent && reviewer === task.writerAgent) {
      throw new RuntimeError('WRITER_REVIEWER_CONFLICT', 'Writer не может быть собственным reviewer: назначьте независимого агента.', {
        taskId, writerAgent: task.writerAgent,
      })
    }
    // Свежий анализ diff — часть пакета: reviewer судит по фактам.
    const analysis = task.workspaceId ? await analyzeTask(taskId) : undefined
    const reviewId = generateId('review')
    // Capability выдаётся ровно один раз — в ответе request. Подделать
    // submit, зная только имя ревьюера, невозможно.
    const reviewerCapability = generateOwnerToken()
    const record = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      reviewId,
      taskId,
      projectId: task.projectId,
      reviewerAgent: reviewer,
      reviewerSessionId: typeof reviewerSessionId === 'string' ? reviewerSessionId.slice(0, 100) : undefined,
      writerAgent: task.writerAgent,
      writerSessionId: task.workspaceId ? (await workspaces.getRecord(task.workspaceId).catch(() => undefined))?.sessionId : undefined,
      capabilityHash: capabilityHash(reviewerCapability),
      mode,
      status: 'REQUESTED',
      headSha: analysis?.headSha,
      createdAt: new Date().toISOString(),
    }
    await store.write(REVIEWS, reviewId, record)
    const withReviewer = await tasks.getTask(taskId)
    await tasks.saveTask({
      ...withReviewer,
      reviewerAgent: reviewer,
      reviews: [...new Set([...(withReviewer.reviews ?? []), reviewId])],
      // Запрос ревью — это заявление «реализация готова к суждению»: задача
      // переходит в REVIEWING из любого рабочего статуса, включая повторный
      // круг после FIXING_REVIEW.
      ...(['PLANNED', 'IMPLEMENTING', 'VERIFYING', 'FIXING_REVIEW'].includes(withReviewer.status) ? { status: 'REVIEWING' } : {}),
    })
    await appendAudit(roots.stateRoot, 'review.requested', { taskId, reviewId, mode, reviewerAgent: reviewer })
    // Хэш наружу не отдаём; capability — единственный раз, здесь.
    const { capabilityHash: storedHash, ...visible } = record
    void storedHash
    return { review: visible, reviewerCapability, packet: await buildReviewPacket(await tasks.getTask(taskId), analysis) }
  }

  // Агрегация ревью на задаче: по каждому режиму берётся ПОСЛЕДНЕЕ
  // завершённое; APPROVED в режиме засчитывается только на актуальном
  // headSha задачи.
  async function refreshTaskReviewSummary(taskId) {
    const task = await tasks.getTask(taskId)
    const rows = []
    for (const id of task.reviews ?? []) {
      const row = await store.read(REVIEWS, id)
      if (row && row.status === 'SUBMITTED') rows.push(row)
    }
    if (rows.length === 0) return undefined
    const latestByMode = new Map()
    for (const row of rows.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))) {
      latestByMode.set(row.mode, row)
    }
    const currentHead = task.analysis?.headSha
    const standard = latestByMode.get('standard')
    const openBySeverity = {}
    for (const row of latestByMode.values()) {
      if (currentHead && row.headSha !== currentHead) continue
      for (const finding of row.findings ?? []) {
        if (finding.status !== 'OPEN') continue
        openBySeverity[finding.severity] = (openBySeverity[finding.severity] ?? 0) + 1
      }
    }
    const summary = {
      reviewId: standard?.reviewId ?? rows.at(-1).reviewId,
      verdict: standard && (!currentHead || standard.headSha === currentHead) ? standard.verdict : 'STALE',
      openBySeverity,
      criteriaVerified: standard?.criteriaVerified === true && (!currentHead || standard.headSha === currentHead),
      headSha: standard?.headSha,
      modes: [...latestByMode.values()]
        .filter(row => row.verdict === 'APPROVED' && (!currentHead || row.headSha === currentHead))
        .map(row => row.mode),
    }
    await tasks.saveTask({ ...(await tasks.getTask(taskId)), review: summary })
    return summary
  }

  async function submitReview(reviewId, { capability, findings, criteriaVerdicts, verdict, summary }) {
    const review = await getReview(reviewId)
    if (review.status === 'SUBMITTED') {
      throw new RuntimeError('INVALID_INPUT', 'Это ревью уже отправлено: запросите новое для повторной проверки.', { reviewId })
    }
    // §13: принять вердикт может только держатель capability ЭТОГО request.
    // Имя ревьюера — метка для людей, а не доказательство.
    if (!capabilityMatches(capability, review.capabilityHash)) {
      throw new RuntimeError('WRITER_REVIEWER_CONFLICT', 'Вердикт принимается только с capability этого review request — имя ревьюера не является подтверждением личности.', { reviewId })
    }
    const task = await tasks.getTask(review.taskId)
    const project = await projects.get(task.projectId)
    const policy = qualityPolicyOf(project)
    if (!['APPROVED', 'CHANGES_REQUESTED'].includes(verdict)) {
      throw new RuntimeError('INVALID_INPUT', 'verdict: APPROVED или CHANGES_REQUESTED.')
    }
    const validated = validateFindings(findings)
    // Консистентность (§16): APPROVED с открытым блокирующим finding — ложь.
    const blockingOpen = validated.filter(finding => policy.reviewGate.blocking.includes(finding.severity))
    if (verdict === 'APPROVED' && blockingOpen.length > 0) {
      throw new RuntimeError('INVALID_INPUT', `APPROVED невозможен: есть ${String(blockingOpen.length)} findings блокирующей серьёзности (${policy.reviewGate.blocking.join('/')}).`, {
        blocking: blockingOpen.map(finding => finding.severity),
      })
    }
    // Критерии приёмки проверяются ПО ПУНКТАМ (§8): вердикт по каждому.
    const criteria = task.acceptanceCriteria ?? []
    let criteriaVerified = false
    let normalizedVerdicts
    if (criteria.length > 0) {
      if (!Array.isArray(criteriaVerdicts) || criteriaVerdicts.length !== criteria.length) {
        throw new RuntimeError('INVALID_INPUT', `Нужен вердикт по каждому из ${String(criteria.length)} критериев приёмки.`, { criteria })
      }
      normalizedVerdicts = criteriaVerdicts.map((entry, index) => ({
        criterion: criteria[index],
        met: entry?.met === true,
        note: typeof entry?.note === 'string' ? entry.note.slice(0, 500) : undefined,
      }))
      criteriaVerified = normalizedVerdicts.every(entry => entry.met)
      if (verdict === 'APPROVED' && !criteriaVerified) {
        throw new RuntimeError('INVALID_INPUT', 'APPROVED невозможен: не все критерии приёмки подтверждены.', {
          unmet: normalizedVerdicts.filter(entry => !entry.met).map(entry => entry.criterion),
        })
      }
    }
    const submitted = {
      ...review,
      status: 'SUBMITTED',
      verdict,
      findings: validated,
      criteriaVerdicts: normalizedVerdicts,
      criteriaVerified,
      summary: typeof summary === 'string' ? summary.slice(0, 2000) : undefined,
      submittedAt: new Date().toISOString(),
    }
    await store.write(REVIEWS, reviewId, submitted)
    await refreshTaskReviewSummary(review.taskId)
    // CHANGES_REQUESTED возвращает задачу writer'у (§14).
    if (verdict === 'CHANGES_REQUESTED') {
      const current = await tasks.getTask(review.taskId)
      if (current.status === 'REVIEWING') await tasks.saveTask({ ...current, status: 'FIXING_REVIEW' })
    }
    await appendAudit(roots.stateRoot, 'review.submitted', {
      taskId: review.taskId, reviewId, verdict,
      findings: validated.length,
      blockers: validated.filter(finding => finding.severity === 'BLOCKER').length,
      high: validated.filter(finding => finding.severity === 'HIGH').length,
    })
    return submitted
  }

  // Закрыть finding может только reviewer этого ревью (writer чинит и просит
  // re-review; сам себе он findings не закрывает).
  async function resolveFinding(reviewId, { capability, resolution, index }) {
    const review = await getReview(reviewId)
    if (!capabilityMatches(capability, review.capabilityHash)) {
      throw new RuntimeError('WRITER_REVIEWER_CONFLICT', 'Закрыть finding может только держатель capability этого ревью.', { reviewId })
    }
    const findings = [...(review.findings ?? [])]
    if (!Number.isInteger(index) || index < 0 || index >= findings.length) {
      throw new RuntimeError('INVALID_INPUT', 'Некорректный индекс finding.', { index })
    }
    if (typeof resolution !== 'string' || resolution.trim().length < 5) {
      throw new RuntimeError('INVALID_INPUT', 'Укажите, чем закрыт finding.')
    }
    findings[index] = { ...findings[index], status: 'RESOLVED', resolution: resolution.trim().slice(0, 500) }
    const updated = { ...review, findings }
    await store.write(REVIEWS, reviewId, updated)
    await refreshTaskReviewSummary(review.taskId)
    return updated
  }

  return { requestReview, submitReview, resolveFinding, getReview, analyzeTask, refreshTaskReviewSummary, buildReviewPacket }
}
