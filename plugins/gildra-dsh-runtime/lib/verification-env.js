// Sanitized-окружение верификации (§18 плана authority).
//
// Узкая ответственность: allowlist переменных для verification-процессов и
// редактирование секретов из логов. Никакого знания о задачах, снапшотах и
// readiness — только окружение.

// Sanitized-окружение верификации (§18): repository-код НЕ получает весь
// process.env Runtime. Базовый allowlist + платформенный минимум Windows
// (без SystemRoot/ComSpec там не стартует ни один процесс) + секреты,
// ЯВНО разрешённые политикой проекта. Секреты не пишутся в audit/evidence,
// а их значения редактируются из хвостов логов.
const ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'CI',
  // Windows-минимум: без него не запускается даже node.
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
  'SYSTEMDRIVE',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'NUMBER_OF_PROCESSORS',
  'OS',
])

export function buildVerificationEnv({
  baseEnv = process.env,
  allowedSecrets = [],
  taskId,
  workspaceId,
  runId,
}) {
  const env = {}
  for (const name of ENV_ALLOWLIST) {
    if (baseEnv[name] !== undefined) env[name] = baseEnv[name]
  }
  const secrets = {}
  for (const name of allowedSecrets) {
    if (baseEnv[name] !== undefined) {
      env[name] = baseEnv[name]
      secrets[name] = baseEnv[name]
    }
  }
  env.GILDRA_TASK_ID = String(taskId ?? '')
  env.GILDRA_WORKSPACE_ID = String(workspaceId ?? '')
  env.GILDRA_VERIFICATION_RUN_ID = String(runId ?? '')
  return { env, secretValues: Object.values(secrets) }
}

// Редактирование секретов из текста лога: значение не должно пережить прогон
// ни в evidence, ни в diagnostics.
export function redactSecrets(text, secretValues) {
  let out = String(text)
  for (const value of secretValues) {
    if (typeof value === 'string' && value.length >= 4) out = out.split(value).join('•••')
  }
  return out
}
