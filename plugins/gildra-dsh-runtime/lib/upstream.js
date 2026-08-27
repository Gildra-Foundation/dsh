// Upstream Awareness: сдвиг цели относительно закреплённой базы задачи
// (§23–§25 плана AI-качества).
//
// База задачи — immutable baseSha. Runtime не считает голое «main ушёл на 13
// коммитов» поводом для паники и НИКОГДА не делает rebase сам: он определяет,
// ПЕРЕСЕКАЕТСЯ ли upstream-изменение с работой задачи, и выдаёт рекомендацию.
// Решение — за человеком/агентом (controlled action).
//
// Релевантность (MVP, без LLM): upstream-файлы против
//   1) expected areas задачи;
//   2) фактически изменённых файлов задачи;
//   3) import-соседей изменённых файлов (1 шаг по графу).

import { RuntimeError } from './errors.js'
import { appendAudit } from './audit.js'
import { git, revParse } from './gitx.js'
import { matchesAny, normalizePath } from './globs.js'
import { resolveImport } from './claims.js'

const MAX_UPSTREAM_FILES = 2000

function withoutExtension(path) {
  return normalizePath(path).replace(/\.[a-z]+$/i, '')
}

export function createUpstreamMonitor({ roots, projects, tasks }) {
  async function assessUpstream(taskId) {
    const task = await tasks.getTask(taskId)
    if (!task.baseSha) {
      throw new RuntimeError('INVALID_INPUT', 'У задачи нет baseSha — привяжите workspace.', { taskId })
    }
    const project = await projects.get(task.projectId)
    const target = task.baseBranch ?? project.defaultBranch
    const targetSha = await revParse(project.canonicalRepoPath, target)
    if (!targetSha) {
      throw new RuntimeError('INVALID_INPUT', `Целевая ветка «${target}» не найдена.`, { target })
    }

    const counted = await git(['-C', project.canonicalRepoPath, 'rev-list', '--count', `${task.baseSha}..${targetSha}`])
    const behind = Number(counted.stdout.trim()) || 0
    let assessment
    if (behind === 0) {
      assessment = { status: 'UP_TO_DATE', behind: 0, target, targetSha }
    } else {
      const changed = await git(['-C', project.canonicalRepoPath, 'diff', '--no-ext-diff', '--name-only', `${task.baseSha}..${targetSha}`])
      const upstreamFiles = changed.stdout.split('\n').filter(Boolean).map(normalizePath).slice(0, MAX_UPSTREAM_FILES)

      const relevantByScope = upstreamFiles.filter(file => matchesAny(file, task.expectedAreas ?? []))
      const taskFiles = new Set((task.analysis?.changedFiles ?? []).map(normalizePath))
      const relevantByFiles = upstreamFiles.filter(file => taskFiles.has(file))
      // Import-соседи: upstream тронул файл, который импортируют изменённые
      // файлы задачи.
      const neighbourTargets = new Set()
      for (const [file, specifiers] of Object.entries(task.analysis?.importsOfChanged ?? {})) {
        for (const specifier of specifiers) neighbourTargets.add(withoutExtension(resolveImport(file, specifier)))
      }
      const relevantByImports = upstreamFiles.filter(file => neighbourTargets.has(withoutExtension(file)))

      const relevantFiles = [...new Set([...relevantByScope, ...relevantByFiles, ...relevantByImports])]
      assessment = {
        status: relevantFiles.length > 0 ? 'UPSTREAM_RELEVANT' : 'UPSTREAM_UNRELATED',
        behind,
        target,
        targetSha,
        upstreamFiles: upstreamFiles.slice(0, 50),
        relevantFiles: relevantFiles.slice(0, 50),
        // §25: рекомендация вместо самовольного rebase.
        recommendation: relevantFiles.length > 0
          ? `Цель «${target}» ушла на ${String(behind)} коммитов и изменила связанные файлы. Рекомендуется обновить базу (merge/rebase решением владельца) и перепроверить.`
          : `Цель «${target}» ушла на ${String(behind)} коммитов, пересечений с задачей не найдено.`,
      }
    }
    const record = { ...assessment, checkedAt: new Date().toISOString() }
    await tasks.saveTask({ ...(await tasks.getTask(taskId)), upstream: record })
    await appendAudit(roots.stateRoot, 'task.upstream', { taskId, status: record.status, behind: record.behind })
    return record
  }

  return { assessUpstream }
}
