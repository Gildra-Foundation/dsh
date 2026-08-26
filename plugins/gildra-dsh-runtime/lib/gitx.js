// Git-примитивы Gildra Runtime.
//
// Только execFile (никакого shell): аргументы уходят отдельным argv, пути с
// пробелами безопасны на всех платформах. Все операции с ветками/worktree
// идут через эти помощники — сырой git из UI/API не выполняется.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { RuntimeError } from './errors.js'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 5 * 60 * 1000

export async function git(args, options = {}) {
  try {
    return await execFileAsync('git', args, {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
      timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new RuntimeError('GIT_UNAVAILABLE', 'Git не найден. Установите Git и повторите попытку.')
    }
    if (options.allowFailure) return { stdout: String(error?.stdout ?? ''), stderr: String(error?.stderr ?? ''), failed: true, exitCode: error?.code }
    const detail = String(error?.stderr ?? error?.message ?? '')
      .split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) ?? ''
    throw new RuntimeError('GIT_FAILED', detail ? `git ${args[0] ?? ''}: ${detail.slice(0, 400)}` : `git ${args[0] ?? ''} завершился с ошибкой.`, {
      args: args.slice(0, 6),
    })
  }
}

// Идентичность коммитов, создаваемых самим Runtime (merge-коммиты), не должна
// зависеть от глобального git config пользователя.
export function identityArgs(identity = {}) {
  return [
    '-c', `user.name=${identity.name ?? 'Gildra Runtime'}`,
    '-c', `user.email=${identity.email ?? 'runtime@gildra.local'}`,
  ]
}

export async function isGitRepository(path) {
  const result = await git(['-C', path, 'rev-parse', '--git-dir'], { allowFailure: true })
  return !result.failed
}

export async function initBareRepository(path) {
  await git(['init', '--bare', '--initial-branch=main', path])
}

export async function detectDefaultBranch(repoPath) {
  const result = await git(['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { allowFailure: true })
  if (result.failed) return undefined
  return result.stdout.trim() || undefined
}

export async function revParse(repoPath, ref) {
  const result = await git(['-C', repoPath, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFailure: true })
  if (result.failed) return undefined
  return result.stdout.trim() || undefined
}

export async function branchExists(repoPath, branch) {
  return (await revParse(repoPath, `refs/heads/${branch}`)) !== undefined
}

export async function addWorktree(repoPath, worktreePath, { branch, baseRef, existingBranch = false }) {
  if (existingBranch) {
    await git(['-C', repoPath, 'worktree', 'add', worktreePath, branch])
    return
  }
  await git(['-C', repoPath, 'worktree', 'add', '-b', branch, worktreePath, baseRef])
}

export async function removeWorktree(repoPath, worktreePath, { force = false } = {}) {
  await git(['-C', repoPath, 'worktree', 'remove', ...(force ? ['--force'] : []), worktreePath])
}

export async function pruneWorktrees(repoPath) {
  await git(['-C', repoPath, 'worktree', 'prune'], { allowFailure: true })
}

export async function listWorktrees(repoPath) {
  const { stdout } = await git(['-C', repoPath, 'worktree', 'list', '--porcelain'])
  const entries = []
  let current = null
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length) }
      entries.push(current)
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (current && line === 'bare') {
      current.bare = true
    } else if (current && line === 'detached') {
      current.detached = true
    }
  }
  return entries
}

export async function branchCheckedOutAt(repoPath, branch) {
  const worktrees = await listWorktrees(repoPath)
  return worktrees.find(entry => entry.branch === branch && !entry.bare)?.path
}

export async function deleteBranch(repoPath, branch, { force = false } = {}) {
  await git(['-C', repoPath, 'branch', force ? '-D' : '-d', branch])
}

export async function currentBranch(worktreePath) {
  const result = await git(['-C', worktreePath, 'symbolic-ref', '--short', 'HEAD'], { allowFailure: true })
  if (result.failed) return undefined
  return result.stdout.trim() || undefined
}

export async function dirtyFiles(worktreePath) {
  const { stdout } = await git(['-C', worktreePath, 'status', '--porcelain'])
  return stdout.split(/\r?\n/).filter(Boolean)
}

export async function commitAll(worktreePath, message, identity = {}) {
  await git(['-C', worktreePath, 'add', '-A'])
  await git(['-C', worktreePath, ...identityArgs(identity), 'commit', '-m', message])
  return (await revParse(worktreePath, 'HEAD'))
}

export async function aheadBehind(repoPath, baseRef, ref) {
  const result = await git(
    ['-C', repoPath, 'rev-list', '--left-right', '--count', `${baseRef}...${ref}`],
    { allowFailure: true },
  )
  if (result.failed) return { ahead: 0, behind: 0 }
  const [behind, ahead] = result.stdout.trim().split(/\s+/).map(Number)
  return { ahead: ahead || 0, behind: behind || 0 }
}

export async function isMergedInto(repoPath, branch, targetRef) {
  const result = await git(['-C', repoPath, 'merge-base', '--is-ancestor', branch, targetRef], { allowFailure: true })
  return !result.failed
}

// Merge выполняется внутри merge-worktree; при конфликте возвращает список
// конфликтующих файлов и оставляет worktree для разрешения — Runtime никогда
// не разрешает конфликт молча.
export async function mergeRef(worktreePath, sourceRef, { message, identity } = {}) {
  const result = await git([
    '-C', worktreePath, ...identityArgs(identity),
    'merge', '--no-ff', ...(message ? ['-m', message] : []), sourceRef,
  ], { allowFailure: true })
  if (!result.failed) return { merged: true }
  const { stdout } = await git(['-C', worktreePath, 'diff', '--name-only', '--diff-filter=U'])
  const conflicts = stdout.split(/\r?\n/).filter(Boolean)
  if (conflicts.length === 0) {
    const detail = String(result.stderr || result.stdout || '').split(/\r?\n/).filter(Boolean).at(-1) ?? ''
    throw new RuntimeError('GIT_FAILED', `git merge: ${detail.slice(0, 400)}`)
  }
  return { merged: false, conflicts }
}

export async function abortMergeIn(worktreePath) {
  await git(['-C', worktreePath, 'merge', '--abort'], { allowFailure: true })
}

export async function continueMergeCommit(worktreePath, message, identity = {}) {
  await git(['-C', worktreePath, 'add', '-A'])
  await git(['-C', worktreePath, ...identityArgs(identity), 'commit', '--no-edit', ...(message ? ['-m', message] : [])])
  return (await revParse(worktreePath, 'HEAD'))
}

export async function fetchOrigin(repoPath) {
  await git(['-C', repoPath, 'fetch', '--all', '--prune'])
}

export async function cloneBare(url, targetPath) {
  await git(['clone', '--bare', '--', url, targetPath], { timeoutMs: 20 * 60 * 1000 })
}
