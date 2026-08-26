import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ERROR_CODES, RuntimeError, asRuntimeError } from '../lib/errors.js'
import {
  DEFAULT_PROTECTED_BRANCHES,
  assertBranchName,
  assertSegment,
  assertWritableBranch,
  currentUserId,
  generateOwnerToken,
  generateSessionId,
  isProtectedBranch,
  isValidBranchName,
  sanitizeSegment,
  sessionBranch,
} from '../lib/ids.js'
import { assertInsideRoot, repoPath, runtimeRoots, workspaceKey, workspacePath } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { appendAudit, auditLogPath } from '../lib/audit.js'
import { ISOLATION_RULES, guardWorkspaceCommand } from '../lib/index.js'

// --- errors ---------------------------------------------------------------

{
  const error = new RuntimeError('WORKSPACE_LOCKED', 'занято', { workspaceId: 'x' })
  assert.equal(error.code, 'WORKSPACE_LOCKED')
  assert.equal(error.status, 409)
  assert.deepEqual(error.toJSON(), { code: 'WORKSPACE_LOCKED', message: 'занято', details: { workspaceId: 'x' } })
  // Неизвестный код деградирует в INTERNAL, а не падает.
  const unknown = new RuntimeError('NOPE', 'msg')
  assert.equal(unknown.code, 'INTERNAL')
  assert.equal(unknown.status, 500)
  assert.equal(asRuntimeError(new Error('boom')).code, 'INTERNAL')
  assert.equal(asRuntimeError(error), error)
  for (const status of Object.values(ERROR_CODES)) assert.ok(Number.isInteger(status))
}

// --- ids ------------------------------------------------------------------

{
  const first = generateSessionId()
  const second = generateSessionId()
  assert.match(first, /^sess-[a-z0-9]{25}$/)
  assert.notEqual(first, second)
  assert.doesNotThrow(() => assertSegment(first, 'sessionId'))
  assert.match(generateOwnerToken(), /^[0-9a-f]{48}$/)

  assert.equal(sanitizeSegment('Alex Петров!', 'user'), 'alex')
  assert.equal(sanitizeSegment('  ', 'user'), 'user')
  assert.equal(sanitizeSegment('a--B--c', 'user'), 'a-b-c')
  assert.doesNotThrow(() => assertSegment(currentUserId(), 'userId'))
  assert.throws(() => assertSegment('../evil', 'x'), /INVALID_ID|строчных/)
  assert.throws(() => assertSegment('UPPER', 'x'))
  assert.throws(() => assertSegment('', 'x'))

  assert.equal(isValidBranchName('session/alex/sess-abc123'), true)
  assert.equal(isValidBranchName('merge/m-1'), true)
  for (const bad of [
    'a..b', 'a b', 'a@{b', '/lead', 'trail/', 'dot.', '.hidden/x', 'x/.hidden',
    'seg//seg', 'a\\b', 'ref.lock', 'x/ref.lock', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b',
  ]) {
    assert.equal(isValidBranchName(bad), false, `ветка «${bad}» должна отклоняться`)
  }
  assert.throws(() => assertBranchName('a..b'), /INVALID_BRANCH|Недопустимое/)

  assert.equal(isProtectedBranch('main'), true)
  assert.equal(isProtectedBranch('master'), true)
  assert.equal(isProtectedBranch('production'), true)
  assert.equal(isProtectedBranch('release/1.2'), true)
  assert.equal(isProtectedBranch('release'), false)
  assert.equal(isProtectedBranch('mainline'), false)
  assert.equal(isProtectedBranch('session/alex/sess-1'), false)
  assert.deepEqual([...DEFAULT_PROTECTED_BRANCHES], ['main', 'master', 'production', 'release/*'])
  assert.throws(() => assertWritableBranch('main'), (error) => error.code === 'PROTECTED_BRANCH')
  assert.equal(assertWritableBranch('session/alex/sess-1'), 'session/alex/sess-1')
  assert.equal(sessionBranch('alex', 'sess-1'), 'session/alex/sess-1')
  assert.throws(() => sessionBranch('Алекс', 'sess-1'))
}

// --- paths ----------------------------------------------------------------

{
  const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: '/tmp/gildra-test/state' })
  assert.equal(roots.stateRoot, '/tmp/gildra-test/state')
  assert.equal(roots.reposRoot, '/tmp/gildra-test/repos')
  assert.equal(roots.workspacesRoot, '/tmp/gildra-test/workspaces')
  const path = workspacePath(roots, 'proj', 'alex', 'sess-1')
  assert.equal(path, join(roots.workspacesRoot, 'proj', 'alex', 'sess-1'))
  assert.throws(() => workspacePath(roots, '../evil', 'alex', 'sess-1'))
  assert.throws(() => workspacePath(roots, 'proj', 'alex', 'a/b'))
  assert.equal(repoPath(roots, 'proj'), join(roots.reposRoot, 'proj.git'))
  assert.equal(workspaceKey('p', 'u', 's'), 'p--u--s')
  assert.throws(() => assertInsideRoot('/etc/passwd', roots.workspacesRoot))
  assert.throws(() => assertInsideRoot(roots.workspacesRoot, roots.workspacesRoot))
}

// --- store ----------------------------------------------------------------

{
  const root = await mkdtemp(join(tmpdir(), 'gildra-store-'))
  const corruptions = []
  const store = new JsonStore(root, { onCorrupt: entry => corruptions.push(entry) })
  await store.ensureRoot()
  await store.write('sessions', 'sess-1', { schemaVersion: 1, status: 'active' })
  assert.deepEqual(await store.read('sessions', 'sess-1'), { schemaVersion: 1, status: 'active' })
  if (process.platform !== 'win32') {
    assert.equal(((await stat(store.filePath('sessions', 'sess-1'))).mode & 0o777), 0o600)
  }
  await store.write('sessions', 'sess-2', { schemaVersion: 1 })
  assert.deepEqual(await store.list('sessions'), ['sess-1', 'sess-2'])
  await store.delete('sessions', 'sess-2')
  assert.deepEqual(await store.list('sessions'), ['sess-1'])
  assert.equal(await store.read('sessions', 'missing'), undefined)
  assert.deepEqual(await store.list('nothing'), [])
  assert.throws(() => store.filePath('sessions', '../evil'))

  // Повреждённый JSON: запись пропадает, файл откладывается в сторону.
  await writeFile(store.filePath('sessions', 'sess-1'), '{broken', { mode: 0o600 })
  assert.equal(await store.read('sessions', 'sess-1'), undefined)
  assert.equal(corruptions.length, 1)
  const asideNames = (await readdir(join(root, 'sessions'))).filter(name => name.includes('.corrupt-'))
  assert.equal(asideNames.length, 1)

  // withLock сериализует конкурентов: 25 параллельных инкрементов через
  // неатомарный read-modify-write не теряют ни одного.
  const counterPath = join(root, 'counter.json')
  await writeFile(counterPath, '0')
  await Promise.all(Array.from({ length: 25 }, () => store.withLock('counter', async () => {
    const value = Number(await readFile(counterPath, 'utf8'))
    await new Promise(resolveTimer => setTimeout(resolveTimer, 2))
    await writeFile(counterPath, String(value + 1))
  })))
  assert.equal(Number(await readFile(counterPath, 'utf8')), 25)

  // Stale-лок мёртвого процесса перехватывается.
  const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const deadPid = deadChild.pid
  await new Promise(resolveExit => deadChild.on('exit', resolveExit))
  const staleLock = join(root, 'locks', 'busy.lock')
  await mkdir(staleLock, { recursive: true })
  await writeFile(join(staleLock, 'meta.json'), JSON.stringify({ pid: deadPid }))
  let ran = false
  await store.withLock('busy', async () => { ran = true })
  assert.equal(ran, true)

  // Живой чужой владелец: WORKSPACE_BUSY по таймауту, лок не удалён.
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  try {
    const heldLock = join(root, 'locks', 'held.lock')
    await mkdir(heldLock, { recursive: true })
    await writeFile(join(heldLock, 'meta.json'), JSON.stringify({ pid: holder.pid }))
    await assert.rejects(
      store.withLock('held', async () => {}, { timeoutMs: 200 }),
      (error) => error.code === 'WORKSPACE_BUSY',
    )
    assert.equal(existsSync(heldLock), true)
  } finally {
    holder.kill('SIGKILL')
  }

  await rm(root, { recursive: true, force: true })
}

// --- audit ----------------------------------------------------------------

{
  const root = await mkdtemp(join(tmpdir(), 'gildra-audit-'))
  await appendAudit(root, 'workspace.created', { workspaceId: 'p--u--s', sessionId: 'sess-1' })
  await appendAudit(root, 'lease.acquired', { workspaceId: 'p--u--s' })
  const lines = (await readFile(auditLogPath(root), 'utf8')).trim().split('\n')
  assert.equal(lines.length, 2)
  const first = JSON.parse(lines[0])
  assert.equal(first.event, 'workspace.created')
  assert.equal(first.workspaceId, 'p--u--s')
  assert.ok(first.ts)
  await rm(root, { recursive: true, force: true })
}

// --- guard опасных git-команд --------------------------------------------

{
  const roots = { workspacesRoot: '/srv/gildra/workspaces' }
  const managed = command => guardWorkspaceCommand(
    { name: 'bash', arguments: { command, cwd: '/srv/gildra/workspaces/proj/alex/sess-1' } },
    roots,
  )
  const outside = command => guardWorkspaceCommand(
    { name: 'bash', arguments: { command, cwd: '/home/alex/other' } },
    roots,
  )

  for (const dangerous of [
    'git checkout main',
    'git switch feature-x',
    'git checkout -- src/index.js',
    'git reset --hard HEAD~1',
    'git clean -fdx',
    'git clean -xdf',
    'git worktree remove ../sess-2',
    'git branch -D session/alex/sess-2',
  ]) {
    assert.equal(typeof managed(dangerous), 'string', `команда «${dangerous}» должна блокироваться в managed workspace`)
  }

  for (const safe of [
    'git status',
    'git add -A && git commit -m "x"',
    'git log --oneline',
    'git clean -n',
    'git branch --list',
    'npm test',
  ]) {
    assert.equal(managed(safe), undefined, `команда «${safe}» не должна блокироваться`)
  }

  // Вне управляемого корня guard не вмешивается вовсе.
  assert.equal(outside('git checkout main'), undefined)
  // Но команда, целящаяся в управляемый корень из чужого cwd, блокируется.
  assert.equal(
    typeof guardWorkspaceCommand(
      { name: 'bash', arguments: { command: 'git -C /srv/gildra/workspaces/proj/alex/sess-1 reset --hard', cwd: '/tmp' } },
      roots,
    ),
    'string',
  )
  assert.equal(guardWorkspaceCommand({ name: 'edit', arguments: { command: 'git checkout main' } }, roots), undefined)
  assert.equal(guardWorkspaceCommand({ name: 'bash', arguments: {} }, roots), undefined)
  assert.ok(ISOLATION_RULES.includes('Never switch branches'))
}

console.log('Gildra Runtime unit tests passed.')
