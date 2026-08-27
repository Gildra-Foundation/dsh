// Quality Pipeline: политика проверок, Verification Evidence и Definition of
// Done (docs/ai-quality.md §5–§7, §18, §66–§69).
//
// Три принципа:
//   1. «Готово» — вычислимый факт. READY_FOR_HUMAN_REVIEW ставит только
//      promoteIfReady после проверки ВСЕЙ Definition of Done; ни одного пути
//      в обход нет (transition это запрещает на уровне tasks.js).
//   2. Evidence протухает: доказательство привязано к headSha и чистоте
//      дерева. Новый коммит — новый прогон; «тесты проходили вчера» — не факт.
//   3. Ненастроенная проверка — NOT_CONFIGURED, а не PASSED: отсутствие
//      линтера в проекте видно честно, но required-проверка без команды
//      блокирует готовность.
//
// Verification-команды берутся ТОЛЬКО из trusted-источников (policy проекта /
// одобренные discovered) и выполняются существующим Process Manager: та же
// регистрация, лимиты, terminate и никакого shell.

import { createHash } from 'node:crypto'
import { mkdir, open, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { RuntimeError } from './errors.js'
import { assertId, generateId } from './ids.js'
import { appendAudit } from './audit.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import { assertCommandArgv } from './repo-intel.js'
import { dirtyFiles, git, revParse } from './gitx.js'
import { ACKNOWLEDGEABLE_SIGNALS } from './tasks.js'
import { requirementRevisions, revisionsMatch, signalFingerprint } from './provenance.js'

const VERIFICATIONS = 'verifications'

// Sanitized-окружение верификации (§18): repository-код НЕ получает весь
// process.env Runtime. Базовый allowlist + платформенный минимум Windows
// (без SystemRoot/ComSpec там не стартует ни один процесс) + секреты,
// ЯВНО разрешённые политикой проекта. Секреты не пишутся в audit/evidence,
// а их значения редактируются из хвостов логов.
const ENV_ALLOWLIST = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'CI',
  // Windows-минимум: без него не запускается даже node.
  'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec', 'PATHEXT', 'WINDIR', 'SYSTEMDRIVE',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'NUMBER_OF_PROCESSORS', 'OS',
])

export function buildVerificationEnv({ baseEnv = process.env, allowedSecrets = [], taskId, workspaceId, runId }) {
  const env = {}
  for (const name of ENV_ALLOWLIST) {
    if (baseEnv[name] !== undefined) env[name] = baseEnv[name]
  }
  const secrets = {}
  for (const name of allowedSecrets) {
    if (baseEnv[name] !== undefined) {
      env[name] = baseEnv[name]
      secrets[name] = baseEnv[name]
    }
  }
  env.GILDRA_TASK_ID = String(taskId ?? '')
  env.GILDRA_WORKSPACE_ID = String(workspaceId ?? '')
  env.GILDRA_VERIFICATION_RUN_ID = String(runId ?? '')
  return { env, secretValues: Object.values(secrets) }
}

// Редактирование секретов из текста лога: значение не должно пережить прогон
// ни в evidence, ни в diagnostics.
export function redactSecrets(text, secretValues) {
  let out = String(text)
  for (const value of secretValues) {
    if (typeof value === 'string' && value.length >= 4) out = out.split(value).join('•••')
  }
  return out
}
const LOG_TAIL_BYTES = 2048
const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60_000
const KNOWN_CHECK_STATUS = Object.freeze(['PASSED', 'FAILED', 'NOT_CONFIGURED', 'CANCELLED', 'TIMED_OUT'])

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
        timeoutMs: Number.isInteger(check.timeoutMs) && check.timeoutMs > 0 ? check.timeoutMs : DEFAULT_CHECK_TIMEOUT_MS,
      }
    }
  }
  return {
    required: Array.isArray(raw.required) && raw.required.length > 0 ? raw.required.map(String) : [...DEFAULT_REQUIRED],
    checks,
    verification: {
      allowedSecrets: Array.isArray(raw.verification?.allowedSecrets)
        ? raw.verification.allowedSecrets.map(String).filter(name => /^[A-Z][A-Z0-9_]{1,60}$/.test(name)).slice(0, 20)
        : [],
      allowUncommitted: raw.verification?.allowUncommitted === true,
    },
    reviewGate: {
      blocking: Array.isArray(raw.reviewGate?.blocking) && raw.reviewGate.blocking.length > 0
        ? raw.reviewGate.blocking.map(String)
        : [...DEFAULT_REVIEW_GATE.blocking],
    },
    protectedAreas: Array.isArray(raw.protectedAreas) ? raw.protectedAreas.map(String) : [],
    highRiskAreas: Array.isArray(raw.highRiskAreas) ? raw.highRiskAreas.map(String) : [],
    generatedFiles: Array.isArray(raw.generatedFiles) ? raw.generatedFiles.map(String) : [],
  }
}

export function createQualityManager({ store, roots, projects, tasks, workspaces, processes }) {
  // Явная установка политики пользователем — единственный способ сделать
  // команду trusted без пофайлового одобрения.
  async function setPolicy(projectId, policy) {
    const project = await projects.get(projectId)
    if (!policy || typeof policy !== 'object') throw new RuntimeError('INVALID_INPUT', 'Ожидалась политика качества.')
    const checks = {}
    for (const [id, check] of Object.entries(policy.checks ?? {})) {
      if (typeof id !== 'string' || id === '' || id.length > 60) {
        throw new RuntimeError('INVALID_INPUT', 'Идентификатор проверки — непустая строка до 60 символов.')
      }
      checks[id] = {
        argv: assertCommandArgv(check?.argv),
        ...(Number.isInteger(check?.timeoutMs) && check.timeoutMs > 0 ? { timeoutMs: Math.min(check.timeoutMs, 60 * 60_000) } : {}),
      }
    }
    const required = Array.isArray(policy.required) ? policy.required.map(String).slice(0, 20) : undefined
    const record = {
      ...project,
      qualityPolicy: {
        ...(required ? { required } : {}),
        checks,
        ...(policy.verification ? { verification: policy.verification } : {}),
        ...(policy.architecture ? { architecture: policy.architecture } : {}),
        ...(policy.reviewGate ? { reviewGate: { blocking: (policy.reviewGate.blocking ?? []).map(String).slice(0, 5) } } : {}),
        ...(Array.isArray(policy.protectedAreas) ? { protectedAreas: policy.protectedAreas.map(String).slice(0, 50) } : {}),
        ...(Array.isArray(policy.highRiskAreas) ? { highRiskAreas: policy.highRiskAreas.map(String).slice(0, 50) } : {}),
        ...(Array.isArray(policy.generatedFiles) ? { generatedFiles: policy.generatedFiles.map(String).slice(0, 50) } : {}),
      },
    }
    await store.write('projects', projectId, record)
    await appendAudit(roots.stateRoot, 'quality.policy.set', { projectId, checks: Object.keys(checks).length })
    return qualityPolicyOf(record)
  }

  async function readLogTail(logPath) {
    try {
      const info = await stat(logPath)
      const handle = await open(logPath, 'r')
      try {
        const start = Math.max(0, info.size - LOG_TAIL_BYTES)
        const buffer = Buffer.alloc(Math.min(LOG_TAIL_BYTES, info.size))
        await handle.read(buffer, 0, buffer.length, start)
        return buffer.toString('utf8')
      } finally {
        await handle.close()
      }
    } catch {
      return ''
    }
  }

  // Прогон верификации задачи. НИКОГДА не в mutable writer-worktree (§17):
  // на каждый run создаётся immutable detached-snapshot точного headSha —
  // правка файла во время прогона не меняет то, что проверяется, а evidence
  // относится ровно к snapshot'у. Грязное дерево проверяется только в явном
  // режиме UNCOMMITTED_SNAPSHOT (в самом workspace, с content-хэшем) и не
  // выдаётся за проверку HEAD.
  async function runVerification(taskId, { checkIds, allowUncommitted = false } = {}) {
    const task = await tasks.getTask(taskId)
    if (!task.workspaceId) throw new RuntimeError('INVALID_INPUT', 'У задачи нет привязанного workspace — верифицировать нечего.', { taskId })
    const workspace = await workspaces.getRecord(task.workspaceId)
    const project = await projects.get(task.projectId)
    const policy = qualityPolicyOf(project)

    const headSha = await revParse(workspace.path, 'HEAD')
    const dirty = await dirtyFiles(workspace.path)
    const uncommittedMode = dirty.length > 0
    if (uncommittedMode && !allowUncommitted && !policy.verification.allowUncommitted) {
      throw new RuntimeError('WORKSPACE_DIRTY', `В workspace ${String(dirty.length)} незакоммиченных файлов. Закоммитьте их или явно запросите режим UNCOMMITTED_SNAPSHOT (allowUncommitted) — притворяться, что проверялся HEAD, нельзя.`, {
        taskId, dirtyFiles: dirty.length,
      })
    }
    const runId = generateId('verify')
    const logDir = join(roots.stateRoot, 'logs', 'verify')
    await mkdir(logDir, { recursive: true, mode: 0o700 })

    // Snapshot: committed-режим — detached worktree на headSha; uncommitted —
    // сам workspace с честной пометкой и content-хэшем diff'а.
    let snapshotPath
    let snapshot
    if (uncommittedMode) {
      const diffText = await git(['-C', workspace.path, 'diff', '--no-ext-diff', 'HEAD'])
      snapshot = { mode: 'UNCOMMITTED_SNAPSHOT', contentHash: createHash('sha256').update(diffText.stdout).digest('hex').slice(0, 16) }
      snapshotPath = workspace.path
    } else {
      snapshotPath = await workspaces.createVerificationSnapshot(task.projectId, headSha, taskId, runId)
      snapshot = { mode: 'COMMITTED', path: snapshotPath, sha: headSha }
    }
    const { env: verificationEnv, secretValues } = buildVerificationEnv({
      allowedSecrets: policy.verification.allowedSecrets,
      taskId,
      workspaceId: task.workspaceId,
      runId,
    })

    const wanted = new Set(checkIds ?? [...new Set([...policy.required, ...Object.keys(policy.checks)])])
    wanted.delete('review') // review — отдельный этап, не команда

    const checks = []
    let cancelled = false
    const run = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      runId,
      taskId,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      branch: workspace.branch,
      headSha,
      dirtyAtRun: dirty.length,
      snapshot: { mode: snapshot.mode, ...(snapshot.contentHash ? { contentHash: snapshot.contentHash } : {}) },
      // Ревизии требований (§14): evidence доказывает соответствие ЭТОЙ
      // постановке и ЭТОЙ политике; их смена делает прогон STALE.
      revisions: requirementRevisions({ task, project }),
      status: 'RUNNING',
      checks,
      startedAt: new Date().toISOString(),
    }
    await store.write(VERIFICATIONS, runId, run)

    for (const id of wanted) {
      const configured = policy.checks[id]
      if (!configured) {
        // Честный NOT_CONFIGURED вместо тихого PASSED (§6).
        checks.push({ id, status: 'NOT_CONFIGURED' })
        continue
      }
      const current = await store.read(VERIFICATIONS, runId)
      if (current?.status === 'CANCELLING') {
        checks.push({ id, status: 'CANCELLED' })
        cancelled = true
        continue
      }
      const logPath = join(logDir, `${runId}-${id.replaceAll(/[^a-z0-9-]/gi, '_')}.log`)
      const startedAt = Date.now()
      let outcome
      try {
        outcome = await processes.runManaged({
          sessionId: workspace.sessionId,
          workspaceId: task.workspaceId,
          cwd: snapshotPath,
          env: verificationEnv,
          role: 'verify',
          logPath,
          timeoutMs: configured.timeoutMs,
        }, configured.argv[0], configured.argv.slice(1))
      } catch (error) {
        checks.push({ id, argv: configured.argv, status: 'FAILED', error: error instanceof Error ? error.message : String(error) })
        continue
      }
      checks.push({
        id,
        argv: configured.argv,
        status: outcome.timedOut ? 'TIMED_OUT' : outcome.exitCode === 0 ? 'PASSED' : 'FAILED',
        exitCode: outcome.exitCode,
        durationMs: Date.now() - startedAt,
        logPath,
        logTail: redactSecrets(await readLogTail(logPath), secretValues),
      })
    }
    // Snapshot одноразовый: результат зафиксирован в evidence, дерево больше
    // не нужно (§17).
    if (snapshot.mode === 'COMMITTED') {
      await workspaces.removeVerificationSnapshot(task.projectId, snapshotPath).catch(() => {})
    }

    const finished = {
      ...run,
      checks,
      status: cancelled ? 'CANCELLED' : 'COMPLETED',
      finishedAt: new Date().toISOString(),
    }
    await store.write(VERIFICATIONS, runId, finished)
    // Свежайший прогон — на задаче: readiness смотрит сюда.
    await tasks.saveTask({ ...(await tasks.getTask(taskId)), latestVerificationId: runId })
    await appendAudit(roots.stateRoot, 'task.verified', {
      taskId,
      runId,
      passed: checks.filter(check => check.status === 'PASSED').length,
      failed: checks.filter(check => check.status === 'FAILED' || check.status === 'TIMED_OUT').length,
    })
    return finished
  }

  // Отмена (§69): помечает прогон, оставшиеся проверки станут CANCELLED, а
  // уже запущенный процесс завершается через Process Manager по записи
  // процесса (killSessionProcesses по роли verify).
  async function cancelVerification(runId) {
    const run = await store.read(VERIFICATIONS, assertId(runId, 'runId'))
    if (!run) throw new RuntimeError('TASK_NOT_FOUND', `Прогон «${runId}» не найден.`, { runId })
    if (run.status !== 'RUNNING') return run
    await store.write(VERIFICATIONS, runId, { ...run, status: 'CANCELLING' })
    const workspace = await workspaces.getRecord(run.workspaceId).catch(() => undefined)
    if (workspace) {
      const records = await processes.listForSession(workspace.sessionId)
      for (const record of records.filter(entry => entry.role === 'verify')) {
        await processes.terminate(record)
      }
    }
    await appendAudit(roots.stateRoot, 'task.verify.cancelled', { runId, taskId: run.taskId })
    return store.read(VERIFICATIONS, runId)
  }

  async function getVerification(runId) {
    const run = await store.read(VERIFICATIONS, assertId(runId, 'runId'))
    if (!run) throw new RuntimeError('TASK_NOT_FOUND', `Прогон «${runId}» не найден.`, { runId })
    return run
  }

  // Regression-first bugfix (§18): доказательство — ДВА реальных прогона:
  // проваленный (баг воспроизведён) и прошедший (баг исправлен). Runtime
  // проверяет прогоны по своим же записям — сочинить их словами нельзя.
  async function recordRegression(taskId, { failingRunId, passingRunId, manualReproOnly, reason }) {
    const task = await tasks.getTask(taskId)
    if (manualReproOnly === true) {
      if (typeof reason !== 'string' || reason.trim().length < 10) {
        throw new RuntimeError('INVALID_INPUT', 'MANUAL_REPRO_ONLY требует содержательной причины: почему баг нельзя воспроизвести автоматически.')
      }
      return tasks.saveTask({ ...task, regression: { status: 'MANUAL_REPRO_ONLY', reason: reason.trim().slice(0, 1000) } })
    }
    const failing = await getVerification(failingRunId)
    const passing = await getVerification(passingRunId)
    if (failing.taskId !== taskId || passing.taskId !== taskId) {
      throw new RuntimeError('INVALID_INPUT', 'Оба прогона должны принадлежать этой задаче.')
    }
    if (!failing.checks.some(check => check.status === 'FAILED')) {
      throw new RuntimeError('INVALID_INPUT', '«Проваленный» прогон не содержит ни одной FAILED-проверки — баг не был воспроизведён.', { failingRunId })
    }
    if (!passing.checks.some(check => check.status === 'PASSED') || passing.checks.some(check => check.status === 'FAILED' || check.status === 'TIMED_OUT')) {
      throw new RuntimeError('INVALID_INPUT', '«Прошедший» прогон обязан быть полностью зелёным.', { passingRunId })
    }
    if (Date.parse(failing.startedAt) >= Date.parse(passing.startedAt)) {
      throw new RuntimeError('INVALID_INPUT', 'Проваленный прогон должен предшествовать прошедшему.')
    }
    return tasks.saveTask({ ...task, regression: { status: 'PROVEN', failingRunId, passingRunId } })
  }

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
    const run = task.latestVerificationId ? await store.read(VERIFICATIONS, task.latestVerificationId) : undefined
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
            blockers.push({ id: 'DIRTY_WORKSPACE', message: `В workspace ${String(dirtyNow.length)} незакоммиченных файлов — доказательство относится не к финальному состоянию.` })
          }
        }
      }
      if (run.snapshot?.mode === 'UNCOMMITTED_SNAPSHOT' || run.dirtyAtRun > 0) {
        blockers.push({ id: 'EVIDENCE_ON_DIRTY_TREE', message: 'Evidence получено в режиме UNCOMMITTED_SNAPSHOT — для готовности прогоните проверки на закоммиченном HEAD.' })
      }
      if (currentHead && run.headSha !== currentHead) {
        blockers.push({ id: 'STALE_EVIDENCE', message: 'После последнего verification появились новые коммиты — прогоните проверки заново.' })
      }
      // §14: изменение критериев/скоупа/политики после прогона делает
      // доказательство недействительным — оно отвечало на другой вопрос.
      const currentRevisions = requirementRevisions({ task, project })
      if (!revisionsMatch(run.revisions, currentRevisions)) {
        blockers.push({ id: 'STALE_EVIDENCE_REVISION', message: 'Постановка задачи или политика изменились после verification — прогоните проверки заново.' })
      }
      for (const requiredId of policy.required) {
        if (requiredId === 'review') continue
        const check = run.checks.find(entry => entry.id === requiredId)
        if (!check || check.status === 'NOT_CONFIGURED') {
          blockers.push({ id: `CHECK_NOT_CONFIGURED:${requiredId}`, message: `Обязательная проверка «${requiredId}» не настроена в политике проекта.` })
        } else if (check.status !== 'PASSED') {
          blockers.push({ id: `CHECK_FAILED:${requiredId}`, message: `Проверка «${requiredId}» в статусе ${check.status}.` })
        }
      }
      facts.push(...run.checks.map(check => ({ kind: 'check', id: check.id, status: check.status })))
    }

    // Независимое ревью (§14–§16): writer ≠ reviewer гарантирует review.js,
    // здесь проверяются вердикт и незакрытые findings по gate проекта.
    if (policy.required.includes('review')) {
      const review = task.review
      if (!review || review.verdict !== 'APPROVED') {
        blockers.push({ id: 'REVIEW_MISSING', message: review ? 'Ревью не одобрено.' : 'Независимое ревью не выполнялось.' })
      } else {
        for (const severity of policy.reviewGate.blocking) {
          const count = review.openBySeverity?.[severity] ?? 0
          if (count > 0) {
            blockers.push({ id: 'REVIEW_BLOCKED', message: `Незакрытых findings уровня ${severity}: ${String(count)}.` })
          }
        }
        if (review.criteriaVerified !== true) {
          blockers.push({ id: 'CRITERIA_UNVERIFIED', message: 'Reviewer не подтвердил критерии приёмки по пунктам.' })
        }
        if (review.headSha && run?.headSha && review.headSha !== run.headSha) {
          blockers.push({ id: 'STALE_REVIEW', message: 'Ревью относится к другому коммиту, чем evidence.' })
        }
        facts.push({ kind: 'review', verdict: review.verdict, modes: review.modes })
      }
      // Adversarial для high-risk diff (§17).
      if (task.analysis?.highRisk === true && !(task.review?.modes ?? []).includes('adversarial')) {
        blockers.push({ id: 'ADVERSARIAL_REQUIRED', message: 'Изменение затрагивает high-risk область — требуется adversarial review.' })
      }
    }

    // Архитектурные gates (§8): FAILED-чек — блокер до устранения; никакое
    // объяснение BLOCK-код не гасит (в отличие от REVIEW-сигналов ниже).
    for (const check of task.analysis?.modularity?.checks ?? []) {
      if (check.status === 'FAILED') {
        const codes = (check.findings ?? []).map(finding => finding.code).join(', ')
        blockers.push({ id: `ARCH:${check.id}`, message: `Архитектурный gate «${check.id}» не пройден: ${codes}. Устраните — объяснением это не закрывается.` })
      }
      facts.push({ kind: 'architecture', id: check.id, status: check.status })
    }

    // Сигналы diff-анализа: каждый либо отсутствует, либо объяснён — причём
    // объяснение действительно только для ТЕКУЩЕГО отпечатка сигнала (§15):
    // новое ослабление тестов не прикрывается старой отпиской.
    const signals = task.analysis?.signals ?? []
    const ackBySignal = new Map((task.acknowledgments ?? []).map(entry => [entry.signal, entry]))
    for (const kind of new Set(signals.map(entry => entry.kind))) {
      if (!ACKNOWLEDGEABLE_SIGNALS.includes(kind)) continue
      const ack = ackBySignal.get(kind)
      const currentFingerprint = signalFingerprint(kind,
        signals.filter(entry => entry.kind === kind).map(entry => entry.fingerprint).sort())
      if (!ack) {
        blockers.push({ id: `SIGNAL_UNACKNOWLEDGED:${kind}`, message: `Сигнал ${kind} не объяснён и не устранён.` })
      } else if (ack.fingerprint !== currentFingerprint) {
        blockers.push({ id: `SIGNAL_ACK_STALE:${kind}`, message: `Объяснение сигнала ${kind} относится к другому содержимому — сигнал изменился, объяснитесь заново.` })
      }
    }

    // Upstream (§23–§25): релевантный сдвиг цели требует явного решения,
    // привязанного к КОНКРЕТНОМУ targetSha — новый сдвиг требует нового.
    if (task.upstream?.status === 'UPSTREAM_RELEVANT') {
      const ack = ackBySignal.get('UPSTREAM_RELEVANT')
      if (!ack || ack.targetSha !== task.upstream.targetSha) {
        blockers.push({ id: 'UPSTREAM_RELEVANT', message: `Цель ушла вперёд и затронула связанные файлы (${String(task.upstream.behind)} коммитов) — обновите базу или объясните, почему это безопасно.` })
      }
    }

    // Regression-first для bugfix (§18).
    if (task.kind === 'bugfix') {
      const regression = task.regression
      if (!regression || (regression.status !== 'PROVEN' && regression.status !== 'MANUAL_REPRO_ONLY')) {
        blockers.push({ id: 'REGRESSION_REQUIRED', message: 'Bugfix требует regression-доказательства (проваленный → прошедший прогон) или явного MANUAL_REPRO_ONLY.' })
      }
    }

    return { taskId, ready: blockers.length === 0, blockers, facts, status: task.status }
  }

  // Единственный путь в READY_FOR_HUMAN_REVIEW.
  async function promoteIfReady(taskId) {
    const verdict = await readiness(taskId)
    if (!verdict.ready) {
      throw new RuntimeError('READINESS_REQUIRED', 'Definition of Done не выполнена — см. blockers.', { taskId, blockers: verdict.blockers })
    }
    const task = await tasks.getTask(taskId)
    const promoted = await tasks.saveTask({ ...task, status: 'READY_FOR_HUMAN_REVIEW' })
    await appendAudit(roots.stateRoot, 'task.promoted', { taskId })
    return promoted
  }

  return {
    setPolicy,
    qualityPolicyOf,
    runVerification,
    cancelVerification,
    getVerification,
    recordRegression,
    readiness,
    promoteIfReady,
    KNOWN_CHECK_STATUS,
  }
}
