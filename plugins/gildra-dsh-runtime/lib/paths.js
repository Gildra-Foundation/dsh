// Раскладка Gildra Runtime на диске и защита путей.
//
// Все корни живут в install root ТЕКУЩЕГО Unix-пользователя (изоляция
// пользователей = права файловой системы, architecture.md 0а.5). Тесты и
// нестандартные окружения переопределяют корень через GILDRA_DSH_STATE_DIR.

import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { RuntimeError } from './errors.js'
import { assertSegment } from './ids.js'

export function installRoot(env = process.env) {
  const dshHome = env.DSH_HOME
  if (dshHome && basename(dshHome) === 'home') return dirname(dshHome)
  return join(homedir(), process.platform === 'win32' ? 'AppData/Local/GildraDSH' : '.gildra-dsh')
}

export function runtimeRoots(env = process.env) {
  const stateRoot = env.GILDRA_DSH_STATE_DIR
    ? resolve(env.GILDRA_DSH_STATE_DIR)
    : join(installRoot(env), 'state')
  const base = dirname(stateRoot)
  return {
    stateRoot,
    reposRoot: join(base, 'repos'),
    workspacesRoot: join(base, 'workspaces'),
    // Merge-воркспейсы отделены от сессионных: у них нет пользователя и
    // сессии, а жизненный цикл управляется merge workflow.
    mergesRoot: join(base, 'merges'),
  }
}

export function mergePath(roots, projectId, mergeId) {
  const path = join(
    roots.mergesRoot,
    assertSegment(projectId, 'projectId'),
    assertSegment(mergeId, 'mergeId'),
  )
  return assertInsideRoot(path, roots.mergesRoot)
}

// Путь workspace строит только сервер из валидированных сегментов; ничего из
// UI не принимается как путь. Containment-проверка остаётся защитой в глубину
// (например от будущих ошибок в самой деривации).
export function workspacePath(roots, projectId, userId, sessionId) {
  const path = join(
    roots.workspacesRoot,
    assertSegment(projectId, 'projectId'),
    assertSegment(userId, 'userId'),
    assertSegment(sessionId, 'sessionId'),
  )
  return assertInsideRoot(path, roots.workspacesRoot)
}

export function workspaceKey(projectId, userId, sessionId) {
  return `${assertSegment(projectId, 'projectId')}--${assertSegment(userId, 'userId')}--${assertSegment(sessionId, 'sessionId')}`
}

export function repoPath(roots, projectId) {
  return assertInsideRoot(join(roots.reposRoot, `${assertSegment(projectId, 'projectId')}.git`), roots.reposRoot)
}

export function assertInsideRoot(path, root) {
  const relativePath = relative(resolve(root), resolve(path))
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new RuntimeError('INVALID_INPUT', 'Путь выходит за пределы управляемого корня.', { path, root })
  }
  return resolve(path)
}

// Каноническая проверка для существующих путей: раскрывает симлинки и
// сверяет принадлежность корню (тот же подход, что в workspace-files-патче).
export async function assertRealInsideRoot(path, root) {
  const realRoot = await realpath(root)
  const realTarget = await realpath(path)
  const relativePath = relative(realRoot, realTarget)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new RuntimeError('INVALID_INPUT', 'Канонический путь выходит за пределы управляемого корня.', { path, root })
  }
  return realTarget
}
