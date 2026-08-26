import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
