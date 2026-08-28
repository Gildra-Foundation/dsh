// Verification Runner: жизненный цикл прогона (§11, §17, §19 плана
// authority) — атомарная резервация PREPARING, immutable snapshot,
// исполнение через Process Manager, отмена и recovery.
//
// Выделен из quality.js: раннер ничего не знает о Definition of Done —
// он честно исполняет и записывает. Evidence-коллекция и её чтение — в
// verification-evidence.js.

import { createHash } from 'node:crypto'
import { mkdir, open, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { RuntimeError } from './errors.js'
import { assertId, generateId } from './ids.js'
import { appendAudit } from './audit.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import { dirtyFiles, git, revParse } from './gitx.js'
import { requirementRevisions } from './provenance.js'
import { qualityPolicyOf } from './quality-policy.js'
import { buildVerificationEnv, redactSecrets } from './verification-env.js'
import { VERIFICATIONS } from './verification-evidence.js'

const LOG_TAIL_BYTES = 2048
const STALE_PREPARING_MS = 10 * 60_000

export function createVerificationRunner({
  store,
  roots,
  projects,
  tasks,
  workspaces,
  processes,
  repoIntel,
}) {
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
    if (!task.workspaceId)
      throw new RuntimeError(
        'INVALID_INPUT',
        'У задачи нет привязанного workspace — верифицировать нечего.',
        { taskId },
      )
    const workspace = await workspaces.getRecord(task.workspaceId)
    const project = await projects.get(task.projectId)
    const policy = qualityPolicyOf(project)

    const headSha = await revParse(workspace.path, 'HEAD')
    const dirty = await dirtyFiles(workspace.path)
    const uncommittedMode = dirty.length > 0
    if (uncommittedMode && !allowUncommitted && !policy.verification.allowUncommitted) {
      throw new RuntimeError(
        'WORKSPACE_DIRTY',
        `В workspace ${String(dirty.length)} незакоммиченных файлов. Закоммитьте их или явно запросите режим UNCOMMITTED_SNAPSHOT (allowUncommitted) — притворяться, что проверялся HEAD, нельзя.`,
        {
          taskId,
          dirtyFiles: dirty.length,
        },
      )
    }
    const runId = generateId('verify')
    // §11: АТОМАРНАЯ резервация. Под локом задачи: проверка активных
    // (PREPARING/RUNNING/CANCELLING) → durable-запись PREPARING с поколением.
    // Раньше между проверкой и записью RUNNING создавался snapshot ВНЕ лока —
    // параллельные запросы проходили проверку вдвоём.
    await store.withLock(
      `verify-${taskId.slice(0, 50)}`,
      async () => {
        let generation = 0
        for (const id of await store.list(VERIFICATIONS)) {
          const row = await store.read(VERIFICATIONS, id)
          if (row?.taskId !== taskId) continue
          generation = Math.max(generation, row.generation ?? 0)
          if (!['PREPARING', 'RUNNING', 'CANCELLING'].includes(row.status)) continue
          // Recovery зависшего PREPARING (§11): резервация без прогресса
          // дольше лимита — брошенный процесс; помечаем FAILED и проходим.
          if (
            row.status === 'PREPARING' &&
            Date.now() - Date.parse(row.startedAt) > STALE_PREPARING_MS
          ) {
            await store.write(VERIFICATIONS, id, {
              ...row,
              status: 'FAILED',
              failure: 'STALE_PREPARING',
              finishedAt: new Date().toISOString(),
            })
            continue
          }
          if (!policy.verification.allowParallel) {
            throw new RuntimeError(
              'VERIFICATION_ACTIVE',
              'У задачи уже идёт verification-прогон: дождитесь его, отмените по runId или разрешите параллель политикой.',
              { taskId, runId: row.runId, status: row.status },
            )
          }
        }
        await store.write(VERIFICATIONS, runId, {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          runId,
          taskId,
          projectId: task.projectId,
          workspaceId: task.workspaceId,
          status: 'PREPARING',
          generation: generation + 1,
          startedAt: new Date().toISOString(),
          checks: [],
        })
      },
      { timeoutMs: 15_000 },
    )
    const logDir = join(roots.stateRoot, 'logs', 'verify')
    await mkdir(logDir, { recursive: true, mode: 0o700 })

    // Snapshot: committed-режим — detached worktree на headSha; uncommitted —
    // сам workspace с честной пометкой и content-хэшем diff'а. Провал
    // снапшота переводит резервацию PREPARING → FAILED (§11), не оставляя
    // вечного «активного» прогона.
    let snapshotPath
    let snapshot
    try {
      if (uncommittedMode) {
        const diffText = await git(['-C', workspace.path, 'diff', '--no-ext-diff', 'HEAD'])
        snapshot = {
          mode: 'UNCOMMITTED_SNAPSHOT',
          contentHash: createHash('sha256').update(diffText.stdout).digest('hex').slice(0, 16),
        }
        snapshotPath = workspace.path
      } else {
        snapshotPath = await workspaces.createVerificationSnapshot(
          task.projectId,
          headSha,
          taskId,
          runId,
        )
        snapshot = { mode: 'COMMITTED', path: snapshotPath, sha: headSha }
      }
    } catch (error) {
      const reserved = await store.read(VERIFICATIONS, runId)
      await store.write(VERIFICATIONS, runId, {
        ...reserved,
        status: 'FAILED',
        failure: 'SNAPSHOT_FAILED',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      })
      throw error
    }
    const { env: verificationEnv, secretValues } = buildVerificationEnv({
      allowedSecrets: policy.verification.allowedSecrets,
      taskId,
      workspaceId: task.workspaceId,
      runId,
    })

    const wanted = new Set(
      checkIds ?? [...new Set([...policy.required, ...Object.keys(policy.checks)])],
    )
    wanted.delete('review') // review — отдельный этап, не команда

    const checks = []
    let cancelled = false
    const reservation = await store.read(VERIFICATIONS, runId)
    if (reservation?.status === 'CANCELLING') cancelled = true
    const run = {
      ...reservation,
      branch: workspace.branch,
      headSha,
      dirtyAtRun: dirty.length,
      snapshot: {
        mode: snapshot.mode,
        ...(snapshot.contentHash ? { contentHash: snapshot.contentHash } : {}),
      },
      // Ревизии требований (§9/§14): evidence доказывает соответствие ЭТОЙ
      // постановке, плану, claims и политике; смена любого — STALE.
      revisions: requirementRevisions({
        task,
        project,
        profile: repoIntel
          ? await repoIntel.getProfile(task.projectId).catch(() => undefined)
          : undefined,
      }),
      status: cancelled ? 'CANCELLING' : 'RUNNING',
      checks,
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
        outcome = await processes.runManaged(
          {
            sessionId: workspace.sessionId,
            workspaceId: task.workspaceId,
            cwd: snapshotPath,
            env: verificationEnv,
            role: 'verify',
            meta: { runId, checkId: id },
            logPath,
            timeoutMs: configured.timeoutMs,
          },
          configured.argv[0],
          configured.argv.slice(1),
        )
      } catch (error) {
        checks.push({
          id,
          argv: configured.argv,
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }
      checks.push({
        id,
        argv: configured.argv,
        status: outcome.unterminated
          ? 'TIMED_OUT_UNTERMINATED'
          : outcome.timedOut
            ? 'TIMED_OUT'
            : outcome.exitCode === 0
              ? 'PASSED'
              : 'FAILED',
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

    // Отмена могла прийти во время ПОСЛЕДНЕГО check'а: перечитываем статус.
    const cancelledNow =
      cancelled || (await store.read(VERIFICATIONS, runId))?.status === 'CANCELLING'
    if (cancelledNow) {
      for (const check of checks) {
        // Убитый отменой процесс — это CANCELLED, а не «провал» команды.
        if (check.status === 'FAILED' && check.exitCode === null) check.status = 'CANCELLED'
      }
    }
    const finished = {
      ...run,
      checks,
      status: cancelledNow ? 'CANCELLED' : 'COMPLETED',
      finishedAt: new Date().toISOString(),
    }
    await store.write(VERIFICATIONS, runId, finished)
    // Свежайший прогон — на задаче. Под локом и с проверкой старшинства:
    // более СТАРЫЙ прогон, финишировавший позже, не затирает результат
    // нового (§19).
    await store.withLock(
      `verify-${taskId.slice(0, 50)}`,
      async () => {
        const current = await tasks.getTask(taskId)
        const existing = current.latestVerificationId
          ? await store.read(VERIFICATIONS, current.latestVerificationId)
          : undefined
        if (!existing || Date.parse(finished.startedAt) >= Date.parse(existing.startedAt)) {
          await tasks.saveTask({ ...current, latestVerificationId: runId })
        }
      },
      { timeoutMs: 15_000 },
    )
    await appendAudit(roots.stateRoot, 'task.verified', {
      taskId,
      runId,
      passed: checks.filter((check) => check.status === 'PASSED').length,
      failed: checks.filter((check) => check.status === 'FAILED' || check.status === 'TIMED_OUT')
        .length,
    })
    return finished
  }

  // Отмена (§69): помечает прогон, оставшиеся проверки станут CANCELLED, а
  // уже запущенный процесс завершается через Process Manager по записи
  // процесса (killSessionProcesses по роли verify).
  async function cancelVerification(runId) {
    const run = await store.read(VERIFICATIONS, assertId(runId, 'runId'))
    if (!run) throw new RuntimeError('TASK_NOT_FOUND', `Прогон «${runId}» не найден.`, { runId })
    if (!['RUNNING', 'PREPARING'].includes(run.status)) return run
    await store.write(VERIFICATIONS, runId, { ...run, status: 'CANCELLING' })
    const workspace = await workspaces.getRecord(run.workspaceId).catch(() => undefined)
    if (workspace) {
      const records = await processes.listForSession(workspace.sessionId)
      // §19: отмена бьёт ТОЛЬКО процессы этого runId — параллельный прогон
      // той же задачи/сессии не задевается.
      for (const record of records.filter((entry) => entry.runId === runId)) {
        await processes.terminate(record)
      }
    }
    await appendAudit(roots.stateRoot, 'task.verify.cancelled', { runId, taskId: run.taskId })
    return store.read(VERIFICATIONS, runId)
  }

  return { runVerification, cancelVerification }
}
