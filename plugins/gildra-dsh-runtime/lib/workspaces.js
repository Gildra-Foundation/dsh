// Workspace Manager: worktree на каждую write-сессию и merge workflow.
//
// Владеет созданием ветки+worktree, деривацией путей, metadata, lifecycle,
// dry-run cleanup и объединением изменений строго через Git. Инварианты —
// в docs/architecture.md 0а: никакой mutable-директории для двух сессий,
// защищённые ветки только через merge, ничего не удаляется при live
// lease/dirty/процессах без явного подтверждения.

import { createHash } from 'node:crypto'
import { access, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RuntimeError } from './errors.js'
import { assertSegment, assertWritableBranch, generateId, sessionBranch } from './ids.js'
import { mergePath, workspaceKey, workspacePath } from './paths.js'
import { appendAudit } from './audit.js'
import {
  abortMergeIn,
  addWorktree,
  aheadBehind,
  branchCheckedOutAt,
  branchExists,
  continueMergeCommit,
  currentBranch,
  deleteBranch,
  dirtyFiles,
  isMergedInto,
  listWorktrees,
  mergeRef,
  pruneWorktrees,
  removeWorktree,
  revParse,
} from './gitx.js'

const WORKSPACES = 'workspaces'
const MERGES = 'merges'

function limit(env, name, fallback) {
  const value = Number(env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function createWorkspaceManager({ store, roots, projects, leases, processes, env = process.env }) {
  const limits = {
    perUser: limit(env, 'GILDRA_DSH_MAX_WORKSPACES_PER_USER', 32),
    perProject: limit(env, 'GILDRA_DSH_MAX_WORKSPACES_PER_PROJECT', 128),
  }

  async function getRecord(id) {
    const record = await store.read(WORKSPACES, id)
    if (!record) throw new RuntimeError('WORKSPACE_NOT_FOUND', `Workspace «${id}» не найден.`, { workspaceId: id })
    return record
  }

  async function listRecords(filter = {}) {
    const rows = []
    for (const id of await store.list(WORKSPACES)) {
      const record = await store.read(WORKSPACES, id)
      if (!record) continue
      if (filter.projectId && record.projectId !== filter.projectId) continue
      if (filter.userId && record.userId !== filter.userId) continue
      rows.push(record)
    }
    return rows
  }

  async function createWorkspace({ projectId, userId, sessionId, baseRef, branch, mode = 'write' }) {
    const project = await projects.get(projectId)
    assertSegment(userId, 'userId')
    assertSegment(sessionId, 'sessionId')
    if (mode !== 'write' && mode !== 'read') {
      throw new RuntimeError('INVALID_INPUT', 'mode должен быть write или read.', { mode })
    }
    const id = workspaceKey(projectId, userId, sessionId)
    const targetBranch = branch ?? sessionBranch(userId, sessionId)
    // Защищённые ветки закрыты для прямой записи на уровне менеджера, а не
    // только UI (architecture.md 0а.3).
    assertWritableBranch(targetBranch, project.protectedBranches)
    const path = workspacePath(roots, projectId, userId, sessionId)

    if (await store.read(WORKSPACES, id)) {
      throw new RuntimeError('WORKSPACE_EXISTS', `Workspace для сессии «${sessionId}» уже существует.`, { workspaceId: id })
    }
    if (await pathExists(path)) {
      throw new RuntimeError('WORKSPACE_EXISTS', 'Каталог workspace уже существует на диске.', { path })
    }
    const [mine, inProject] = [await listRecords({ projectId, userId }), await listRecords({ projectId })]
    if (mine.length >= limits.perUser) {
      throw new RuntimeError('LIMIT_EXCEEDED', `Достигнут лимит воркспейсов пользователя (${String(limits.perUser)}). Заархивируйте неиспользуемые.`, { limit: limits.perUser })
    }
    if (inProject.length >= limits.perProject) {
      throw new RuntimeError('LIMIT_EXCEEDED', `Достигнут лимит воркспейсов проекта (${String(limits.perProject)}).`, { limit: limits.perProject })
    }

    const { baseRef: resolvedBase, baseSha } = await projects.resolveBaseRef(project, baseRef)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })

    // Создание ветки и worktree сериализовано на репозиторий: параллельные
    // сессии не гоняются за одним именем ветки.
    await store.withLock(`repo-${projectId}`, async () => {
      if (await branchExists(project.canonicalRepoPath, targetBranch)) {
        throw new RuntimeError('WORKSPACE_EXISTS', `Ветка «${targetBranch}» уже существует.`, { branch: targetBranch })
      }
      await addWorktree(project.canonicalRepoPath, path, { branch: targetBranch, baseRef: baseSha })
    })

    const record = {
      schemaVersion: 1,
      workspaceId: id,
      projectId,
      userId,
      sessionId,
      branch: targetBranch,
      baseRef: resolvedBase,
      baseSha,
      path,
      mode,
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    await store.write(WORKSPACES, id, record)
    await appendAudit(roots.stateRoot, 'workspace.created', { workspaceId: id, projectId, userId, sessionId, branch: targetBranch })
    return record
  }

  async function workspaceStatus(id) {
    const record = await getRecord(id)
    const project = await projects.get(record.projectId)
    const exists = await pathExists(record.path)
    const dirty = exists ? await dirtyFiles(record.path) : []
    const counts = exists
      ? await aheadBehind(project.canonicalRepoPath, record.baseRef, record.branch)
      : { ahead: 0, behind: 0 }
    return {
      ...record,
      worktreePresent: exists,
      currentBranch: exists ? await currentBranch(record.path) : undefined,
      dirtyFiles: dirty.length,
      ahead: counts.ahead,
      behind: counts.behind,
      lease: leases ? await leases.stateOf(id) : undefined,
      processes: processes ? (await processes.listForSession(record.sessionId)).length : undefined,
    }
  }

  // Dry-run: объясняет, почему workspace нельзя удалить, кодами — UI
  // показывает причины и запрашивает подтверждения по каждой.
  //
  // planToken — отпечаток фактического состояния (блокеры + поколение lease +
  // HEAD ветки). Execute обязан предъявить его: если между preview и удалением
  // состояние изменилось (появились изменения, ожил процесс, workspace
  // перехватили), токен не совпадёт и разрушительный шаг не выполнится.
  async function cleanupPlan(id) {
    const record = await getRecord(id)
    const project = await projects.get(record.projectId)
    const reasons = []
    let leaseGeneration
    if (leases) {
      const lease = await leases.stateOf(id)
      leaseGeneration = lease.generation
      if (lease.state === 'ACTIVE') reasons.push({ code: 'WORKSPACE_LOCKED', message: 'Активный write-lease другой сессии.' })
    }
    if (processes) {
      const live = await processes.listForSession(record.sessionId, { aliveOnly: true })
      if (live.length > 0) reasons.push({ code: 'LIVE_PROCESSES', message: `Живые процессы сессии: ${String(live.length)}.` })
    }
    let dirtyCount = 0
    if (await pathExists(record.path)) {
      const dirty = await dirtyFiles(record.path)
      dirtyCount = dirty.length
      if (dirty.length > 0) reasons.push({ code: 'WORKSPACE_DIRTY', message: `Незакоммиченные изменения: ${String(dirty.length)} файл(ов).` })
    }
    let branchHead
    if (await branchExists(project.canonicalRepoPath, record.branch)) {
      branchHead = await revParse(project.canonicalRepoPath, record.branch)
      const merged = await isMergedInto(project.canonicalRepoPath, record.branch, project.defaultBranch)
      if (!merged) reasons.push({ code: 'BRANCH_NOT_MERGED', message: `Ветка «${record.branch}» не влита в «${project.defaultBranch}».` })
    }
    const planToken = createHash('sha256').update(JSON.stringify({
      id,
      blockers: reasons.map(reason => reason.code).sort(),
      leaseGeneration: leaseGeneration ?? null,
      dirtyCount,
      branchHead: branchHead ?? null,
    })).digest('hex').slice(0, 32)
    return {
      workspaceId: id,
      removable: reasons.length === 0,
      reasons,
      blockers: reasons.map(reason => reason.code),
      planToken,
      leaseGeneration,
    }
  }

  async function cleanupWorkspace(id, options = {}) {
    // Разрушительная часть целиком под локом workspace: между проверкой
    // блокеров и удалением никто не должен успеть изменить состояние
    // (create↔cleanup, cleanup↔cleanup, появление изменений).
    return store.withLock(`workspace-${id.replaceAll('--', '-')}`, () => cleanupWorkspaceLocked(id, options), { timeoutMs: 60_000 })
  }

  async function cleanupWorkspaceLocked(id, { confirmDirty = false, confirmUnmerged = false, ownerToken, expectedPlanToken } = {}) {
    const record = await getRecord(id)
    const project = await projects.get(record.projectId)
    const plan = await cleanupPlan(id)
    // Повторная валидация плана под локом (TOCTOU): если вызывающий видел
    // другой план, удалять нельзя — состояние успело измениться.
    if (expectedPlanToken !== undefined && expectedPlanToken !== plan.planToken) {
      throw new RuntimeError('WORKSPACE_BUSY', 'Состояние workspace изменилось после предпросмотра плана. Повторите проверку.', {
        workspaceId: id,
        blockers: plan.blockers,
      })
    }
    // Fencing: предъявленный токен должен быть токеном ТЕКУЩЕГО поколения
    // lease — «воскресший» writer со старым токеном ничего не удалит.
    if (ownerToken && leases) {
      const lease = await leases.stateOf(id)
      if (lease.state !== 'FREE') {
        await leases.assertFence(id, { ownerToken, generation: lease.generation })
      }
    }
    // Сначала ПРОВЕРЯЕМ все блокеры и только потом мутируем: отклонённый
    // cleanup не должен оставлять следов. Раньше снятие собственного lease
    // происходило до проверки dirty/unmerged, и неудачная попытка молча
    // разблокировала workspace, ломая последующий план.
    const ownsLease = Boolean(ownerToken && leases
      && (await leases.stateOf(id)).state !== 'FREE'
      && (await leases.assertFence(id, { ownerToken }).then(() => true, () => false)))
    for (const reason of plan.reasons) {
      if (reason.code === 'WORKSPACE_LOCKED') {
        // Свой lease можно снять токеном; чужой активный — нельзя никогда.
        if (!ownsLease) throw new RuntimeError('WORKSPACE_LOCKED', reason.message, { workspaceId: id })
      } else if (reason.code === 'LIVE_PROCESSES') {
        throw new RuntimeError('LIVE_PROCESSES', reason.message, { workspaceId: id })
      } else if (reason.code === 'WORKSPACE_DIRTY' && !confirmDirty) {
        throw new RuntimeError('WORKSPACE_DIRTY', `${reason.message} Подтвердите удаление явно (confirmDirty).`, { workspaceId: id })
      } else if (reason.code === 'BRANCH_NOT_MERGED' && !confirmUnmerged) {
        throw new RuntimeError('WORKSPACE_DIRTY', `${reason.message} Подтвердите удаление явно (confirmUnmerged).`, { workspaceId: id, branchNotMerged: true })
      }
    }
    // Все предусловия выполнены — с этого места операция мутирует состояние.
    if (ownsLease) await leases.releaseIfOwner(id, ownerToken)

    if (await pathExists(record.path)) {
      await removeWorktree(project.canonicalRepoPath, record.path, { force: confirmDirty })
      await rm(record.path, { recursive: true, force: true }).catch(() => {})
    }
    await pruneWorktrees(project.canonicalRepoPath)
    if (await branchExists(project.canonicalRepoPath, record.branch)) {
      const merged = await isMergedInto(project.canonicalRepoPath, record.branch, project.defaultBranch)
      if (merged || confirmUnmerged) {
        await deleteBranch(project.canonicalRepoPath, record.branch, { force: !merged })
      }
    }
    if (leases) await leases.forceRelease(id, { reason: 'workspace-cleanup' })
    await store.delete(WORKSPACES, id)
    await appendAudit(roots.stateRoot, 'workspace.deleted', { workspaceId: id, projectId: record.projectId })
    return { removed: true, workspaceId: id }
  }

  // --- Merge workflow -----------------------------------------------------
  // Изменения сессий объединяются только через Git. Merge выполняется в
  // отдельном merge-worktree; конфликт никогда не разрешается молча —
  // workspace остаётся с маркерами для ревью/merge-агента.

  async function startMerge({ projectId, sourceBranch, targetBranch }) {
    const project = await projects.get(projectId)
    if (!(await branchExists(project.canonicalRepoPath, sourceBranch))) {
      throw new RuntimeError('INVALID_INPUT', `Ветка-источник «${sourceBranch}» не найдена.`, { sourceBranch })
    }
    const target = targetBranch ?? project.defaultBranch
    if (!(await revParse(project.canonicalRepoPath, target))) {
      throw new RuntimeError('INVALID_INPUT', `Целевая ветка «${target}» не найдена.`, { targetBranch: target })
    }
    const checkedOutAt = await branchCheckedOutAt(project.canonicalRepoPath, target)
    if (checkedOutAt) {
      // Не двигаем ref под чужим рабочим деревом (не-bare canonical или
      // другой merge-worktree): честный отказ вместо тихой порчи.
      throw new RuntimeError('BRANCH_CHECKED_OUT', `Ветка «${target}» сейчас извлечена в «${checkedOutAt}» — объединить безопасно нельзя.`, { targetBranch: target, path: checkedOutAt })
    }

    const mergeId = generateId('merge')
    const path = mergePath(roots, projectId, mergeId)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await addWorktree(project.canonicalRepoPath, path, { branch: target, existingBranch: true })

    const result = await mergeRef(path, sourceBranch, {
      message: `Merge ${sourceBranch} into ${target} (Gildra)`,
    })
    const record = {
      schemaVersion: 1,
      mergeId,
      projectId,
      sourceBranch,
      targetBranch: target,
      path,
      status: result.merged ? 'merged' : 'conflict',
      conflicts: result.merged ? [] : result.conflicts,
      createdAt: new Date().toISOString(),
    }
    await store.write(MERGES, mergeId, record)
    await appendAudit(roots.stateRoot, 'merge.started', { mergeId, projectId, sourceBranch, targetBranch: target, status: record.status })

    if (result.merged) {
      await finalizeMergeWorktree(project, record)
      record.status = 'completed'
      await store.write(MERGES, mergeId, record)
      await appendAudit(roots.stateRoot, 'branch.merged', { mergeId, projectId, sourceBranch, targetBranch: target })
    }
    return record
  }

  async function getMerge(mergeId) {
    const record = await store.read(MERGES, assertSegment(mergeId, 'mergeId'))
    if (!record) throw new RuntimeError('WORKSPACE_NOT_FOUND', `Merge «${mergeId}» не найден.`, { mergeId })
    return record
  }

  // Завершение конфликтного merge после разрешения (пользователем или
  // merge-агентом): файлы должны быть разрешены в merge-worktree.
  async function completeMerge(mergeId) {
    const record = await getMerge(mergeId)
    if (record.status !== 'conflict') {
      throw new RuntimeError('INVALID_INPUT', 'Merge не находится в состоянии конфликта.', { mergeId, status: record.status })
    }
    // Разрешение = в конфликтных файлах не осталось merge-маркеров: caller
    // редактирует файлы, а стейджит и коммитит сам Runtime. Наличие маркеров —
    // единственный надёжный признак: после git add состояние U исчезает даже
    // у неразрешённого файла.
    const unresolved = []
    for (const file of record.conflicts) {
      const content = await readFile(join(record.path, file), 'utf8').catch(() => '')
      if (/^<{7}( |$)|^={7}$|^>{7}( |$)/m.test(content)) unresolved.push(file)
    }
    if (unresolved.length > 0) {
      throw new RuntimeError('MERGE_CONFLICT', `Остались неразрешённые конфликты: ${String(unresolved.length)} файл(ов).`, { files: unresolved })
    }
    await continueMergeCommit(record.path, `Merge ${record.sourceBranch} into ${record.targetBranch} (Gildra, conflicts resolved)`)
    const project = await projects.get(record.projectId)
    await finalizeMergeWorktree(project, record)
    record.status = 'completed'
    await store.write(MERGES, mergeId, record)
    await appendAudit(roots.stateRoot, 'branch.merged', { mergeId: record.mergeId, projectId: record.projectId, sourceBranch: record.sourceBranch, targetBranch: record.targetBranch, resolvedConflicts: true })
    return record
  }

  async function abortMerge(mergeId) {
    const record = await getMerge(mergeId)
    const project = await projects.get(record.projectId)
    if (await pathExists(record.path)) {
      await abortMergeIn(record.path)
      await removeWorktree(project.canonicalRepoPath, record.path, { force: true }).catch(() => {})
      await rm(record.path, { recursive: true, force: true }).catch(() => {})
    }
    await pruneWorktrees(project.canonicalRepoPath)
    record.status = 'aborted'
    await store.write(MERGES, mergeId, record)
    await appendAudit(roots.stateRoot, 'merge.aborted', { mergeId, projectId: record.projectId })
    return record
  }

  async function finalizeMergeWorktree(project, record) {
    await removeWorktree(project.canonicalRepoPath, record.path).catch(() => {})
    await rm(record.path, { recursive: true, force: true }).catch(() => {})
    await pruneWorktrees(project.canonicalRepoPath)
  }

  async function adoptExistingWorktrees(projectId) {
    // Recovery-помощник: список worktree, которые git знает, а store — нет.
    // Пути канонизируются с обеих сторон: git отдаёт realpath (на macOS
    // /private/var/…), а store может хранить симлинк-вариант (/var/…).
    const canonicalPath = async path => {
      try {
        return await realpath(path)
      } catch {
        return path
      }
    }
    const project = await projects.get(projectId)
    const known = new Set(await Promise.all(
      (await listRecords({ projectId })).map(record => canonicalPath(record.path)),
    ))
    const unknown = []
    for (const entry of await listWorktrees(project.canonicalRepoPath)) {
      if (entry.bare) continue
      if (!known.has(await canonicalPath(entry.path))) unknown.push(entry)
    }
    return unknown
  }

  return {
    createWorkspace,
    getRecord,
    listRecords,
    workspaceStatus,
    cleanupPlan,
    cleanupWorkspace,
    startMerge,
    getMerge,
    completeMerge,
    abortMerge,
    adoptExistingWorktrees,
    limits,
  }
}
