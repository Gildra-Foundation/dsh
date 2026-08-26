// Port Allocator: session-scoped порты dev-серверов.
//
// Аллокация сериализована store-локом (никакой гонки между двумя allocate),
// свободность порта проверяется реальной пробой bind на 127.0.0.1, lease
// хранится в state и переживает перезапуск Runtime. Порт мёртвой сессии
// (pid владельца умер) переиспользуется автоматически.

import { createServer } from 'node:net'
import { RuntimeError } from './errors.js'
import { assertSegment, sanitizeSegment } from './ids.js'

const PORTS = 'ports'

function parseRange(env) {
  const raw = String(env.GILDRA_DSH_PORT_RANGE ?? '31000-31999')
  const match = raw.match(/^(\d{2,5})-(\d{2,5})$/)
  const from = match ? Number(match[1]) : 31000
  const to = match ? Number(match[2]) : 31999
  if (!match || from >= to || from < 1024 || to > 65535) return { from: 31000, to: 31999 }
  return { from, to }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function probePortFree(port) {
  return new Promise((resolveProbe) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolveProbe(false))
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => resolveProbe(true))
    })
  })
}

export function createPortAllocator({ store, env = process.env }) {
  const range = parseRange(env)

  async function leases() {
    const rows = []
    for (const id of await store.list(PORTS)) {
      const record = await store.read(PORTS, id)
      if (record) rows.push(record)
    }
    return rows
  }

  async function allocate({ sessionId, name = 'app', pid = process.pid }) {
    assertSegment(sanitizeSegment(name, 'app'), 'portName')
    return store.withLock('ports', async () => {
      const existing = await leases()
      const taken = new Map(existing.map(record => [record.port, record]))
      for (let port = range.from; port <= range.to; port++) {
        const holder = taken.get(port)
        if (holder) {
          // Порт мёртвой сессии (владелец-процесс исчез) переиспользуем.
          if (processAlive(holder.pid)) continue
          await store.delete(PORTS, holder.id).catch(() => {})
        }
        if (!(await probePortFree(port))) continue
        const record = {
          schemaVersion: 1,
          id: `port-${String(port)}`,
          port,
          name,
          sessionId,
          pid,
          acquiredAt: new Date().toISOString(),
        }
        await store.write(PORTS, record.id, record)
        return record
      }
      throw new RuntimeError('PORT_UNAVAILABLE', `В диапазоне ${String(range.from)}–${String(range.to)} нет свободных портов.`, { range })
    }, { timeoutMs: 30_000 })
  }

  async function releaseForSession(sessionId) {
    let released = 0
    for (const record of await leases()) {
      if (record.sessionId !== sessionId) continue
      await store.delete(PORTS, record.id).catch(() => {})
      released += 1
    }
    return { released }
  }

  async function listForSession(sessionId) {
    return (await leases()).filter(record => record.sessionId === sessionId)
  }

  return { allocate, releaseForSession, listForSession, range }
}
