/**
 * Gildra compatibility host for workspace-files-explorer 1.0.0.
 *
 * The upstream browser UI is kept unchanged. This host adapter replaces only
 * its three read-only routes because the upstream DSH fs bridge can stall on
 * Harness 0.1.1-rc.2. The root must already exist in Harness' workspace
 * registry, and every resolved target must remain inside that canonical root,
 * including after resolving symbolic links. File reads go through a file
 * descriptor opened from the canonical path, so the validated target cannot be
 * swapped between the boundary check and the read.
 */
import { constants } from 'node:fs'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const name = 'workspace-files-explorer'
export const inject = ['webServer', 'workspaceRegistry']

const MAX_ENTRIES = 500
const MAX_BYTES = 262_144
const MAX_BODY_BYTES = 8_192
const SERVER_PREVIEW_OVERRIDE = 'GILDRA_DSH_ALLOW_UNAUTHENTICATED_FILE_PREVIEW'
// O_NOFOLLOW rejects a symlink that replaced the final path component after
// realpath(). Windows does not define the constant, so it is omitted there.
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request-too-large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function cwdOf(input) {
  return typeof input?.cwd === 'string' && input.cwd.trim() !== ''
    ? resolve(input.cwd)
    : undefined
}

async function workspaceTarget(workspaceRegistry, input, requestedPath = undefined) {
  const rootPath = cwdOf(input)
  if (rootPath === undefined) throw new Error('Не удалось определить рабочую папку')
  const workspace = await workspaceRegistry.resolveByPath(rootPath)
  if (workspace === undefined) throw new Error('Рабочая папка не зарегистрирована')
  const root = workspace.path
  const target = await realpath(requestedPath ? resolve(requestedPath) : root)
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Путь находится за пределами рабочей папки')
  }
  return { root, target }
}

async function handleRoot(workspaceRegistry, input) {
  const { target } = await workspaceTarget(workspaceRegistry, input)
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error('Рабочий путь не является папкой')
  return { ok: true, path: target }
}

async function handleList(workspaceRegistry, input) {
  const { target } = await workspaceTarget(
    workspaceRegistry,
    input,
    typeof input?.path === 'string' ? input.path : undefined,
  )
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error('Выбранный путь не является папкой')
  const sourceEntries = await readdir(target, { withFileTypes: true })
  const visible = sourceEntries.slice(0, MAX_ENTRIES)
  const entries = await Promise.all(visible.map(async (entry) => {
    const entryPath = resolve(target, entry.name)
    let size = null
    if (entry.isFile()) {
      try { size = (await stat(entryPath)).size } catch { size = null }
    }
    return { name: entry.name, path: entryPath, isDir: entry.isDirectory(), size }
  }))
  entries.sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
  })
  return { ok: true, path: target, entries, truncated: sourceEntries.length > MAX_ENTRIES }
}

async function handleRead(workspaceRegistry, input) {
  if (typeof input?.path !== 'string' || input.path.trim() === '') throw new Error('Не выбран файл')
  const { target } = await workspaceTarget(workspaceRegistry, input, input.path)
  // Known residual race: an intermediate directory of the canonical target can
  // still be swapped for a symlink between realpath() and open(). Closing that
  // window needs an openat()-style walk, out of scope for this small adapter.
  const handle = await open(target, READ_FLAGS)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Выбранный путь не является файлом')
    if (info.size > MAX_BYTES) {
      return { ok: false, tooLarge: true, size: info.size, error: 'Файл больше 256 КБ и не открыт для предпросмотра' }
    }
    const buffer = await handle.readFile()
    if (buffer.includes(0)) {
      return { ok: false, binary: true, size: info.size, error: 'Двоичный файл нельзя показать как текст' }
    }
    return { ok: true, path: target, content: buffer.toString('utf8'), size: info.size }
  } finally {
    await handle.close()
  }
}

function filePreviewAvailable() {
  // workspaceRegistry limits roots but is not authentication: another local
  // caller can register a directory through Harness' public workspace API.
  // Managed multi-user servers therefore fail closed before parsing the body.
  return process.env.GILDRA_DSH_SERVER !== '1' || process.env[SERVER_PREVIEW_OVERRIDE] === '1'
}

function route(path, operation, available) {
  return {
    kind: 'exact',
    path,
    async handler(req, res) {
      if (!available) {
        return json(res, 403, {
          ok: false,
          error: 'Предпросмотр файлов отключён на многопользовательском сервере',
        })
      }
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return json(res, 415, { ok: false, error: 'content-type-must-be-json' })
      }
      try {
        return json(res, 200, await operation(await readJsonBody(req)))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return json(res, message === 'request-too-large' ? 413 : 200, { ok: false, error: message })
      }
    },
  }
}

export function apply(ctx) {
  const available = filePreviewAvailable()
  const operations = {
    root: input => handleRoot(ctx.workspaceRegistry, input),
    list: input => handleList(ctx.workspaceRegistry, input),
    read: input => handleRead(ctx.workspaceRegistry, input),
  }
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register(route('/api/wsf-explorer/root', operations.root, available)),
      ctx.webServer.register(route('/api/wsf-explorer/list', operations.list, available)),
      ctx.webServer.register(route('/api/wsf-explorer/read', operations.read, available)),
    ]
    return () => disposers.forEach(dispose => dispose())
  }, 'workspace-files-explorer: Gildra read-only routes')
}
