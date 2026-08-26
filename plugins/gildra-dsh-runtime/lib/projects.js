// Project Registry: канонические Git-репозитории Gildra Runtime.
//
// Один canonical-репозиторий обслуживает множество worktree; сессии никогда
// не клонируют проект заново. Fetch централизован и защищён межпроцессным
// локом. MVP-ограничения задокументированы в записи проекта
// (limitations: submodules/LFS не поддерживаются гарантированно, shallow не
// используется) — честно, вместо тихой полу-поддержки.

import { access } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { RuntimeError } from './errors.js'
import { DEFAULT_PROTECTED_BRANCHES, assertBranchName, assertSegment, sanitizeSegment } from './ids.js'
import { repoPath } from './paths.js'
import {
  cloneBare,
  detectDefaultBranch,
  fetchOrigin,
  isGitRepository,
  revParse,
} from './gitx.js'
import { appendAudit } from './audit.js'

const PROJECTS = 'projects'
const CLONE_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org'])

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function cloneUrl(raw) {
  let parsed
  try {
    parsed = new URL(String(raw))
  } catch {
    throw new RuntimeError('INVALID_INPUT', 'Укажите полную HTTPS-ссылку на репозиторий.')
  }
  if (parsed.protocol !== 'https:' || !CLONE_HOSTS.has(parsed.hostname.toLowerCase())
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new RuntimeError('INVALID_INPUT', 'Поддерживаются только чистые HTTPS-ссылки GitHub, GitLab и Bitbucket.')
  }
  return parsed.href
}

export function createProjectRegistry({ store, roots }) {
  async function get(projectId) {
    const record = await store.read(PROJECTS, assertSegment(projectId, 'projectId'))
    if (!record) throw new RuntimeError('PROJECT_NOT_FOUND', `Проект «${projectId}» не зарегистрирован.`, { projectId })
    return record
  }

  async function list() {
    const rows = []
    for (const id of await store.list(PROJECTS)) {
      const record = await store.read(PROJECTS, id)
      if (record) rows.push(record)
    }
    return rows
  }

  async function register(input) {
    if (!input || typeof input !== 'object') throw new RuntimeError('INVALID_INPUT', 'Ожидались параметры проекта.')
    const hasPath = typeof input.path === 'string' && input.path.trim() !== ''
    const hasUrl = typeof input.repoUrl === 'string' && input.repoUrl.trim() !== ''
    if (hasPath === hasUrl) {
      throw new RuntimeError('INVALID_INPUT', 'Укажите ровно один источник проекта: локальный path или repoUrl.')
    }
    const suggested = hasPath ? basename(resolve(input.path)) : new URL(cloneUrl(input.repoUrl)).pathname.split('/').filter(Boolean).at(-1)
    const projectId = assertSegment(
      typeof input.projectId === 'string' && input.projectId !== ''
        ? input.projectId
        : sanitizeSegment(String(suggested ?? '').replace(/\.git$/i, ''), 'project'),
      'projectId',
    )
    if (await store.read(PROJECTS, projectId)) {
      throw new RuntimeError('PROJECT_EXISTS', `Проект «${projectId}» уже зарегистрирован.`, { projectId })
    }

    let canonicalRepoPath
    let origin
    if (hasPath) {
      canonicalRepoPath = resolve(input.path)
      if (!(await pathExists(canonicalRepoPath)) || !(await isGitRepository(canonicalRepoPath))) {
        throw new RuntimeError('INVALID_INPUT', 'Указанный путь не является Git-репозиторием.', { path: canonicalRepoPath })
      }
      origin = { type: 'local' }
    } else {
      const url = cloneUrl(input.repoUrl)
      canonicalRepoPath = repoPath(roots, projectId)
      if (await pathExists(canonicalRepoPath)) {
        throw new RuntimeError('PROJECT_EXISTS', 'Канонический репозиторий уже существует.', { projectId })
      }
      await cloneBare(url, canonicalRepoPath)
      origin = { type: 'clone', url }
    }

    const defaultBranch = assertBranchName(
      typeof input.defaultBranch === 'string' && input.defaultBranch !== ''
        ? input.defaultBranch
        : (await detectDefaultBranch(canonicalRepoPath)) ?? 'main',
    )
    const protectedBranches = Array.isArray(input.protectedBranches) && input.protectedBranches.length > 0
      ? input.protectedBranches.map(branch => String(branch))
      : [...DEFAULT_PROTECTED_BRANCHES]

    const record = {
      schemaVersion: 1,
      projectId,
      canonicalRepoPath,
      origin,
      defaultBranch,
      protectedBranches,
      // MVP: эти возможности Git сознательно вне гарантий (см. docstring).
      limitations: ['submodules', 'git-lfs', 'shallow-clones'],
      createdAt: new Date().toISOString(),
    }
    await store.write(PROJECTS, projectId, record)
    await appendAudit(roots.stateRoot, 'project.registered', { projectId, origin: origin.type })
    return record
  }

  async function unregister(projectId) {
    // Только метаданные: canonical-репозиторий и worktree никогда не
    // удаляются этой операцией.
    await get(projectId)
    await store.delete(PROJECTS, projectId)
    await appendAudit(roots.stateRoot, 'project.unregistered', { projectId })
  }

  // Fetch выполняется только для клонированных проектов и под межпроцессным
  // локом: параллельные сессии не гоняют одновременные fetch одного репо.
  async function fetchProject(projectId) {
    const project = await get(projectId)
    if (project.origin?.type !== 'clone') return { fetched: false }
    await store.withLock(`fetch-${projectId}`, () => fetchOrigin(project.canonicalRepoPath), { timeoutMs: 60_000 })
    return { fetched: true }
  }

  async function resolveBaseRef(project, requestedBaseRef) {
    const candidate = typeof requestedBaseRef === 'string' && requestedBaseRef !== ''
      ? requestedBaseRef
      : project.defaultBranch
    const sha = await revParse(project.canonicalRepoPath, candidate)
    if (!sha) {
      throw new RuntimeError('INVALID_INPUT', `База «${candidate}» не найдена в проекте «${project.projectId}».`, { baseRef: candidate })
    }
    return { baseRef: candidate, baseSha: sha }
  }

  return { get, list, register, unregister, fetchProject, resolveBaseRef }
}
