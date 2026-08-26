// Durable-состояние Gildra Runtime: JSON-файлы с атомарной записью,
// schemaVersion, mkdir-локами и обработкой повреждений.
//
// Почему не SQLite: объём state мал (десятки записей), конкуренция —
// между небольшим числом процессов одного пользователя, а инвариант
// «только node:-модули» для локальных плагинов жёсткий. Повреждённый файл
// откладывается в сторону (.corrupt-*) и никогда не роняет процесс.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RuntimeError } from './errors.js'
import { assertId, assertSegment } from './ids.js'

const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 10_000

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export class JsonStore {
  constructor(rootDir, { onCorrupt } = {}) {
    this.rootDir = rootDir
    this.onCorrupt = onCorrupt ?? (() => {})
  }

  async ensureRoot() {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
  }

  filePath(collection, id) {
    return join(this.rootDir, assertSegment(collection, 'collection'), `${assertId(id, 'id')}.json`)
  }

  async read(collection, id) {
    const path = this.filePath(collection, id)
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
    try {
      return JSON.parse(text)
    } catch {
      // Повреждение не должно ронять Runtime и не должно молча теряться:
      // файл откладывается в сторону для диагностики, запись считается
      // отсутствующей.
      const aside = `${path}.corrupt-${Date.now().toString(36)}`
      await rename(path, aside).catch(() => {})
      this.onCorrupt({ collection, id, aside })
      return undefined
    }
  }

  async write(collection, id, value) {
    const path = this.filePath(collection, id)
    await mkdir(join(this.rootDir, collection), { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }

  async delete(collection, id) {
    await rm(this.filePath(collection, id), { force: true })
  }

  async list(collection) {
    try {
      const names = await readdir(join(this.rootDir, assertSegment(collection, 'collection')))
      return names
        .filter(name => name.endsWith('.json'))
        .map(name => name.slice(0, -'.json'.length))
        .sort()
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  // Межпроцессный лок на именованную операцию (fetch канонического репо,
  // выделение порта, …): атомарный mkdir + meta с pid. Лок мёртвого процесса
  // перехватывается через rename, чтобы два претендента не удалили один лок.
  async withLock(name, action, { timeoutMs = LOCK_TIMEOUT_MS } = {}) {
    const lockPath = join(this.rootDir, 'locks', `${assertSegment(name, 'lock')}.lock`)
    await mkdir(join(this.rootDir, 'locks'), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        await mkdir(lockPath)
        break
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      let ownerPid = null
      try {
        ownerPid = JSON.parse(await readFile(join(lockPath, 'meta.json'), 'utf8')).pid
      } catch {
        // Лок без meta — либо гонка с только что захватившим (meta вот-вот
        // появится), либо брошенный. Решает таймаут ниже.
      }
      if (Number.isInteger(ownerPid) && ownerPid !== process.pid && !processAlive(ownerPid)) {
        const stale = `${lockPath}.stale-${randomUUID()}`
        try {
          await rename(lockPath, stale)
          await rm(stale, { recursive: true, force: true }).catch(() => {})
        } catch {
          // Другой процесс успел перехватить — продолжаем ждать.
        }
        continue
      }
      if (Date.now() >= deadline) {
        throw new RuntimeError('WORKSPACE_BUSY', `Операция «${name}» занята другим процессом.`, { lock: name, ownerPid })
      }
      await new Promise(resolveTimer => setTimeout(resolveTimer, LOCK_RETRY_MS))
    }
    try {
      await writeFile(join(lockPath, 'meta.json'), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), { mode: 0o600 })
      return await action()
    } finally {
      await rm(lockPath, { recursive: true, force: true }).catch(() => {})
    }
  }
}
