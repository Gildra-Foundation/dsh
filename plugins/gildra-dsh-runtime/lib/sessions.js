// Session Manager: постоянный жизненный цикл write/read-сессий.
//
// Session отделена от chat-объекта Harness: безопасность привязана к
// state+lease+owner-token Runtime, а не к UI session id. Read-сессии
// (review/security/architecture-агенты) подключаются к существующему
// workspace без lease — безопасный дефолт «один writer, N читателей»;
// параллельные writer-агенты получают каждый собственный workspace.

import { hostname } from 'node:os'
import { RuntimeError } from './errors.js'
import { assertSegment, currentUserId, generateSessionId } from './ids.js'
import { appendAudit } from './audit.js'
import { sessionEnvironment } from './runtime-env.js'
import { OPERATION_TYPES, PHASES, createJournal } from './journal.js'

const SESSIONS = 'sessions'

export const SESSION_STATUSES = Object.freeze([
  'CREATING', 'ACTIVE', 'IDLE', 'TESTING', 'REVIEWING', 'MERGING',
  'COMPLETED', 'FAILED', 'ORPHANED', 'CLEANING',
])

const TRANSITION_TARGETS = new Set(['ACTIVE', 'IDLE', 'TESTING', 'REVIEWING', 'MERGING', 'COMPLETED', 'FAILED'])

export function createSessionManager({ store, roots, projects, workspaces, leases, processes, ports, journal, env = process.env }) {
  const operations = journal ?? createJournal({ roots })
  const orphanAfterMs = (() => {
    const value = Number(env.GILDRA_DSH_SESSION_ORPHAN_MS)
    return Number.isFinite(value) && value > 0 ? value : 10 * 60_000
  })()

  async function getSession(sessionId) {
    const record = await store.read(SESSIONS, sessionId)
    if (!record) throw new RuntimeError('SESSION_NOT_FOUND', `Сессия «${sessionId}» не найдена.`, { sessionId })
    return record
  }

  async function requireOwner(sessionId, ownerToken) {
    const record = await getSession(sessionId)
    if (!ownerToken || record.ownerToken !== ownerToken) {
      throw new RuntimeError('UNAUTHORIZED_SESSION', 'Операция требует owner-token этой сессии.', { sessionId })
    }
    return record
  }

  async function listSessions(filter = {}) {
    const rows = []
    for (const id of await store.list(SESSIONS)) {
      const record = await store.read(SESSIONS, id)
      if (!record) continue
      if (filter.projectId && record.projectId !== filter.projectId) continue
      if (filter.userId && record.userId !== filter.userId) continue
      if (filter.activeOnly && ['COMPLETED', 'FAILED'].includes(record.status)) continue
      rows.push(record)
    }
    return rows
  }

  async function createSession({ projectId, userId = currentUserId(), mode = 'write', baseRef, title, attachTo, portNames = ['app'] }) {
    const project = await projects.get(projectId)
    assertSegment(userId, 'userId')
    const sessionId = generateSessionId()
    const now = new Date().toISOString()

    if (mode === 'read') {
      // Read-сессия видит существующий workspace, lease не берёт и портов
      // не аллоцирует: читатели не запускают dev-серверы.
      const workspace = await workspaces.getRecord(attachTo ?? '')
      const record = {
        schemaVersion: 1,
        id: sessionId,
        sessionId,
        userId,
        projectId,
        environmentId: hostname(),
        workspaceId: workspace.workspaceId,
        branch: workspace.branch,
        baseRef: workspace.baseRef,
        mode: 'read',
        status: 'ACTIVE',
        title: title ? String(title).slice(0, 200) : undefined,
        createdAt: now,
        lastActivityAt: now,
        pid: process.pid,
      }
      await store.write(SESSIONS, sessionId, record)
      await appendAudit(roots.stateRoot, 'session.created', { sessionId, projectId, userId, mode })
      return { session: record, environment: sessionEnvironment({ session: record, workspace, ports: [] }) }
    }

    if (mode !== 'write') throw new RuntimeError('INVALID_INPUT', 'mode должен быть write или read.', { mode })

    // Write-сессия: CREATING → workspace → lease → ports → ACTIVE. Заголовок
    // задачи хранится отдельно и никогда не попадает в имена веток/путей.
    const creating = {
      schemaVersion: 1,
      id: sessionId,
      sessionId,
      userId,
      projectId,
      environmentId: hostname(),
      mode: 'write',
      status: 'CREATING',
      title: title ? String(title).slice(0, 200) : undefined,
      createdAt: now,
      lastActivityAt: now,
      pid: process.pid,
    }
    await store.write(SESSIONS, sessionId, creating)
    // Журнал операции: recovery не гадает, что успело создаться при падении
    // между шагами, а читает последнюю завершённую фазу.
    const operation = await operations.begin(OPERATION_TYPES.CREATE_SESSION, sessionId, { projectId, userId })
    // Ссылки на уже захваченные ресурсы: при сбое на следующем шаге откат
    // обязан снять СВОЙ lease, иначе живой процесс держал бы workspace
    // заблокированным до истечения orphan-таймаута.
    let acquiredLease
    let createdWorkspace
    try {
      const workspace = await workspaces.createWorkspace({ projectId, userId, sessionId, baseRef })
      createdWorkspace = workspace
      await operation.advance(PHASES.WORKTREE_CREATED, {
        workspaceId: workspace.workspaceId,
        branch: workspace.branch,
        path: workspace.path,
      })
      const lease = await leases.acquire({ workspaceId: workspace.workspaceId, sessionId, userId })
      acquiredLease = lease
      await operation.advance(PHASES.LEASE_ACQUIRED, { generation: lease.generation })
      const portLeases = []
      for (const name of portNames) {
        portLeases.push(await ports.allocate({ sessionId, name }))
      }
      await operation.advance(PHASES.PORTS_ALLOCATED)
      const record = {
        ...creating,
        status: 'ACTIVE',
        workspaceId: workspace.workspaceId,
        branch: workspace.branch,
        baseRef: workspace.baseRef,
        ownerToken: lease.ownerToken,
        leaseGeneration: lease.generation,
        ports: Object.fromEntries(portLeases.map(lease2 => [lease2.name, lease2.port])),
      }
      await store.write(SESSIONS, sessionId, record)
      await operation.complete()
      await appendAudit(roots.stateRoot, 'session.created', { sessionId, projectId, userId, mode, workspaceId: workspace.workspaceId })
      const environment = sessionEnvironment({ session: record, workspace, ports: portLeases })
      return { session: record, ownerToken: lease.ownerToken, environment, project }
    } catch (error) {
      // Неудачное создание не оставляет полуживых ресурсов: порты и
      // собственный lease освобождаются, worktree остаётся на диске и
      // фиксируется в журнале — его судьбу решает пользователь, а не
      // автоматическое удаление возможной работы.
      await ports.releaseForSession(sessionId).catch(() => {})
      if (acquiredLease && createdWorkspace) {
        await leases.release(createdWorkspace.workspaceId, acquiredLease.ownerToken).catch(() => {})
      }
      await operation.fail(error instanceof Error ? error.message : String(error))
      await store.write(SESSIONS, sessionId, { ...creating, status: 'FAILED', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async function heartbeat(sessionId, ownerToken) {
    const record = await requireOwner(sessionId, ownerToken)
    if (record.workspaceId && record.mode === 'write') {
      await leases.heartbeat(record.workspaceId, ownerToken)
    }
    await store.write(SESSIONS, sessionId, { ...record, lastActivityAt: new Date().toISOString(), pid: process.pid })
    return { ok: true }
  }

  async function transition(sessionId, ownerToken, status) {
    if (!TRANSITION_TARGETS.has(status)) {
      throw new RuntimeError('INVALID_INPUT', `Недопустимый статус «${status}».`, { allowed: [...TRANSITION_TARGETS] })
    }
    const record = await requireOwner(sessionId, ownerToken)
    await store.write(SESSIONS, sessionId, { ...record, status, lastActivityAt: new Date().toISOString() })
    return { status }
  }

  // Восстановление живой сессии после ORPHANED (пользователь выбрал
  // Recover): lease перехватывается заново, выдаётся новый owner-token.
  async function recoverSession(sessionId) {
    const record = await getSession(sessionId)
    if (record.status !== 'ORPHANED') {
      throw new RuntimeError('INVALID_INPUT', 'Восстанавливать можно только ORPHANED-сессию.', { sessionId, status: record.status })
    }
    const workspace = await workspaces.getRecord(record.workspaceId)
    const operation = await operations.begin(OPERATION_TYPES.RECOVER_SESSION, sessionId, {
      workspaceId: workspace.workspaceId,
    })
    try {
      const lease = await leases.acquire({ workspaceId: workspace.workspaceId, sessionId, userId: record.userId })
      await operation.advance(PHASES.LEASE_ACQUIRED, { generation: lease.generation })
      const recovered = {
        ...record,
        status: 'ACTIVE',
        // Новое поколение lease обесценивает старый токен: «воскресший»
        // писатель предыдущего поколения не сможет ничего разрушить.
        ownerToken: lease.ownerToken,
        leaseGeneration: lease.generation,
        pid: process.pid,
        lastActivityAt: new Date().toISOString(),
      }
      await store.write(SESSIONS, sessionId, recovered)
      await operation.complete()
      await appendAudit(roots.stateRoot, 'session.recovered', { sessionId, generation: lease.generation })
      return { session: recovered, ownerToken: lease.ownerToken }
    } catch (error) {
      await operation.fail(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async function cleanupSession(sessionId, { ownerToken, confirmDirty = false, confirmUnmerged = false, expectedPlanToken } = {}) {
    const record = await getSession(sessionId)
    if (record.status !== 'ORPHANED') await requireOwner(sessionId, ownerToken)
    await store.write(SESSIONS, sessionId, { ...record, status: 'CLEANING' })
    const operation = await operations.begin(OPERATION_TYPES.CLEANUP_SESSION, sessionId, {
      workspaceId: record.workspaceId,
    })
    // Порядок: процессы сессии → порты → workspace (cleanup-guard'ы workspace
    // сами защищают dirty/unmerged/чужой lease).
    await processes.killSessionProcesses(sessionId)
    await operation.advance(PHASES.PROCESSES_STOPPED)
    await ports.releaseForSession(sessionId)
    await operation.advance(PHASES.PORTS_RELEASED)
    if (record.workspaceId) {
      try {
        await workspaces.cleanupWorkspace(record.workspaceId, {
          confirmDirty,
          confirmUnmerged,
          ownerToken: record.ownerToken,
          expectedPlanToken,
        })
        await operation.advance(PHASES.WORKTREE_REMOVED)
      } catch (error) {
        // Неудачный cleanup ничего не разрушил и не снял lease: сессия
        // возвращается в прежнее состояние со своим токеном, а не
        // объявляется осиротевшей — потерянной работы здесь нет.
        await operation.fail(error instanceof Error ? error.message : String(error))
        await store.write(SESSIONS, sessionId, {
          ...record,
          cleanupError: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }
    await store.write(SESSIONS, sessionId, { ...record, status: 'COMPLETED', completedAt: new Date().toISOString(), ownerToken: undefined })
    await operation.complete()
    await appendAudit(roots.stateRoot, 'session.completed', { sessionId })
    return { completed: true }
  }

  // Crash recovery: находит осиротевшие сессии и брошенные worktree, ничего
  // не удаляя. UI предлагает Recover / Archive / Delete.
  // Три независимых признака жизни сессии (§7): закрытая вкладка браузера —
  // это молчащий UI, но НЕ мёртвый агент. ORPHANED только когда мёртв
  // процесс-владелец, молчит lease И нет живых managed-процессов сессии.
  async function livenessOf(record) {
    const uiHeartbeatAge = Date.now() - Date.parse(record.lastActivityAt ?? record.createdAt)
    const ownerProcessAlive = processAliveSafe(record.pid)
    const managedProcesses = processes ? (await processes.listForSession(record.sessionId, { aliveOnly: true })) : []
    const leaseState = record.workspaceId && record.mode === 'write'
      ? (await leases.stateOf(record.workspaceId)).state
      : 'FREE'
    return {
      uiHeartbeatAge,
      uiSilent: uiHeartbeatAge > orphanAfterMs,
      ownerProcessAlive,
      managedProcesses: managedProcesses.length,
      leaseState,
      // Живой процесс — достаточное доказательство жизни, даже если UI молчит.
      alive: ownerProcessAlive || managedProcesses.length > 0 || leaseState === 'ACTIVE',
    }
  }

  async function scanForRecovery() {
    const report = {
      orphaned: [],
      missingWorkspaces: [],
      adoptableWorktrees: [],
      staleLeases: [],
      unfinishedOperations: [],
    }
    for (const record of await listSessions({ activeOnly: true })) {
      if (record.status === 'CREATING' || record.status === 'CLEANING') continue
      const liveness = await livenessOf(record)
      if (record.workspaceId) {
        try {
          const status = await workspaces.workspaceStatus(record.workspaceId)
          if (!status.worktreePresent) report.missingWorkspaces.push({ sessionId: record.sessionId, workspaceId: record.workspaceId })
        } catch {
          report.missingWorkspaces.push({ sessionId: record.sessionId, workspaceId: record.workspaceId })
        }
      }
      if (liveness.leaseState === 'STALE') {
        report.staleLeases.push({ sessionId: record.sessionId, workspaceId: record.workspaceId })
      }
      const orphaned = record.status !== 'ORPHANED'
        && !liveness.alive
        && (liveness.uiSilent || liveness.leaseState === 'ORPHANED' || liveness.leaseState === 'FREE')
      if (orphaned) {
        await store.write(SESSIONS, record.sessionId, { ...record, status: 'ORPHANED' })
        report.orphaned.push({
          sessionId: record.sessionId,
          workspaceId: record.workspaceId,
          heartbeatAge: liveness.uiHeartbeatAge,
          leaseState: liveness.leaseState,
        })
        await appendAudit(roots.stateRoot, 'session.orphaned', { sessionId: record.sessionId })
      }
    }
    // Незавершённые операции: журнал точно говорит, на каком шаге упало.
    // Ничего не удаляем автоматически — только классифицируем для UI.
    for (const operation of await operations.listOpen()) {
      report.unfinishedOperations.push({
        operationId: operation.operationId,
        type: operation.type,
        entityId: operation.entityId,
        phase: operation.phase,
        startedAt: operation.startedAt,
      })
    }
    for (const project of await projects.list()) {
      const unknown = await workspaces.adoptExistingWorktrees(project.projectId)
      for (const entry of unknown) {
        report.adoptableWorktrees.push({ projectId: project.projectId, path: entry.path, branch: entry.branch })
      }
    }
    return report
  }

  function processAliveSafe(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error?.code === 'EPERM'
    }
  }

  return {
    createSession,
    getSession,
    listSessions,
    heartbeat,
    transition,
    recoverSession,
    cleanupSession,
    scanForRecovery,
    requireOwner,
    livenessOf,
    operations,
  }
}
