// Gildra Runtime: серверная доменная логика мультисессионной работы.
// См. docs/architecture.md, раздел «2а. Gildra Runtime»: overlay отображает и
// вызывает API, а как создавать worktree, выдавать lease, порты и выполнять
// merge — решает только этот плагин.

import { runtimeRoots } from './paths.js'
import { registerRuntimeRoutes } from './api.js'

export const name = 'gildra-runtime'
export const inject = ['systemPrompt', 'tools', 'webServer']

export const ISOLATION_RULES = [
  'You are working inside a managed Gildra workspace (an isolated git worktree with its own session branch).',
  'Never switch branches (git checkout/switch) inside a managed workspace: the branch IS the session.',
  'Never work outside the workspace root and never touch another session worktree.',
  'Never push or commit directly to protected branches (main, master, production, release/*): changes reach them only through the reviewed merge workflow.',
  'Never run git reset --hard or git clean -fdx outside your own workspace root, and only after explicit user confirmation inside it.',
  'Never remove another worktree or delete another session branch.',
].join(' ')

// Опасные git-команды, ломающие изоляцию сессий. Guard консервативен:
// срабатывает только когда команда затрагивает управляемый корень workspaces
// (по cwd вызова или по упоминанию пути в самой команде) — обычная работа с
// git вне управляемых воркспейсов не ограничивается. Это дополнение к
// системным правилам ISOLATION_RULES, а не их замена.
const DANGEROUS_GIT_PATTERNS = [
  /\bgit\b[^\n;&|]*\b(?:checkout|switch)\b/i,
  /\bgit\b[^\n;&|]*\breset\b[^\n;&|]*--hard\b/i,
  /\bgit\b[^\n;&|]*\bclean\b[^\n;&|]*\s-[a-z]*f/i,
  /\bgit\b[^\n;&|]*\bworktree\s+remove\b/i,
  /\bgit\b[^\n;&|]*\bbranch\b[^\n;&|]*\s-[dD]\b/i,
]

export function guardWorkspaceCommand(exec, roots = runtimeRoots()) {
  if (exec?.name !== 'bash' && exec?.name !== 'shell') return undefined
  const args = exec.arguments
  if (!args || typeof args !== 'object') return undefined
  const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : ''
  if (!command) return undefined
  const cwd = typeof args.cwd === 'string' ? args.cwd : typeof args.workdir === 'string' ? args.workdir : ''
  const touchesManaged = cwd.startsWith(roots.workspacesRoot) || command.includes(roots.workspacesRoot)
  if (!touchesManaged) return undefined
  if (DANGEROUS_GIT_PATTERNS.some(pattern => pattern.test(command))) {
    return 'This command would break Gildra session isolation (branch switch, hard reset, force clean, branch delete or worktree removal inside a managed workspace). Use the Gildra workspace API and merge workflow instead, or ask the user to perform this explicitly outside the managed workspace.'
  }
  return undefined
}

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'gildra:workspace-isolation',
    order: 117,
    text: ISOLATION_RULES,
  }), 'gildra-runtime: workspace isolation rules')

  ctx.effect(() => ctx.tools.guard((exec) => guardWorkspaceCommand(exec)), 'gildra-runtime: dangerous git guard')

  ctx.effect(() => registerRuntimeRoutes(ctx), 'gildra-runtime: workspace API routes')
}
