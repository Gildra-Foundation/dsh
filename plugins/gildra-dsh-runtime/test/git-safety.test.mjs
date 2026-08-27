// Git-безопасность managed-операций (§12, §13, §58-§61, §69).
//
// Главное доказательство: недоверенный репозиторий не может заставить Runtime
// выполнить свой код (hooks/config) и не может перенаправить managed-команду
// в чужой репозиторий через унаследованный env.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MINIMUM_GIT_VERSION,
  assertMinimumGitVersion,
  classifyGitFailure,
  commitAll,
  fetchOrigin,
  git,
  gitSafeEnv,
  gitVersion,
  hardeningArgs,
  isVersionAtLeast,
  parseGitVersion,
  repositoryKind,
} from '../lib/gitx.js'

const base = await mkdtemp(join(tmpdir(), 'gildra git safety '))

// --- Разделение env: repository-control вычищается, auth сохраняется -------
{
  const hostile = {
    PATH: '/usr/bin',
    HOME: '/home/alex',
    // Перенаправление managed-операции в чужой репозиторий.
    GIT_DIR: '/evil/.git',
    GIT_WORK_TREE: '/evil',
    GIT_INDEX_FILE: '/evil/index',
    GIT_OBJECT_DIRECTORY: '/evil/objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/evil/alt',
    GIT_COMMON_DIR: '/evil/common',
    GIT_CONFIG: '/evil/config',
    GIT_CONFIG_GLOBAL: '/evil/global',
    GIT_CONFIG_SYSTEM: '/evil/system',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/evil/hooks',
    GIT_TEMPLATE_DIR: '/evil/template',
    GIT_NAMESPACE: 'evil',
    // Исполнение произвольной программы.
    GIT_EXTERNAL_DIFF: '/evil/diff.sh',
    GIT_PAGER: '/evil/pager.sh',
    GIT_EDITOR: '/evil/editor.sh',
    GIT_SEQUENCE_EDITOR: '/evil/seq.sh',
    GIT_PROXY_COMMAND: '/evil/proxy.sh',
    // Аутентификация пользователя — его собственная настройка.
    GIT_SSH_COMMAND: 'ssh -i /home/alex/.ssh/id_ed25519',
    GIT_ASKPASS: '/usr/lib/git-core/askpass',
    SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
  }
  const safe = gitSafeEnv(hostile)

  for (const name of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG',
    'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_TEMPLATE_DIR',
    'GIT_NAMESPACE', 'GIT_EXTERNAL_DIFF', 'GIT_PAGER', 'GIT_EDITOR',
    'GIT_SEQUENCE_EDITOR', 'GIT_PROXY_COMMAND',
  ]) {
    assert.equal(safe[name], undefined, `${name} должен вычищаться из managed-окружения`)
  }
  // Аутентификацию пользователя не ломаем.
  assert.equal(safe.GIT_SSH_COMMAND, hostile.GIT_SSH_COMMAND)
  assert.equal(safe.GIT_ASKPASS, hostile.GIT_ASKPASS)
  assert.equal(safe.SSH_AUTH_SOCK, hostile.SSH_AUTH_SOCK)
  assert.equal(safe.PATH, '/usr/bin')
  assert.equal(safe.HOME, '/home/alex')
  // Managed-операции всегда неинтерактивны.
  assert.equal(safe.GIT_TERMINAL_PROMPT, '0')

  // Hardening-флаги отключают hooks и опасные транспорты.
  const flags = hardeningArgs().join(' ')
  assert.match(flags, /core\.hooksPath=/)
  assert.match(flags, /core\.fsmonitor=false/)
  assert.match(flags, /protocol\.ext\.allow=never/)
}

// --- Реальные hooks недоверенного репозитория не исполняются --------------
// git запускает post-checkout при `worktree add` и pre-commit при commit.
// Оба hook'а пишут файл-маркер; после managed-операций маркеров быть не должно.
{
  const repo = join(base, 'hostile repo')
  await git(['init', '-b', 'main', repo])
  await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
  await writeFile(join(repo, 'file.txt'), 'v1\n')
  await commitAll(repo, 'initial', { name: 'Seed', email: 'seed@test' })

  const marker = join(base, 'hook-executed.txt')
  const hooksDir = join(repo, '.git', 'hooks')
  await mkdir(hooksDir, { recursive: true })
  for (const hook of ['post-checkout', 'pre-commit', 'post-commit', 'post-merge']) {
    const path = join(hooksDir, hook)
    await writeFile(path, `#!/bin/sh\necho "${hook}" >> "${marker}"\n`)
    await chmod(path, 0o755)
  }

  // Дополнительно репозиторий пытается сам назначить свой каталог hooks —
  // command-line `-c` имеет высший приоритет и перебивает это.
  const rogueHooks = join(base, 'rogue hooks')
  await mkdir(rogueHooks, { recursive: true })
  const roguePath = join(rogueHooks, 'post-checkout')
  await writeFile(roguePath, `#!/bin/sh\necho "rogue" >> "${marker}"\n`)
  await chmod(roguePath, 0o755)
  await git(['-C', repo, 'config', 'core.hooksPath', rogueHooks])

  // Managed-операции: worktree add (checkout) и commit.
  const worktree = join(base, 'managed worktree')
  await git(['-C', repo, 'worktree', 'add', '-b', 'session/alex/sess-hook', worktree, 'main'])
  await writeFile(join(worktree, 'file.txt'), 'v2\n')
  await commitAll(worktree, 'managed change', { name: 'Alex', email: 'alex@test' })

  assert.equal(existsSync(marker), false,
    'hooks недоверенного репозитория не должны исполняться managed-операциями')

  // Контрольная проверка: без hardening тот же hook действительно срабатывает —
  // иначе тест доказывал бы лишь то, что hooks в принципе не работают.
  const control = join(base, 'control worktree')
  await git(['-C', repo, '-c', `core.hooksPath=${hooksDir}`, 'worktree', 'add', '-b', 'control', control, 'main'])
  assert.equal(existsSync(marker), true, 'контрольный прогон обязан выполнить hook')
}

// --- Враждебный env процесса не перенаправляет managed-команду -------------
{
  const repo = join(base, 'target repo')
  await git(['init', '-b', 'main', repo])
  await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await commitAll(repo, 'initial', { name: 'Seed', email: 'seed@test' })

  const decoy = join(base, 'decoy repo')
  await git(['init', '-b', 'main', decoy])

  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE }
  process.env.GIT_DIR = join(decoy, '.git')
  process.env.GIT_WORK_TREE = decoy
  try {
    // Несмотря на GIT_DIR, команда обязана работать с указанным репозиторием.
    const { stdout } = await git(['-C', repo, 'rev-parse', '--show-toplevel'])
    assert.match(stdout.trim().replaceAll('\\', '/'), /target repo$/,
      'managed-команда не должна перенаправляться через GIT_DIR из окружения')
  } finally {
    if (previous.GIT_DIR === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = previous.GIT_DIR
    if (previous.GIT_WORK_TREE === undefined) delete process.env.GIT_WORK_TREE
    else process.env.GIT_WORK_TREE = previous.GIT_WORK_TREE
  }
}

// --- repositoryKind: bare/non-bare и корень для безопасного adopt ---------
{
  const plain = join(base, 'plain repo')
  await git(['init', '-b', 'main', plain])
  await writeFile(join(plain, 'x.txt'), 'x\n')
  await commitAll(plain, 'initial', { name: 'Seed', email: 'seed@test' })
  const bare = join(base, 'bare repo.git')
  await git(['clone', '--bare', plain, bare])

  const plainKind = await repositoryKind(plain)
  assert.equal(plainKind.bare, false)
  assert.ok(plainKind.topLevel)
  const bareKind = await repositoryKind(bare)
  assert.equal(bareKind.bare, true)
  assert.equal(await repositoryKind(join(base, 'not-a-repo')), undefined)
}

// --- Классификация сбоев: таймаут и требование аутентификации -------------
{
  const timeoutError = classifyGitFailure({ killed: true, signal: 'SIGTERM', stderr: '' }, ['fetch'])
  assert.equal(timeoutError.code, 'GIT_TIMEOUT')
  assert.equal(timeoutError.status, 504)

  for (const stderr of [
    'fatal: Authentication failed for https://example.test/repo.git',
    'fatal: could not read Username for https://example.test: terminal prompts disabled',
    'git@example.test: Permission denied (publickey).',
  ]) {
    const authError = classifyGitFailure({ stderr }, ['fetch'])
    assert.equal(authError.code, 'GIT_AUTH_REQUIRED', `«${stderr}» должно классифицироваться как auth`)
  }

  const generic = classifyGitFailure({ stderr: 'fatal: not a git repository' }, ['status'])
  assert.equal(generic.code, 'GIT_FAILED')
  // Сообщение не должно тащить в себе весь вывод: только последняя строка.
  assert.match(generic.message, /not a git repository/)
}

// --- Версия git: floor и разбор -------------------------------------------
{
  assert.deepEqual(parseGitVersion('git version 2.39.5 (Apple Git-154)'), [2, 39, 5])
  assert.deepEqual(parseGitVersion('git version 2.28'), [2, 28, 0])
  assert.equal(parseGitVersion('nonsense'), undefined)
  assert.equal(isVersionAtLeast([2, 39, 5], MINIMUM_GIT_VERSION), true)
  assert.equal(isVersionAtLeast([2, 17, 0], MINIMUM_GIT_VERSION), false)
  assert.equal(isVersionAtLeast([3, 0, 0], MINIMUM_GIT_VERSION), true)
  assert.equal(isVersionAtLeast(undefined, MINIMUM_GIT_VERSION), false)

  const { version } = await gitVersion()
  assert.ok(Array.isArray(version), 'версия установленного git должна разбираться')
  await assertMinimumGitVersion()
}

// --- fetch: ограниченные повторы с backoff, без ретрая аутентификации -----
{
  const repo = join(base, 'broken remote repo')
  await git(['init', '-b', 'main', repo])
  // Недостижимый remote: fetch падает предсказуемо и без сети.
  await git(['-C', repo, 'remote', 'add', 'origin', join(base, 'missing remote.git')])
  const delays = []
  await assert.rejects(
    fetchOrigin(repo, { attempts: 3, backoffMs: 1, sleep: async ms => { delays.push(ms) } }),
    (error) => error.code === 'GIT_FAILED' || error.code === 'GIT_AUTH_REQUIRED',
  )
  // Повторы ограничены и растут экспоненциально: 2 паузы между 3 попытками.
  assert.deepEqual(delays, [1, 2])
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime git safety tests passed.')
