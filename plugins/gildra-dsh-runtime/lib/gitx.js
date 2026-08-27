// Git-примитивы Gildra Runtime.
//
// Только execFile (никакого shell): аргументы уходят отдельным argv, пути с
// пробелами безопасны на всех платформах. Все операции с ветками/worktree
// идут через эти помощники — сырой git из UI/API не выполняется.
//
// Репозиторий (особенно adopt локального пути) считается НЕДОВЕРЕННЫМ входом,
// поэтому каждая managed-команда выполняется в контролируемом окружении:
// вычищенный env + hardening-флаги `-c`, которые перебивают любой repo-config
// (командная строка имеет высший приоритет в git).

import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { RuntimeError } from './errors.js'

const execFileAsync = promisify(execFile)

// Локальные операции (worktree/branch/status) не ходят в сеть: длинный
// таймаут им не нужен и только маскирует зависание.
export const LOCAL_TIMEOUT_MS = 60_000
export const NETWORK_TIMEOUT_MS = 5 * 60_000
export const CLONE_TIMEOUT_MS = 20 * 60_000

// Минимальная версия git: `worktree remove`/`worktree list --porcelain`
// стабильны с 2.17, а `init --initial-branch` требует 2.28.
export const MINIMUM_GIT_VERSION = [2, 28, 0]

// Переменные, перенаправляющие managed-операцию в ЧУЖОЙ репозиторий или
// подменяющие конфигурацию: главный риск нарушения изоляции.
const REPOSITORY_CONTROL_ENV = [
  'GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT',
  'GIT_TEMPLATE_DIR', 'GIT_NAMESPACE', 'GIT_ATTR_SOURCE', 'GIT_ATTR_NOSYSTEM',
]

// Переменные, заставляющие git выполнить произвольную программу. Runtime
// никогда не нуждается в pager/editor/external diff, поэтому вычищаем их.
const EXECUTION_SURFACE_ENV = [
  'GIT_EXTERNAL_DIFF', 'GIT_PAGER', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR',
  'GIT_PROXY_COMMAND', 'GIT_ALLOW_PROTOCOL',
]

// Аутентификация пользователя СОХРАНЯЕТСЯ (GIT_SSH, GIT_SSH_COMMAND,
// GIT_ASKPASS, SSH_AUTH_SOCK, credential helper из его конфига): это его
// собственные настройки внутри его же Unix-пользователя, а не влияние
// недоверенного репозитория. Зависания закрывает таймаут, а не ослабление
// аутентификации; StrictHostKeyChecking мы не трогаем.
export function gitSafeEnv(baseEnv = process.env, overrides = {}) {
  const env = { ...baseEnv }
  for (const name of [...REPOSITORY_CONTROL_ENV, ...EXECUTION_SURFACE_ENV]) delete env[name]
  // GIT_CONFIG_COUNT задаёт пары GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n — сам
  // счётчик уже удалён, но убираем и пары, чтобы не осталось хвостов.
  for (const name of Object.keys(env)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete env[name]
  }
  env.GIT_TERMINAL_PROMPT = '0'
  return { ...env, ...overrides }
}

// Каталог без hooks. Реально существовать не обязан: git просто не находит
// hooks по несуществующему пути. Runtime указывает путь внутри своего
// state-корня (0700), поэтому подложить туда hook может только сам
// пользователь — то есть уже внутри границы доверия.
let managedHooksPath = join(tmpdir(), 'gildra-runtime-no-hooks')

export function setManagedHooksPath(path) {
  if (typeof path === 'string' && path.length > 0) managedHooksPath = path
}

export function hardeningArgs() {
  return [
    '--no-pager',
    // Командная строка перебивает repo-config: hooks недоверенного
    // репозитория не выполняются при worktree/merge/commit.
    '-c', `core.hooksPath=${managedHooksPath}`,
    '-c', 'core.fsmonitor=false',
    // ext:: URL исполняет произвольную команду как транспорт.
    '-c', 'protocol.ext.allow=never',
    '-c', 'diff.external=',
    '-c', 'core.pager=cat',
  ]
}

// Windows открывает файлы без share-delete, поэтому пока один git-процесс
// заменяет config репозитория (запись во временный файл + rename), соседний
// процесс, читающий тот же config, получает sharing violation и умирает с
// «fatal: unknown error occurred while reading the configuration files».
// Собственной сериализации мутаций мало: конфликтовать может и чужой git,
// и индексатор, и антивирус — на Windows это норма жизни, а не наш дефект.
//
// Важное свойство: git падает на этапе ЧТЕНИЯ конфигурации, то есть до начала
// самой команды. Поэтому именно этот класс ошибок (и только он) повторяется
// автоматически даже для разрушительных операций — повтор не может выполнить
// половину работы дважды.
const TRANSIENT_CONFIG_READ = /unknown error occurred while reading the configuration files/i
const TRANSIENT_ATTEMPTS = 4
const TRANSIENT_BACKOFF_MS = 50

export function isTransientConfigFailure(error) {
  if (error?.killed) return false
  return TRANSIENT_CONFIG_READ.test(`${String(error?.stderr ?? '')}\n${String(error?.stdout ?? '')}`)
}

export function classifyGitFailure(error, args) {
  const output = `${String(error?.stderr ?? '')}\n${String(error?.stdout ?? '')}`
  if (error?.killed || error?.signal === 'SIGTERM') {
    return new RuntimeError('GIT_TIMEOUT', `git ${args[0] ?? ''}: операция превысила таймаут и была остановлена.`, {
      command: args.find(argument => !argument.startsWith('-')) ?? 'git',
    })
  }
  if (/Authentication failed|could not read Username|could not read Password|Permission denied \(publickey\)|terminal prompts disabled|Invalid username or password/i.test(output)) {
    return new RuntimeError('GIT_AUTH_REQUIRED', 'Git требует аутентификацию: настройте доступ (ssh-ключ или credential helper) и повторите.', {})
  }
  if (isTransientConfigFailure(error)) {
    return new RuntimeError('GIT_TRANSIENT', 'Git не смог прочитать конфигурацию репозитория (параллельный доступ к файлам). Повторите операцию.', {
      args: args.slice(0, 6),
    })
  }
  const detail = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) ?? ''
  return new RuntimeError('GIT_FAILED', detail ? `git ${args[0] ?? ''}: ${detail.slice(0, 400)}` : `git ${args[0] ?? ''} завершился с ошибкой.`, {
    args: args.slice(0, 6),
  })
}

// Политика повтора вынесена отдельно, чтобы её можно было проверить тестом
// без подмены git в PATH: она решает только «повторять или отдать ошибку».
export async function runWithTransientRetry(run, { attempts = TRANSIENT_ATTEMPTS, sleep } = {}) {
  const pause = sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run(attempt)
    } catch (error) {
      // Повтор безопасен именно здесь и больше нигде: git не дошёл до самой
      // команды, поэтому не изменил ни одного байта репозитория.
      if (attempt >= attempts || !isTransientConfigFailure(error)) throw error
      await pause(TRANSIENT_BACKOFF_MS * attempt)
    }
  }
}

export async function git(args, options = {}) {
  const fullArgs = [...hardeningArgs(), ...args]
  try {
    return await runWithTransientRetry(() => execFileAsync('git', fullArgs, {
      cwd: options.cwd,
      env: gitSafeEnv(process.env, options.env),
      timeout: options.timeoutMs ?? LOCAL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }), { attempts: options.transientAttempts, sleep: options.sleep })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new RuntimeError('GIT_UNAVAILABLE', 'Git не найден. Установите Git и повторите попытку.')
    }
    if (options.allowFailure && !error?.killed) {
      return { stdout: String(error?.stdout ?? ''), stderr: String(error?.stderr ?? ''), failed: true, exitCode: error?.code }
    }
    throw classifyGitFailure(error, args)
  }
}

export function parseGitVersion(text) {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text))
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

export function isVersionAtLeast(version, minimum) {
  if (!version) return false
  for (let index = 0; index < minimum.length; index++) {
    const actual = version[index] ?? 0
    if (actual > minimum[index]) return true
    if (actual < minimum[index]) return false
  }
  return true
}

export async function gitVersion() {
  const { stdout } = await git(['--version'], { timeoutMs: 15_000 })
  return { raw: stdout.trim(), version: parseGitVersion(stdout) }
}

export async function assertMinimumGitVersion() {
  const { raw, version } = await gitVersion()
  if (!isVersionAtLeast(version, MINIMUM_GIT_VERSION)) {
    throw new RuntimeError('UNSUPPORTED_GIT_VERSION', `Требуется git ${MINIMUM_GIT_VERSION.join('.')} или новее; установлен «${raw}».`, {
      required: MINIMUM_GIT_VERSION.join('.'),
      found: raw,
    })
  }
  return { raw, version }
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

export async function repositoryKind(path) {
  // --show-toplevel не существует в bare-репозитории, поэтому спрашиваем его
  // отдельно и только для рабочего дерева.
  const result = await git([
    '-C', path, 'rev-parse', '--is-bare-repository', '--git-common-dir',
  ], { allowFailure: true })
  if (result.failed) return undefined
  const [bare, commonDir] = result.stdout.split(/\r?\n/).map(line => line.trim())
  const kind = { bare: bare === 'true', commonDir }
  if (!kind.bare) {
    const top = await git(['-C', path, 'rev-parse', '--show-toplevel'], { allowFailure: true })
    if (!top.failed) kind.topLevel = top.stdout.trim() || undefined
  }
  return kind
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
  assertRepoMutationScope('worktree add')
  if (existingBranch) {
    await git(['-C', repoPath, 'worktree', 'add', worktreePath, branch])
    return
  }
  await git(['-C', repoPath, 'worktree', 'add', '-b', branch, worktreePath, baseRef])
}

export async function removeWorktree(repoPath, worktreePath, { force = false } = {}) {
  assertRepoMutationScope('worktree remove')
  await git(['-C', repoPath, 'worktree', 'remove', ...(force ? ['--force'] : []), worktreePath])
}

export async function pruneWorktrees(repoPath) {
  assertRepoMutationScope('worktree prune')
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

// --- Инвариант repo-лока (§57 плана AI-качества) --------------------------
// Мутации МЕТАДАННЫХ канонического репозитория (worktree add/remove/prune,
// создание/удаление веток, CAS ссылок) обязаны идти под межпроцессным
// repo-локом — иначе параллельные git-процессы правят одни файлы (на Windows
// это гарантированно ломается). Дисциплину «взял лок» невозможно проверить
// на ревью каждый раз, поэтому она закреплена в Runtime: withRepoLock входит
// в этот scope, а мутирующие помощники ПАДАЮТ вне его. Новая canonical-
// мутация без лока не пройдёт ни один тест, который её вызывает.
//
// Scope хранит контекст асинхронной цепочки (AsyncLocalStorage): он ничего
// не знает про другие процессы — межпроцессность даёт сам лок, а scope лишь
// доказывает, что код пришёл через него.
const repoMutationScope = new AsyncLocalStorage()

export function enterRepoMutationScope(context, action) {
  return repoMutationScope.run(context ?? {}, action)
}

function assertRepoMutationScope(operation) {
  if (repoMutationScope.getStore() === undefined) {
    throw new RuntimeError('INTERNAL', `Внутренняя ошибка: canonical-мутация «${operation}» вызвана без repo-лока (withRepoLock). Это нарушение контракта §57.`, { operation })
  }
}

// Первый родитель коммита: главный инструмент проверки «target двигался
// только нашим merge-коммитом».
export async function commitParent(repoPath, sha) {
  const result = await git(['-C', repoPath, 'rev-parse', '--verify', '--quiet', `${sha}^1`], { allowFailure: true })
  if (result.failed) return undefined
  return result.stdout.trim() || undefined
}

// Атомарный compare-and-swap ссылки: git сам гарантирует, что ссылка будет
// заменена, только если её текущее значение равно expectedOld.
export async function updateRefCas(repoPath, ref, newSha, expectedOld) {
  assertRepoMutationScope('update-ref')
  const result = await git(['-C', repoPath, 'update-ref', `refs/heads/${ref}`, newSha, expectedOld], { allowFailure: true })
  return !result.failed
}

export async function branchCheckedOutAt(repoPath, branch) {
  const worktrees = await listWorktrees(repoPath)
  return worktrees.find(entry => entry.branch === branch && !entry.bare)?.path
}

export async function deleteBranch(repoPath, branch, { force = false } = {}) {
  assertRepoMutationScope('branch delete')
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

// Проверка целостности canonical-репозитория. Запускается не на каждый
// запрос, а точечно: после подозрительной ошибки, вручную и при recovery.
export async function checkRepositoryIntegrity(repoPath) {
  const result = await git(['-C', repoPath, 'fsck', '--connectivity-only', '--no-progress'], {
    allowFailure: true,
    timeoutMs: NETWORK_TIMEOUT_MS,
  })
  if (!result.failed) return { healthy: true }
  const problems = String(result.stderr || result.stdout || '')
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 20)
  return { healthy: false, problems }
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

// Сетевые операции: ограниченные повторы с backoff. Ошибка аутентификации не
// ретраится никогда — бесконечные попытки только блокируют аккаунт и висят.
//
// Refspec задан ЯВНО, потому что оба «удобных» варианта опасны или бесполезны:
//   - `git clone --bare` не пишет remote.origin.fetch вовсе, и `fetch --all`
//     обновлял только FETCH_HEAD — canonical main никогда не двигался, и
//     upstream awareness для клонов был бы слеп (обнаружено тестом §56);
//   - зеркальный refspec С `--prune` УДАЛЯЛ БЫ локальные session/* ветки,
//     которых нет в origin (обнаружено тем же тестом).
// Поэтому: явный `+refs/heads/*:refs/heads/*` БЕЗ prune — origin-ветки
// обновляются принудительно, локальные session-ветки не удаляются никогда, а
// ветку, извлечённую в чей-то worktree, git отказывается трогать сам.
export async function fetchOrigin(repoPath, { attempts = 3, backoffMs = 1000, sleep } = {}) {
  const wait = sleep ?? (ms => new Promise(resolveTimer => setTimeout(resolveTimer, ms)))
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await git(['-C', repoPath, 'fetch', 'origin', '+refs/heads/*:refs/heads/*'], { timeoutMs: NETWORK_TIMEOUT_MS })
      return { fetched: true, attempts: attempt }
    } catch (error) {
      lastError = error
      if (error?.code === 'GIT_AUTH_REQUIRED' || error?.code === 'GIT_UNAVAILABLE') throw error
      if (attempt === attempts) break
      await wait(backoffMs * 2 ** (attempt - 1))
    }
  }
  throw lastError
}

export async function cloneBare(url, targetPath) {
  await git(['clone', '--bare', '--', url, targetPath], { timeoutMs: CLONE_TIMEOUT_MS })
}
