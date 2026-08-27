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
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import { assertSegment, assertWritableBranch, generateId, sessionBranch } from './ids.js'
import { mergePath, workspaceKey, workspacePath } from './paths.js'
import { appendAudit } from './audit.js'
import {
  abortMergeIn,
  addWorktree,
  aheadBehind,
  branchCheckedOutAt,
  branchExists,
  commitParent,
  continueMergeCommit,
  currentBranch,
  deleteBranch,
  dirtyFiles,
  isMergedInto,
  listWorktrees,
  mergeRef,
  pruneWorktrees,
  enterRepoMutationScope,
  removeWorktree,
  revParse,
  updateRefCas,
} from './gitx.js'

const WORKSPACES = 'workspaces'
const MERGES = 'merges'
const REPO_LOCK_TIMEOUT_MS = 60_000

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

export function createWorkspaceManager({ store, roots, projects, leases, processes, journal, env = process.env }) {
  const limits = {
    perUser: limit(env, 'GILDRA_DSH_MAX_WORKSPACES_PER_USER', 32),
    perProject: limit(env, 'GILDRA_DSH_MAX_WORKSPACES_PER_PROJECT', 128),
  }

  async function getRecord(id) {
    const record = await store.read(WORKSPACES, id)
    if (!record) throw new RuntimeError('WORKSPACE_NOT_FOUND', `Workspace «${id}» не найден.`, { workspaceId: id })
    return record
  }

  // ЕДИНСТВЕННАЯ точка сериализации мутаций канонического репозитория:
  // worktree add/remove/prune, создание и удаление веток, перемещение целевой
  // ветки merge. Раньше этот лок держал только create, а cleanup работал под
  // локом workspace-<id>, merge — вообще без лока, поэтому два git-процесса
  // одновременно правили метаданные одного репозитория. На POSIX это обычно
  // сходило с рук (lock-файлы + атомарный rename), на Windows соседний git
  // умирал на чтении config — что и поймал стресс-тест в CI.
  //
  // Порядок захвата всегда workspace-<id> → repo-<projectId> и никогда
  // обратный, поэтому взаимная блокировка невозможна.
  //
  // Таймаут щедрый (60 с, как у cleanup): под локом идут операции с диском и
  // git, и на медленной машине с десятками сессий очередь должна ждать, а не
  // отказывать. Очередь всё же конечна — это осознанный предсказуемый отказ.
  function withRepoLock(projectId, action) {
    // Опечатка в имени поля дала бы лок «repo-undefined»: он бы не падал, но
    // сериализовал бы все проекты между собой и НЕ защищал бы нужный. Такую
    // ошибку тесты не заметят, поэтому проверяем явно.
    if (typeof projectId !== 'string' || projectId === '') {
      throw new RuntimeError('INTERNAL', 'Внутренняя ошибка: лок репозитория без projectId.', {})
    }
    // Лок + scope: межпроцессное исключение даёт mkdir-лок, а scope (§57)
    // доказывает мутирующим git-помощникам, что вызов пришёл через него.
    return store.withLock(`repo-${projectId}`, () => enterRepoMutationScope({ projectId }, action), { timeoutMs: REPO_LOCK_TIMEOUT_MS })
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
    const project = projects.assertUsable ? projects.assertUsable(await projects.get(projectId)) : await projects.get(projectId)
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

    await withRepoLock(projectId, async () => {
      if (await branchExists(project.canonicalRepoPath, targetBranch)) {
        throw new RuntimeError('WORKSPACE_EXISTS', `Ветка «${targetBranch}» уже существует.`, { branch: targetBranch })
      }
      await addWorktree(project.canonicalRepoPath, path, { branch: targetBranch, baseRef: baseSha })
    })

    const record = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
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

    await withRepoLock(record.projectId, async () => {
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
    })
    if (leases) await leases.forceRelease(id, { reason: 'workspace-cleanup' })
    await store.delete(WORKSPACES, id)
    await appendAudit(roots.stateRoot, 'workspace.deleted', { workspaceId: id, projectId: record.projectId })
    return { removed: true, workspaceId: id }
  }

  // --- Merge workflow -----------------------------------------------------
  // Изменения сессий объединяются только через Git. Merge выполняется в
  // отдельном merge-worktree; конфликт никогда не разрешается молча —
  // workspace остаётся с маркерами для ревью/merge-агента.

  // Merge — самая опасная операция, поэтому у неё явная state machine
  // (§19): PREPARING → MERGING → {COMPLETED | CONFLICT → COMPLETED | ABORTED}
  // и собственная запись в operation journal. Целевая ветка двигается ТОЛЬКО
  // последним шагом; при падении на любом шаге target остаётся нетронутым, а
  // конфликтные маркеры сохраняются для ревью.
  async function startMerge({ projectId, sourceBranch, targetBranch, policy = {} }) {
    const project = projects.assertUsable ? projects.assertUsable(await projects.get(projectId)) : await projects.get(projectId)
    // Источник закрепляется НЕИЗМЕНЯЕМЫМ коммитом в момент старта (§56):
    // fetch или перехват, сдвинувший ветку-источник посреди операции, не
    // изменит уже валидированное содержимое merge.
    const sourceSha = await revParse(project.canonicalRepoPath, `refs/heads/${sourceBranch}`)
    if (!sourceSha) {
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

    // Merge-policy (§21) конфигурируется, а не захардкожена под конкретный
    // проект. Дефолт консервативный: сливаем только чистый workspace с
    // реальными коммитами.
    const effectivePolicy = {
      requireClean: true,
      requireCommits: true,
      ...(project.mergePolicy ?? {}),
      ...policy,
    }
    const sourceWorkspace = (await listRecords({ projectId })).find(record => record.branch === sourceBranch)
    if (sourceWorkspace && effectivePolicy.requireClean && await pathExists(sourceWorkspace.path)) {
      const dirty = await dirtyFiles(sourceWorkspace.path)
      if (dirty.length > 0) {
        throw new RuntimeError('WORKSPACE_DIRTY', `В workspace ветки «${sourceBranch}» есть незакоммиченные изменения (${String(dirty.length)}): закоммитьте их перед объединением.`, {
          sourceBranch,
          dirtyFiles: dirty.length,
        })
      }
    }
    // Свежесть базы (§20): показываем, насколько источник отстал от цели, и
    // не выдаём старую базу за актуальную.
    const counts = await aheadBehind(project.canonicalRepoPath, target, sourceSha)
    if (effectivePolicy.requireCommits && counts.ahead === 0) {
      throw new RuntimeError('INVALID_INPUT', `Ветка «${sourceBranch}» не содержит новых коммитов относительно «${target}».`, {
        sourceBranch, targetBranch: target, ...counts,
      })
    }

    const mergeId = generateId('merge')
    const path = mergePath(roots, projectId, mergeId)
    const targetBefore = await revParse(project.canonicalRepoPath, target)
    const operation = journal ? await journal.begin('MERGE', mergeId, { projectId, sourceBranch, targetBranch: target }) : undefined
    let record = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      mergeId,
      projectId,
      sourceBranch,
      sourceSha,
      targetBranch: target,
      path,
      status: 'PREPARING',
      operationId: operation?.operationId,
      // Точка отката: до этого коммита target можно вернуть, если понадобится
      // разбирать последствия сбоя вручную.
      targetBefore,
      behindTarget: counts.behind,
      aheadOfTarget: counts.ahead,
      conflicts: [],
      createdAt: new Date().toISOString(),
    }
    await store.write(MERGES, mergeId, record)

    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await withRepoLock(project.projectId, () => addWorktree(project.canonicalRepoPath, path, { branch: target, existingBranch: true }))
      record = { ...record, status: 'MERGING' }
      await store.write(MERGES, mergeId, record)
      await operation?.advance('MERGING', { path })

      // Сливается закреплённый SHA, а не имя ветки: имя остаётся только в
      // сообщении коммита.
      const result = await mergeRef(path, sourceSha, {
        message: `Merge ${sourceBranch} into ${target} (Gildra)`,
      })
      if (!result.merged) {
        record = { ...record, status: 'CONFLICT', conflicts: result.conflicts }
        await store.write(MERGES, mergeId, record)
        await operation?.advance('CONFLICT', { conflicts: result.conflicts.length })
        await appendAudit(roots.stateRoot, 'merge.conflict', {
          mergeId, projectId, sourceBranch, targetBranch: target, conflicts: result.conflicts.length,
        })
        return record
      }
      record = await finalizeMerge(project, record, operation)
      return record
    } catch (error) {
      record = { ...record, status: 'FAILED', error: error instanceof Error ? error.message : String(error) }
      await store.write(MERGES, mergeId, record)
      await operation?.fail(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  // Последний атомарный логический шаг: merge-коммит уже в ветке target
  // внутри merge-worktree, остаётся убрать worktree. Падение здесь не портит
  // target — результат уже зафиксирован в git.
  async function finalizeMerge(project, record, operation) {
    await operation?.advance('MERGE_COMMITTED')
    const targetAfter = await revParse(project.canonicalRepoPath, record.targetBranch)
    // §56, доказано экспериментом: если target сдвинули между worktree add и
    // merge-коммитом (например fetch принёс чужой коммит X), HEAD worktree
    // резолвится в НОВЫЙ tip, а дерево остаётся старым — merge-коммит
    // сохраняет X в истории, но МОЛЧА выбрасывает его содержимое. Ловим это
    // по первому родителю: у честного merge он равен targetBefore. Плохой
    // коммит снимается атомарным CAS (цель возвращается на чужой tip), а
    // операция падает честной ошибкой вместо тихой потери данных.
    const parentOfMerge = targetAfter ? await commitParent(project.canonicalRepoPath, targetAfter) : undefined
    if (record.targetBefore && targetAfter && parentOfMerge !== record.targetBefore) {
      await withRepoLock(record.projectId, () => updateRefCas(project.canonicalRepoPath, record.targetBranch, parentOfMerge, targetAfter))
      await finalizeMergeWorktree(project, record, { force: true })
      const failed = {
        ...record,
        status: 'FAILED',
        targetMoved: true,
        error: `Ветка «${record.targetBranch}» была сдвинута другой операцией во время merge; merge отменён, чужие изменения сохранены.`,
      }
      await store.write(MERGES, record.mergeId, failed)
      if (operation) await operation.fail('MERGE_TARGET_MOVED')
      else if (journal && record.operationId) await journal.forget(record.operationId)
      await appendAudit(roots.stateRoot, 'merge.target-moved', {
        mergeId: record.mergeId, projectId: record.projectId, targetBranch: record.targetBranch,
      })
      throw new RuntimeError('MERGE_TARGET_MOVED', `Целевая ветка «${record.targetBranch}» изменилась во время merge (например, fetch). Обновите базу и повторите объединение.`, {
        mergeId: record.mergeId, targetBefore: record.targetBefore, movedTo: parentOfMerge,
      })
    }
    await finalizeMergeWorktree(project, record)
    const completed = { ...record, status: 'COMPLETED', targetAfter, completedAt: new Date().toISOString() }
    await store.write(MERGES, record.mergeId, completed)
    if (operation) await operation.complete()
    // Разрешение конфликта происходит уже в другом вызове (а после
    // перезапуска Runtime — и в другом процессе), где живой ручки операции
    // нет: закрываем запись журнала по её идентификатору.
    else if (journal && record.operationId) await journal.forget(record.operationId)
    await appendAudit(roots.stateRoot, 'branch.merged', {
      mergeId: record.mergeId,
      projectId: record.projectId,
      sourceBranch: record.sourceBranch,
      targetBranch: record.targetBranch,
    })
    return completed
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
    if (record.status !== 'CONFLICT') {
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
    // Тот же финальный шаг, что и у бесконфликтного merge: одна точка, где
    // результат становится видимым, и один аудит-след.
    return finalizeMerge(project, { ...record, resolvedConflicts: true })
  }

  async function abortMerge(mergeId) {
    const record = await getMerge(mergeId)
    const project = await projects.get(record.projectId)
    if (await pathExists(record.path)) await abortMergeIn(record.path)
    await withRepoLock(record.projectId, async () => {
      if (await pathExists(record.path)) {
        await removeWorktree(project.canonicalRepoPath, record.path, { force: true }).catch(() => {})
        await rm(record.path, { recursive: true, force: true }).catch(() => {})
      }
      await pruneWorktrees(project.canonicalRepoPath)
    })
    const aborted = { ...record, status: 'ABORTED', abortedAt: new Date().toISOString() }
    await store.write(MERGES, mergeId, aborted)
    if (journal && record.operationId) await journal.forget(record.operationId)
    await appendAudit(roots.stateRoot, 'merge.aborted', { mergeId, projectId: record.projectId })
    return aborted
  }

  // Список merge-операций для UI: показать конфликты и предложить действие.
  async function listMerges(filter = {}) {
    const rows = []
    for (const id of await store.list(MERGES)) {
      const record = await store.read(MERGES, id)
      if (!record) continue
      if (filter.projectId && record.projectId !== filter.projectId) continue
      if (filter.activeOnly && ['COMPLETED', 'ABORTED'].includes(record.status)) continue
      rows.push(record)
    }
    return rows
  }

  async function finalizeMergeWorktree(project, record, { force = false } = {}) {
    await withRepoLock(record.projectId, async () => {
      // force нужен аварийной ветке MERGE_TARGET_MOVED: после CAS-отката
      // цель указывает не на HEAD worktree, дерево выглядит «грязным», и
      // remove без force тихо оставил бы worktree держать target извлечённой.
      await removeWorktree(project.canonicalRepoPath, record.path, { force }).catch(() => {})
      await rm(record.path, { recursive: true, force: true }).catch(() => {})
      await pruneWorktrees(project.canonicalRepoPath)
    })
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
    const project = projects.assertUsable ? projects.assertUsable(await projects.get(projectId)) : await projects.get(projectId)
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
    listMerges,
    completeMerge,
    abortMerge,
    adoptExistingWorktrees,
    limits,
  }
}
