// Безопасность реестра проектов (§14-§16): adopt произвольного пути,
// целостность canonical-репозитория и закрепление базы неизменяемым коммитом.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonStore } from '../lib/store.js'
import { runtimeRoots } from '../lib/paths.js'
import { createProjectRegistry, validateAdoptedRepository } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'
import { commitAll, git, revParse } from '../lib/gitx.js'

const base = await mkdtemp(join(tmpdir(), 'gildra projects '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })

const seed = join(base, 'seed repo')
await git(['init', '-b', 'main', seed])
await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
await writeFile(join(seed, 'app.txt'), 'v1\n')
await commitAll(seed, 'initial', { name: 'Seed', email: 'seed@test' })
await mkdir(join(seed, 'nested', 'deep'), { recursive: true })
await writeFile(join(seed, 'nested', 'deep', 'x.txt'), 'x\n')
await commitAll(seed, 'nested', { name: 'Seed', email: 'seed@test' })

const canonical = join(base, 'repos', 'demo.git')
await git(['clone', '--bare', seed, canonical])
await git(['-C', canonical, 'config', 'core.autocrlf', 'false'])

// --- Adopt: что принимаем и что отвергаем ---------------------------------
{
  // Bare-репозиторий — штатный случай.
  assert.ok(await validateAdoptedRepository(canonical))
  // Корень обычного репозитория тоже допустим.
  assert.ok(await validateAdoptedRepository(seed))

  // Не репозиторий.
  const plain = join(base, 'just a folder')
  await mkdir(plain, { recursive: true })
  await assert.rejects(validateAdoptedRepository(plain), (error) => error.code === 'INVALID_INPUT')

  // Несуществующий путь.
  await assert.rejects(validateAdoptedRepository(join(base, 'nope')), (error) => error.code === 'INVALID_INPUT')

  // Файл вместо каталога.
  await assert.rejects(validateAdoptedRepository(join(seed, 'app.txt')), (error) => error.code === 'INVALID_INPUT')

  // Служебный каталог .git: принять его — значит двигать ветки под чужим
  // рабочим деревом.
  await assert.rejects(
    validateAdoptedRepository(join(seed, '.git')),
    (error) => error.code === 'INVALID_INPUT' && /\.git/.test(error.message),
  )

  // Подкаталог репозитория: git ответил бы «это репозиторий», но принимать
  // его как проект нельзя — пользователь получил бы неожиданный корень.
  await assert.rejects(
    validateAdoptedRepository(join(seed, 'nested', 'deep')),
    (error) => error.code === 'INVALID_INPUT' && /корень репозитория/.test(error.message),
  )

  // Пустая строка и нулевой байт.
  await assert.rejects(validateAdoptedRepository(''), (error) => error.code === 'INVALID_INPUT')
  await assert.rejects(validateAdoptedRepository('/tmp/a\0b'), (error) => error.code === 'INVALID_INPUT')

  // Симлинк на репозиторий принимается, но канонизируется в реальный путь:
  // подменить цепочку симлинков после проверки уже нельзя.
  if (process.platform !== 'win32') {
    const link = join(base, 'link-to-repo')
    await symlink(canonical, link)
    const resolved = await validateAdoptedRepository(link)
    assert.notEqual(resolved, link, 'adopt обязан хранить канонический путь, а не симлинк')
    assert.match(resolved, /demo\.git$/)
  }
}

// --- Регистрация и закрепление базы неизменяемым коммитом (§16) -----------
const project = await projects.register({ projectId: 'demo', path: canonical })
assert.equal(project.defaultBranch, 'main')
{
  const mainSha = await revParse(canonical, 'main')
  const resolved = await projects.resolveBaseRef(project, 'main')
  assert.equal(resolved.baseRef, 'main')
  assert.equal(resolved.baseSha, mainSha, 'база закрепляется конкретным коммитом, а не именем ветки')

  const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })
  const workspace = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-pin' })
  assert.equal(workspace.baseSha, mainSha)

  // main уезжает вперёд — уже созданный workspace продолжает помнить СВОЮ базу.
  const mover = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-move' })
  await writeFile(join(mover.path, 'app.txt'), 'v2\n')
  await commitAll(mover.path, 'move main', { name: 'Alex', email: 'alex@test' })
  await workspaces.startMerge({ projectId: 'demo', sourceBranch: mover.branch })
  assert.notEqual(await revParse(canonical, 'main'), mainSha)
  assert.equal((await workspaces.getRecord(workspace.workspaceId)).baseSha, mainSha,
    'база существующей сессии не меняется задним числом')

  await workspaces.cleanupWorkspace(workspace.workspaceId, { confirmUnmerged: true })
  await workspaces.cleanupWorkspace(mover.workspaceId, { confirmUnmerged: true })
}

// --- Целостность canonical-репозитория (§15) ------------------------------
{
  const health = await projects.checkHealth('demo')
  assert.equal(health.health, 'healthy')
  assert.doesNotThrow(() => projects.assertUsable({ projectId: 'demo', health: 'healthy' }))

  // Повреждённый проект не принимает новые write-сессии, но НЕ удаляется.
  const degraded = { projectId: 'demo', health: 'degraded', healthProblems: ['broken link'] }
  assert.throws(() => projects.assertUsable(degraded), (error) => error.code === 'PROJECT_DEGRADED')

  const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })
  await store.write('projects', 'demo', { ...(await projects.get('demo')), health: 'degraded' })
  await assert.rejects(
    workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-degraded' }),
    (error) => error.code === 'PROJECT_DEGRADED',
    'повреждённый проект не должен принимать новые сессии',
  )
  // Данные проекта на месте — Runtime ничего не удалил.
  assert.ok(await projects.get('demo'))

  // После успешной проверки целостности проект снова пригоден.
  const rechecked = await projects.checkHealth('demo')
  assert.equal(rechecked.health, 'healthy')
  await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'sess-ok' })
}

// --- Клонирование: только чистые HTTPS-ссылки известных хостов -------------
{
  for (const badUrl of [
    'http://github.com/a/b.git',
    'https://evil.example/a/b.git',
    'https://user:pass@github.com/a/b.git',
    'git@github.com:a/b.git',
    'ext::sh -c whoami',
    'file:///etc/passwd',
  ]) {
    await assert.rejects(
      projects.register({ projectId: 'bad', repoUrl: badUrl }),
      (error) => error.code === 'INVALID_INPUT',
      `ссылка «${badUrl}» должна отклоняться`,
    )
  }
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime project registry tests passed.')
