// Team Coordination Provider (§23–§25 плана модульности).
//
// Координация МЕЖДУ Runtime разных Unix-пользователей. Это обмен
// collaboration-МЕТАДАННЫМИ, а не общий Runtime-state: allowlist полей жёсткий
// (§24), секреты/пути/токены не публикуются по построению. Конкуренция —
// optimistic (revision + CAS): проигравший получает TEAM_STATE_CONFLICT после
// ограниченных повторов, last-write-wins без предупреждения не бывает.
//
// Backend'ы:
//   local  — общий каталог (один пользователь, тесты, single-host команды);
//   github — координационный git-репозиторий (MVP реальной команды): publish =
//            commit+push, конкуренция решается отказом non-fast-forward.

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { RuntimeError } from './errors.js'
import { assertSegment } from './ids.js'
import { commitAll, git } from './gitx.js'

const MAX_PUBLISH_RETRIES = 4

// --- Санитизация (§24): что МОЖНО публиковать -----------------------------
const CLAIM_FIELDS = ['type', 'value', 'area', 'mode']

export function sanitizeTaskSummary(task) {
  const forbidden = ['ownerToken', 'capability', 'capabilityHash', 'path', 'home', 'env', 'pid', 'logs']
  const summary = {
    projectId: task.projectId,
    taskId: task.taskId,
    title: String(task.title ?? '').slice(0, 300),
    owner: task.owner,
    status: task.status,
    branch: task.branch,
    baseSha: task.baseSha,
    claims: (task.claims ?? []).map(claim => Object.fromEntries(CLAIM_FIELDS.filter(field => claim[field] !== undefined).map(field => [field, claim[field]]))),
    affectedModules: task.analysis?.modularity?.changedModules ?? [],
    expectedAreas: task.expectedAreas ?? [],
    ...(task.delivery?.prNumber ? { prNumber: task.delivery.prNumber } : {}),
    ...(task.delivery?.ci?.conclusion ? { ciConclusion: task.delivery.ci.conclusion } : {}),
    updatedAt: new Date().toISOString(),
  }
  // Пояс и подтяжки: даже если задача когда-нибудь понесёт лишнее поле с
  // «запрещённым» именем, наружу оно не уйдёт.
  for (const key of Object.keys(summary)) {
    if (forbidden.some(name => key.toLowerCase().includes(name.toLowerCase()))) delete summary[key]
  }
  return summary
}

function conflictError(detail) {
  return new RuntimeError('TEAM_STATE_CONFLICT', 'Командное состояние изменил другой Runtime — перечитайте и повторите осознанно (silent overwrite запрещён).', detail)
}

// --- local backend ---------------------------------------------------------
// Файл на задачу, revision внутри; CAS под каталоговым mkdir-локом.
export function createLocalTeamProvider({ dir }) {
  async function withFileLock(path, action) {
    const lock = `${path}.lock`
    // Родительский каталог обязан существовать до попытки взять лок: иначе
    // ENOENT неотличим от «занято».
    await mkdir(dirname(path), { recursive: true })
    const deadline = Date.now() + 5000
    for (;;) {
      try {
        await mkdir(lock)
        break
      } catch {
        if (Date.now() > deadline) throw conflictError({ lock })
        await new Promise(resolveTimer => setTimeout(resolveTimer, 20))
      }
    }
    try {
      return await action()
    } finally {
      await rm(lock, { recursive: true, force: true })
    }
  }

  async function readJson(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {
      return undefined
    }
  }

  async function writeJson(path, value) {
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.${randomUUID()}.tmp`
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`)
    await rename(tmp, path)
  }

  function taskPath(projectId, taskId) {
    return join(dir, assertSegment(projectId, 'projectId'), 'tasks', `${taskId}.json`)
  }

  async function publish(path, payload, expectedRevision) {
    return withFileLock(path, async () => {
      const current = await readJson(path)
      const currentRevision = current?.revision ?? 0
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw conflictError({ expectedRevision, currentRevision })
      }
      const next = { ...payload, revision: currentRevision + 1 }
      await writeJson(path, next)
      return next
    })
  }

  async function listDir(projectId, kind) {
    const root = join(dir, projectId, kind)
    const rows = []
    for (const file of await readdir(root).catch(() => [])) {
      if (!file.endsWith('.json')) continue
      const row = await readJson(join(root, file))
      if (row) rows.push(row)
    }
    return rows
  }

  return {
    backend: 'local',
    publishTaskSummary: (summary, { expectedRevision } = {}) => publish(taskPath(summary.projectId, summary.taskId), summary, expectedRevision),
    publishTaskStatus: (summary, opts) => publish(taskPath(summary.projectId, summary.taskId), summary, opts?.expectedRevision),
    publishDelivery: (summary, opts) => publish(taskPath(summary.projectId, summary.taskId), summary, opts?.expectedRevision),
    publishClaim: (summary, opts) => publish(taskPath(summary.projectId, summary.taskId), summary, opts?.expectedRevision),
    releaseClaim: async (projectId, taskId) => {
      await rm(taskPath(projectId, taskId), { force: true })
      return { released: true }
    },
    listProjectTasks: projectId => listDir(projectId, 'tasks'),
    listProjectClaims: async projectId => (await listDir(projectId, 'tasks')).filter(row => (row.claims ?? []).length > 0),
  }
}

// --- github backend --------------------------------------------------------
// Координационный git-репозиторий: локальный клон в install root, publish —
// fetch → сверка revision → commit → push. Отклонённый push (non-FF) значит
// «кто-то успел раньше»: перечитываем и повторяем; ЕСЛИ revision разошёлся —
// честный конфликт, никаких silent overwrite.
export function createGitTeamProvider({ clonePath, remoteUrl, identity = { name: 'Gildra Team', email: 'team@gildra.local' } }) {
  let ready
  async function ensureClone() {
    ready ??= (async () => {
      const probe = await git(['-C', clonePath, 'rev-parse', '--git-dir'], { allowFailure: true })
      if (probe.failed) {
        await mkdir(dirname(clonePath), { recursive: true })
        await git(['clone', '--', remoteUrl, clonePath])
      }
    })()
    return ready
  }

  async function sync() {
    await ensureClone()
    await git(['-C', clonePath, 'fetch', 'origin'])
    // Локальный клон — только зеркало координации: своих правок вне publish
    // здесь не бывает, поэтому жёсткий reset к origin безопасен.
    const remoteHead = await git(['-C', clonePath, 'rev-parse', 'origin/HEAD'], { allowFailure: true })
    const target = remoteHead.failed ? 'origin/main' : 'origin/HEAD'
    await git(['-C', clonePath, 'reset', '--hard', target], { allowFailure: true })
  }

  function taskFile(projectId, taskId) {
    return join('projects', assertSegment(projectId, 'projectId'), 'tasks', `${taskId}.json`)
  }

  async function readJson(relative) {
    try {
      return JSON.parse(await readFile(join(clonePath, relative), 'utf8'))
    } catch {
      return undefined
    }
  }

  async function publish(relative, payload, expectedRevision) {
    for (let attempt = 1; attempt <= MAX_PUBLISH_RETRIES; attempt += 1) {
      await sync()
      const current = await readJson(relative)
      const currentRevision = current?.revision ?? 0
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw conflictError({ expectedRevision, currentRevision })
      }
      const next = { ...payload, revision: currentRevision + 1 }
      const absolute = join(clonePath, relative)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, `${JSON.stringify(next, null, 2)}\n`)
      await commitAll(clonePath, `team: ${relative} r${String(next.revision)}`, identity)
      const push = await git(['-C', clonePath, 'push', 'origin', 'HEAD'], { allowFailure: true })
      if (!push.failed) return next
      // Проиграли гонку push: перечитываем мир и пробуем снова.
      if (attempt === MAX_PUBLISH_RETRIES) throw conflictError({ relative, attempts: attempt })
    }
    throw conflictError({ relative })
  }

  async function listDir(projectId, kind) {
    await sync()
    const root = join(clonePath, 'projects', projectId, kind)
    const rows = []
    for (const file of await readdir(root).catch(() => [])) {
      if (!file.endsWith('.json')) continue
      const row = await readJson(join('projects', projectId, kind, file))
      if (row) rows.push(row)
    }
    return rows
  }

  return {
    backend: 'github',
    publishTaskSummary: (summary, { expectedRevision } = {}) => publish(taskFile(summary.projectId, summary.taskId), summary, expectedRevision),
    publishTaskStatus: (summary, opts) => publish(taskFile(summary.projectId, summary.taskId), summary, opts?.expectedRevision),
    publishDelivery: (summary, opts) => publish(taskFile(summary.projectId, summary.taskId), summary, opts?.expectedRevision),
    publishClaim: (summary, opts) => publish(taskFile(summary.projectId, summary.taskId), summary, opts?.expectedRevision),
    releaseClaim: async (projectId, taskId) => {
      for (let attempt = 1; attempt <= MAX_PUBLISH_RETRIES; attempt += 1) {
        await sync()
        const relative = taskFile(projectId, taskId)
        await rm(join(clonePath, relative), { force: true })
        await commitAll(clonePath, `team: release ${relative}`, identity).catch(() => {})
        const push = await git(['-C', clonePath, 'push', 'origin', 'HEAD'], { allowFailure: true })
        if (!push.failed) return { released: true }
      }
      throw conflictError({ projectId, taskId })
    },
    listProjectTasks: projectId => listDir(projectId, 'tasks'),
    listProjectClaims: async projectId => (await listDir(projectId, 'tasks')).filter(row => (row.claims ?? []).length > 0),
  }
}

// Выбор провайдера окружением; отсутствие настройки — валидный «solo»-режим.
export function createTeamProvider({ env = process.env, roots }) {
  const backend = env.GILDRA_TEAM_PROVIDER
  if (backend === 'local' && env.GILDRA_TEAM_DIR) {
    return createLocalTeamProvider({ dir: env.GILDRA_TEAM_DIR })
  }
  if (backend === 'github' && env.GILDRA_TEAM_REPO) {
    return createGitTeamProvider({
      clonePath: join(dirname(roots.stateRoot), 'team-coordination'),
      remoteUrl: env.GILDRA_TEAM_REPO,
    })
  }
  return undefined
}
