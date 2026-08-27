// Merge workflow: объединение изменений сессий строго через Git.
//
// Выделен из workspaces.js по результату Modularity Analyzer на самом Gildra:
// «workspace lifecycle» и «merge state machine» — разные ответственности,
// жившие в одном 600-строчном файле. Экстракция хирургическая (§11):
// characterization — merge.test, fetch-race.test, e2e-наборы; публичный API
// workspaces-менеджера не изменился (реэкспорт).
//
// Контракты, которые модуль обязан сохранять (docs/runtime-reliability.md):
// source закреплён SHA при старте; target двигается только merge-коммитом;
// сдвиг target → MERGE_TARGET_MOVED с CAS-откатом; конфликты никогда не
// разрешаются молча; worktree-операции — только под repo-локом.

import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { RuntimeError } from './errors.js'
import { assertSegment, generateId } from './ids.js'
import { mergePath } from './paths.js'
import { appendAudit } from './audit.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import {
  abortMergeIn,
  addWorktree,
  aheadBehind,
  branchCheckedOutAt,
  commitParent,
  continueMergeCommit,
  dirtyFiles,
  mergeRef,
  pruneWorktrees,
  removeWorktree,
  revParse,
  updateRefCas,
} from './gitx.js'

const MERGES = 'merges'

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function createMergeWorkflow({ store, roots, projects, journal, withRepoLock, listRecords }) {
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

  return { startMerge, getMerge, completeMerge, abortMerge, listMerges }
}
