import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from './workspace-files-explorer-index.js'

function mount(registeredPaths = []) {
  const routes = new Map()
  apply({
    workspaceRegistry: {
      async resolveByPath(path) {
        const canonical = await realpath(path)
        return registeredPaths.includes(canonical) ? { path: canonical } : undefined
      },
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect(callback) { callback() },
  })
  return routes
}

async function request(routes, path, body, expectedStatus = 200) {
  const req = Readable.from([JSON.stringify(body)])
  req.method = 'POST'
  req.headers = { 'content-type': 'application/json' }
  let status
  let raw = ''
  const res = {
    writeHead(value) { status = value },
    end(value = '') { raw += value },
  }
  await routes.get(path).handler(req, res)
  assert.equal(status, expectedStatus)
  return JSON.parse(raw)
}

const originalServerMode = process.env.GILDRA_DSH_SERVER
const originalPreviewOverride = process.env.GILDRA_DSH_ALLOW_UNAUTHENTICATED_FILE_PREVIEW
delete process.env.GILDRA_DSH_SERVER
delete process.env.GILDRA_DSH_ALLOW_UNAUTHENTICATED_FILE_PREVIEW

const parent = await mkdtemp(join(tmpdir(), 'gildra-files-test-'))
const workspace = join(parent, 'workspace')
const outside = join(parent, 'outside.txt')
try {
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'README.md'), '# Test\n')
  await writeFile(outside, 'secret\n')

  const canonicalWorkspace = await realpath(workspace)
  const desktopRoutes = mount([canonicalWorkspace])
  const root = await request(desktopRoutes, '/api/wsf-explorer/root', { cwd: workspace })
  assert.deepEqual(root, { ok: true, path: canonicalWorkspace })

  const listed = await request(desktopRoutes, '/api/wsf-explorer/list', { cwd: workspace, path: workspace })
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.entries.map(entry => entry.name), ['src', 'README.md'])

  const read = await request(desktopRoutes, '/api/wsf-explorer/read', { cwd: workspace, path: join(workspace, 'README.md') })
  assert.equal(read.ok, true)
  assert.equal(read.content, '# Test\n')

  const escaped = await request(desktopRoutes, '/api/wsf-explorer/read', { cwd: workspace, path: outside })
  assert.equal(escaped.ok, false)
  assert.match(escaped.error, /пределами рабочей папки/)

  const attackerSelectedRoot = await request(
    desktopRoutes,
    '/api/wsf-explorer/read',
    { cwd: parent, path: outside },
  )
  assert.equal(attackerSelectedRoot.ok, false)
  assert.match(attackerSelectedRoot.error, /не зарегистрирована/)

  // --- Матрица безопасности чтения файлов -----------------------------------
  // Кейс «обычный файл внутри workspace» и кейс «абсолютный путь вне
  // workspace» уже покрыты выше (README.md и outside.txt). Фикстуры матрицы
  // создаются только после проверок list, чтобы не менять ожидаемое
  // содержимое корня рабочей папки.

  // ../-traversal: литеральные «..» в присланном пути выводят за пределы root.
  const traversal = await request(desktopRoutes, '/api/wsf-explorer/read', {
    cwd: workspace,
    path: [workspace, 'src', '..', '..', 'outside.txt'].join(sep),
  })
  assert.equal(traversal.ok, false)
  assert.match(traversal.error, /пределами рабочей папки/)

  // Коллизия префиксов: сосед «workspace-project-evil» не должен проходить
  // проверку границ при корне «workspace-project».
  const project = join(parent, 'workspace-project')
  const evil = join(parent, 'workspace-project-evil')
  await mkdir(project, { recursive: true })
  await mkdir(evil, { recursive: true })
  await writeFile(join(evil, 'secret.txt'), 'evil twin\n')
  const collisionRoutes = mount([await realpath(project)])
  const collision = await request(collisionRoutes, '/api/wsf-explorer/read', {
    cwd: project,
    path: join(evil, 'secret.txt'),
  })
  assert.equal(collision.ok, false)
  assert.match(collision.error, /пределами рабочей папки/)

  // Несуществующий путь: аккуратная ошибка в ответе, без крэша процесса.
  const missing = await request(desktopRoutes, '/api/wsf-explorer/read', {
    cwd: workspace,
    path: join(workspace, 'no-such-file.txt'),
  })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /ENOENT/)

  // Файл больше MAX_BYTES (262 144): ответ tooLarge без содержимого.
  await writeFile(join(workspace, 'src', 'big.txt'), Buffer.alloc(262_145, 0x61))
  const big = await request(desktopRoutes, '/api/wsf-explorer/read', {
    cwd: workspace,
    path: join(workspace, 'src', 'big.txt'),
  })
  assert.equal(big.ok, false)
  assert.equal(big.tooLarge, true)
  assert.equal(big.size, 262_145)
  assert.match(big.error, /256 КБ/)
  assert.equal(big.content, undefined)

  // Каталог вместо файла: отказ. На Windows open() каталога падает системной
  // ошибкой ещё до проверки типа, поэтому текст сообщения сверяем не везде.
  const dirRead = await request(desktopRoutes, '/api/wsf-explorer/read', {
    cwd: workspace,
    path: join(workspace, 'src'),
  })
  assert.equal(dirRead.ok, false)
  if (process.platform !== 'win32') assert.match(dirRead.error, /не является файлом/)

  if (process.platform !== 'win32') {
    // Симлинк-кейсы выполняются только вне Windows: там создание символьных
    // ссылок требует привилегии SeCreateSymbolicLinkPrivilege (или режима
    // разработчика), и symlink() на обычном раннере падает с EPERM.
    const outsideDir = join(parent, 'outside-dir')
    await mkdir(join(outsideDir, 'inner'), { recursive: true })
    await writeFile(join(outsideDir, 'secret.txt'), 'outside dir secret\n')
    await writeFile(join(outsideDir, 'inner', 'data.txt'), 'nested outside secret\n')

    // Симлинк внутри workspace, указывающий на файл снаружи.
    await symlink(outside, join(workspace, 'src', 'link-file.txt'))
    const linkFile = await request(desktopRoutes, '/api/wsf-explorer/read', {
      cwd: workspace,
      path: join(workspace, 'src', 'link-file.txt'),
    })
    assert.equal(linkFile.ok, false)
    assert.match(linkFile.error, /пределами рабочей папки/)

    // Симлинк на каталог снаружи + чтение файла через него.
    await symlink(outsideDir, join(workspace, 'src', 'link-dir'))
    const throughDir = await request(desktopRoutes, '/api/wsf-explorer/read', {
      cwd: workspace,
      path: join(workspace, 'src', 'link-dir', 'secret.txt'),
    })
    assert.equal(throughDir.ok, false)
    assert.match(throughDir.error, /пределами рабочей папки/)

    // Вложенный симлинк: файл лежит в подкаталоге каталога-симлинка, то есть
    // прыжок наружу происходит в середине пути, а не в финальном компоненте.
    const nested = await request(desktopRoutes, '/api/wsf-explorer/read', {
      cwd: workspace,
      path: join(workspace, 'src', 'link-dir', 'inner', 'data.txt'),
    })
    assert.equal(nested.ok, false)
    assert.match(nested.error, /пределами рабочей папки/)

    // Симлинк на легальную цель внутри workspace: realpath остаётся в root,
    // поэтому по семантике патча файл читается, а path — канонический.
    await symlink(join(workspace, 'README.md'), join(workspace, 'src', 'alias.md'))
    const alias = await request(desktopRoutes, '/api/wsf-explorer/read', {
      cwd: workspace,
      path: join(workspace, 'src', 'alias.md'),
    })
    assert.equal(alias.ok, true)
    assert.equal(alias.content, '# Test\n')
    assert.equal(alias.path, join(canonicalWorkspace, 'README.md'))
  }

  process.env.GILDRA_DSH_SERVER = '1'
  // Even if an unauthenticated caller first registers the attacker-selected
  // root through Harness' workspace API, server mode must reject the preview.
  const serverRoutes = mount([canonicalWorkspace, parent])
  const blocked = await request(
    serverRoutes,
    '/api/wsf-explorer/read',
    { cwd: parent, path: outside },
    403,
  )
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /многопользовательском сервере/)

  process.env.GILDRA_DSH_ALLOW_UNAUTHENTICATED_FILE_PREVIEW = '1'
  const trustedSingleUserRoutes = mount([canonicalWorkspace])
  const explicitlyAllowed = await request(
    trustedSingleUserRoutes,
    '/api/wsf-explorer/read',
    { cwd: workspace, path: join(workspace, 'README.md') },
  )
  assert.equal(explicitlyAllowed.content, '# Test\n')
} finally {
  await rm(dirname(workspace), { recursive: true, force: true })
  if (originalServerMode === undefined) delete process.env.GILDRA_DSH_SERVER
  else process.env.GILDRA_DSH_SERVER = originalServerMode
  if (originalPreviewOverride === undefined) delete process.env.GILDRA_DSH_ALLOW_UNAUTHENTICATED_FILE_PREVIEW
  else process.env.GILDRA_DSH_ALLOW_UNAUTHENTICATED_FILE_PREVIEW = originalPreviewOverride
}

console.log('Workspace files compatibility tests passed.')
