// Session-scoped окружение процессов (env injection) и Project Runtime
// Profile — extension point для team-специфичных сред (БД, compose и т.п.).
//
// Runtime не решает «любую БД магией»: он даёт сессии стабильные переменные
// (GILDRA_*, PORT, COMPOSE_PROJECT_NAME) и подстановку ${…} в объявленном
// профиле проекта. Пользовательский docker-compose.yml не переписывается —
// изоляция достигается именем compose-проекта per-session.

import { sanitizeSegment } from './ids.js'

// COMPOSE_PROJECT_NAME допускает [a-z0-9_-]; берём session id как есть
// (он уже безопасен) с префиксом gildra_.
export function composeProjectName(sessionId) {
  return `gildra_${sanitizeSegment(sessionId, 'session')}`
}

export function sessionEnvironment({ session, workspace, ports = [] }) {
  const environment = {
    GILDRA_SESSION_ID: session.sessionId,
    GILDRA_WORKSPACE_ID: workspace.workspaceId,
    GILDRA_WORKSPACE: workspace.path,
    GILDRA_PROJECT_ID: workspace.projectId,
    GILDRA_USER_ID: workspace.userId,
    GILDRA_BRANCH: workspace.branch,
    GILDRA_BASE_REF: workspace.baseRef,
    GILDRA_MODE: workspace.mode.toUpperCase(),
    COMPOSE_PROJECT_NAME: composeProjectName(session.sessionId),
  }
  for (const lease of ports) {
    const key = sanitizeSegment(lease.name, 'app').replaceAll('-', '_').toUpperCase()
    environment[`GILDRA_PORT_${key}`] = String(lease.port)
    // Основной порт сессии дублируется в PORT — конвенция большинства
    // dev-серверов; проекты, не читающие PORT, используют адаптер в
    // runtime-профиле (не считаем, что PORT поддержан автоматически).
    if (lease.name === 'app') environment.PORT = String(lease.port)
  }
  return environment
}

// Подстановка ${VAR} из session-окружения в объявленный профиль проекта:
// project.runtimeProfile = {
//   env: { POSTGRES_DB: '${GILDRA_PROJECT_ID}_${GILDRA_SESSION_ID}', … },
//   ports: ['app', 'debug'],           — имена портов для аллокации
//   startCommand / healthCheck / teardownCommand — строки для оркестрации
// }
// Неизвестная переменная — ошибка данных профиля, а не тихая пустота.
export function renderRuntimeProfile(profile, environment) {
  if (!profile || typeof profile !== 'object') return { env: {} }
  const rendered = {}
  const substitute = (value) => String(value).replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    if (!(name in environment)) throw new Error(`Runtime-профиль ссылается на неизвестную переменную \${${name}}`)
    return environment[name]
  })
  for (const [key, value] of Object.entries(profile.env ?? {})) {
    rendered[key] = substitute(value)
  }
  return {
    env: rendered,
    ...(profile.startCommand ? { startCommand: substitute(profile.startCommand) } : {}),
    ...(profile.healthCheck ? { healthCheck: substitute(profile.healthCheck) } : {}),
    ...(profile.teardownCommand ? { teardownCommand: substitute(profile.teardownCommand) } : {}),
  }
}

export function agentContextBlock({ session, workspace, project }) {
  return [
    'You are working in:',
    `Project: ${workspace.projectId}`,
    `Workspace: ${workspace.workspaceId} (${workspace.path})`,
    `Branch: ${workspace.branch}`,
    `Session: ${session.sessionId}`,
    `Mode: ${workspace.mode.toUpperCase()}`,
    `Base branch: ${workspace.baseRef}`,
    ...(project?.protectedBranches?.length
      ? [`Protected branches (merge workflow only): ${project.protectedBranches.join(', ')}`]
      : []),
    '',
    'Rules: Never switch branch. Never work outside the workspace root.',
    'Never delete another worktree. Never push to protected branches directly.',
  ].join('\n')
}
