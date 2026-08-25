import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from './workspace-files-explorer-index.js'

const routes = new Map()
apply({
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  effect(callback) { callback() },
})

async function request(path, body) {
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
  assert.equal(status, 200)
  return JSON.parse(raw)
}

const parent = await mkdtemp(join(tmpdir(), 'gildra-files-test-'))
const workspace = join(parent, 'workspace')
const outside = join(parent, 'outside.txt')
try {
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'README.md'), '# Test\n')
  await writeFile(outside, 'secret\n')

  const root = await request('/api/wsf-explorer/root', { cwd: workspace })
  assert.deepEqual(root, { ok: true, path: await realpath(workspace) })

  const listed = await request('/api/wsf-explorer/list', { cwd: workspace, path: workspace })
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.entries.map(entry => entry.name), ['src', 'README.md'])

  const read = await request('/api/wsf-explorer/read', { cwd: workspace, path: join(workspace, 'README.md') })
  assert.equal(read.ok, true)
  assert.equal(read.content, '# Test\n')

  const escaped = await request('/api/wsf-explorer/read', { cwd: workspace, path: outside })
  assert.equal(escaped.ok, false)
  assert.match(escaped.error, /пределами рабочей папки/)
} finally {
  await rm(dirname(workspace), { recursive: true, force: true })
}

console.log('Workspace files compatibility tests passed.')
