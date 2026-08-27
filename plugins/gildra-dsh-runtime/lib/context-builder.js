// Task Context Builder: компактный контекст для writer/reviewer (§32–§35,
// §53–§55 плана AI-качества).
//
// Задача модуля — РЕЛЕВАНТНОСТЬ, а не полнота: агент получает identity
// workspace, критерии, scope, доверенные команды, ПУТИ policy-файлов и ADR,
// касающихся затронутых областей, предупреждения о пересечениях и upstream —
// и не получает README целиком, весь git-history и чужие задачи. Загрязнение
// контекста — это не «лишние токены», а прямой источник плохих правок:
// агент, читающий нерелевантное, начинает править нерелевантное.

import { agentContextBlock } from './runtime-env.js'
import { qualityPolicyOf } from './quality.js'

const MAX_CONTEXT_CHARS = 8000

// ADR релевантен, если токены его имени пересекаются с сегментами затронутых
// областей: adr/0007-lease-fencing.md ↔ lib/leases.js. Дешёвая эвристика
// вместо чтения всех ADR подряд.
export function relevantAdrFiles(adrFiles, areas) {
  const areaTokens = new Set()
  for (const area of areas) {
    for (const segment of String(area).toLowerCase().split(/[/.]/)) {
      for (const token of segment.split(/[-_*]+/)) {
        if (token.length >= 4) areaTokens.add(token.replace(/s$/, ''))
      }
    }
  }
  return adrFiles.filter(file => {
    const name = String(file).toLowerCase().split('/').at(-1).replace(/\.md$/, '')
    return name.split(/[-_]+/).some(token => token.length >= 4 && areaTokens.has(token.replace(/s$/, '')))
  })
}

export function createContextBuilder({ projects, tasks, workspaces, sessions, repoIntel, upstream }) {
  async function buildTaskContext(taskId) {
    const task = await tasks.getTask(taskId)
    const project = await projects.get(task.projectId)
    const policy = qualityPolicyOf(project)
    const profile = repoIntel ? await repoIntel.getProfile(task.projectId).catch(() => undefined) : undefined
    const workspace = task.workspaceId ? await workspaces.getRecord(task.workspaceId).catch(() => undefined) : undefined

    const areas = [
      ...(task.expectedAreas ?? []),
      ...(task.analysis?.changedFiles ?? []),
    ]
    const adr = profile ? relevantAdrFiles(profile.adrFiles ?? [], areas) : []
    const overlaps = await tasks.overlapsFor(task.projectId, {
      claims: task.claims ?? [],
      files: task.analysis?.changedFiles ?? [],
      excludeTaskId: taskId,
    })
    const trusted = repoIntel ? repoIntel.trustedCommands(project) : []

    const lines = []
    if (workspace) {
      const session = sessions && workspace.sessionId
        ? await sessions.getSession(workspace.sessionId).catch(() => ({ sessionId: workspace.sessionId }))
        : { sessionId: workspace.sessionId }
      lines.push(agentContextBlock({ session, workspace, project }))
      lines.push('')
    }
    lines.push(`Task: ${task.title} [${task.kind}] — ${task.status}`)
    if ((task.acceptanceCriteria ?? []).length > 0) {
      lines.push('Acceptance criteria:')
      for (const criterion of task.acceptanceCriteria) lines.push(`- ${criterion}`)
    }
    if ((task.expectedAreas ?? []).length > 0) {
      lines.push(`Expected scope: ${task.expectedAreas.join(', ')}`)
      lines.push('Изменение вне scope потребует объяснения (UNEXPECTED_CHANGE).')
    }
    if (trusted.length > 0) {
      lines.push('Validation commands (единственные доверенные):')
      for (const command of trusted) lines.push(`- ${command.id}: ${command.argv.join(' ')}`)
    }
    lines.push(`Definition of Done: required = ${policy.required.join(', ')}; blocking findings = ${policy.reviewGate.blocking.join('/')}.`)
    if (policy.protectedAreas.length > 0) {
      lines.push(`Protected areas (отдельное ревью): ${policy.protectedAreas.join(', ')}`)
    }

    // Policy-файлы и ADR — ПУТЯМИ: агент читает их сам и только нужные (§32).
    const policyPaths = (profile?.policyFiles ?? []).filter(path => path !== 'README.md')
    if (policyPaths.length > 0) lines.push(`Project rules (прочитай перед правкой): ${policyPaths.join(', ')}`)
    if ((profile?.architectureDocs ?? []).length > 0) lines.push(`Architecture: ${profile.architectureDocs.join(', ')}`)
    if (adr.length > 0) lines.push(`Relevant ADR: ${adr.join(', ')}`)

    if (overlaps.length > 0) {
      lines.push('Team overlap warning:')
      for (const overlap of overlaps.slice(0, 5)) {
        lines.push(`- задача ${overlap.taskId} (${overlap.owner ?? '?'}) работает в ${overlap.area} [${overlap.mode}]`)
      }
      lines.push('Скоординируйтесь прежде, чем менять пересекающиеся файлы.')
    }
    if (task.upstream && task.upstream.status !== 'UP_TO_DATE') {
      lines.push(`Upstream: ${task.upstream.status} — ${task.upstream.recommendation}`)
    }
    lines.push('Prefer repository evidence over assumptions: сперва тесты, поиск и Git, потом правки.')

    let text = lines.join('\n')
    if (text.length > MAX_CONTEXT_CHARS) text = `${text.slice(0, MAX_CONTEXT_CHARS)}\n…(контекст усечён)`
    return {
      text,
      structured: {
        taskId: task.taskId,
        criteria: task.acceptanceCriteria ?? [],
        expectedAreas: task.expectedAreas ?? [],
        trustedCommands: trusted,
        policyFiles: policyPaths,
        adrFiles: adr,
        overlaps,
        upstream: task.upstream,
        required: policy.required,
      },
    }
  }

  return { buildTaskContext }
}
