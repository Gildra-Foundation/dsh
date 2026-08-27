// Port Allocator: session-scoped порты dev-серверов (§24, §25).
//
// Аллокация сериализована store-локом (никакой гонки между двумя allocate),
// свободность порта проверяется реальной пробой bind на 127.0.0.1, lease
// хранится в state и переживает перезапуск Runtime.
//
// Ключевое правило переиспользования: смерть владельца сама по себе НЕ делает
// порт свободным. Порт возвращается в пул, только если владелец мёртв И проба
// bind проходит — иначе на порту всё ещё кто-то слушает (переживший владельца
// потомок или посторонний процесс), и выдача такого порта новой сессии
// обернулась бы EADDRINUSE уже внутри чужого dev-сервера.
//
// Коды ошибок разведены намеренно: PORT_POOL_EXHAUSTED — «в выделенном
// диапазоне не осталось свободных портов» (проблема ёмкости пула),
// PORT_UNAVAILABLE — «конкретный запрошенный порт недоступен» (проблема одного
// порта). UI по ним показывает разные подсказки.

import { createServer } from 'node:net'
import { RuntimeError } from './errors.js'
import { assertSegment, sanitizeSegment } from './ids.js'

const PORTS = 'ports'

const DEFAULT_RANGE = Object.freeze({ from: 31000, to: 31999 })
const DEFAULT_MAX_PORTS_PER_SESSION = 8

function parseRange(env) {
  const raw = String(env.GILDRA_DSH_PORT_RANGE ?? '')
  const match = raw.match(/^(\d{2,5})-(\d{2,5})$/)
  if (!match) return { ...DEFAULT_RANGE }
  const from = Number(match[1])
  const to = Number(match[2])
  // Невалидный диапазон (перевёрнутый, привилегированные порты, выход за
  // 65535) не должен ни ронять Runtime, ни молча превращаться в «весь диапазон
  // портов системы»: тихо падаем в безопасный дефолт.
  if (from >= to || from < 1024 || to > 65535) return { ...DEFAULT_RANGE }
  return { from, to }
}

function positiveInt(raw, fallback) {
  const value = Number(raw)
  // Пусто/ноль/отрицательное/дробное/NaN не должны молча отключать лимит.
  return Number.isInteger(value) && value > 0 ? value : fallback
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

export function probePortFree(port, { host = '127.0.0.1' } = {}) {
  return new Promise((resolveProbe) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolveProbe(false))
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolveProbe(true))
    })
  })
}

export function createPortAllocator({ store, env = process.env, isSessionAlive } = {}) {
  const range = parseRange(env)
  const maxPortsPerSession = positiveInt(env.GILDRA_DSH_MAX_PORTS_PER_SESSION, DEFAULT_MAX_PORTS_PER_SESSION)
  // «Сессия жива» = жив процесс, который держал lease. Предикат вынесен в
  // параметр, чтобы вызывающий слой мог подставить более точную проверку
  // (статус сессии в store), не переписывая аллокатор.
  const sessionAlive = typeof isSessionAlive === 'function' ? isSessionAlive : (record => processAlive(record?.pid))

  async function leases() {
    const rows = []
    for (const id of await store.list(PORTS)) {
      const record = await store.read(PORTS, id)
      if (record) rows.push(record)
    }
    return rows
  }

  function leaseRecord({ port, name, sessionId, pid }) {
    return {
      schemaVersion: 1,
      id: `port-${String(port)}`,
      port,
      name,
      sessionId,
      pid,
      acquiredAt: new Date().toISOString(),
    }
  }

  async function allocate({ sessionId, name = 'app', pid = process.pid, port: requestedPort } = {}) {
    assertSegment(sanitizeSegment(name, 'app'), 'portName')
    return store.withLock('ports', async () => {
      const existing = await leases()
      const mine = existing.filter(record => record.sessionId === sessionId)
      if (mine.length >= maxPortsPerSession) {
        throw new RuntimeError(
          'LIMIT_EXCEEDED',
          `Сессия уже держит ${String(mine.length)} портов при лимите ${String(maxPortsPerSession)} (GILDRA_DSH_MAX_PORTS_PER_SESSION).`,
          { sessionId, limit: maxPortsPerSession, held: mine.length },
        )
      }
      const taken = new Map(existing.map(record => [record.port, record]))

      // Путь «нужен конкретный порт» (фиксированный порт в runtime-профиле
      // проекта): отказ здесь — про один порт, а не про ёмкость пула.
      if (requestedPort !== undefined) {
        const wanted = Number(requestedPort)
        if (!Number.isInteger(wanted) || wanted < range.from || wanted > range.to) {
          throw new RuntimeError('PORT_UNAVAILABLE', `Порт ${String(requestedPort)} вне выделенного диапазона ${String(range.from)}–${String(range.to)}.`, { port: requestedPort, range })
        }
        const holder = taken.get(wanted)
        const free = await probePortFree(wanted)
        if ((holder && sessionAlive(holder)) || !free) {
          throw new RuntimeError('PORT_UNAVAILABLE', `Порт ${String(wanted)} занят и не может быть выделен сессии.`, {
            port: wanted,
            listening: !free,
            leased: Boolean(holder),
          })
        }
        if (holder) await store.delete(PORTS, holder.id).catch(() => {})
        const record = leaseRecord({ port: wanted, name, sessionId, pid })
        await store.write(PORTS, record.id, record)
        return record
      }

      let heldByLive = 0
      let staleButListening = 0
      let occupied = 0
      for (let port = range.from; port <= range.to; port += 1) {
        const holder = taken.get(port)
        if (holder && sessionAlive(holder)) {
          heldByLive += 1
          continue
        }
        const free = await probePortFree(port)
        if (!free) {
          // Порт реально слушается. Если lease при этом «мёртвый», его НЕЛЬЗЯ
          // снимать: процесс на порту жив и переживёт нашу бухгалтерию.
          if (holder) staleButListening += 1
          else occupied += 1
          continue
        }
        // Мёртвый lease на реально свободном порту — возвращаем порт в пул.
        if (holder) await store.delete(PORTS, holder.id).catch(() => {})
        const record = leaseRecord({ port, name, sessionId, pid })
        await store.write(PORTS, record.id, record)
        return record
      }
      throw new RuntimeError(
        'PORT_POOL_EXHAUSTED',
        `В диапазоне ${String(range.from)}–${String(range.to)} не осталось свободных портов. Завершите неиспользуемые сессии или расширьте GILDRA_DSH_PORT_RANGE.`,
        { range, heldByLive, staleButListening, occupied },
      )
    }, { timeoutMs: 30_000 })
  }

  // Явное освобождение портов сессии (cleanup). Здесь мы не проверяем, слушает
  // ли кто-то порт: сессия уходит, её бухгалтерия должна уйти вместе с ней.
  // От выдачи всё ещё занятого порта соседу защищает проба bind в allocate.
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

  // Сбор протухших lease'ов (§24): освобождаем только те, чья сессия мертва И
  // порт реально свободен. Всё остальное сознательно удерживаем и объясняем
  // причину — «непонятно, значит не трогаем» здесь дешевле, чем конфликт
  // портов у живого dev-сервера.
  async function reclaimStale() {
    return store.withLock('ports', async () => {
      const reclaimed = []
      const retained = []
      for (const record of await leases()) {
        if (sessionAlive(record)) {
          retained.push({ port: record.port, sessionId: record.sessionId, reason: 'SESSION_ALIVE' })
          continue
        }
        if (!(await probePortFree(record.port))) {
          retained.push({ port: record.port, sessionId: record.sessionId, reason: 'PORT_IN_USE' })
          continue
        }
        await store.delete(PORTS, record.id).catch(() => {})
        reclaimed.push({ port: record.port, sessionId: record.sessionId })
      }
      return { reclaimed, retained }
    }, { timeoutMs: 30_000 })
  }

  return {
    allocate,
    releaseForSession,
    listForSession,
    reclaimStale,
    range,
    limits: Object.freeze({ maxPortsPerSession }),
  }
}
