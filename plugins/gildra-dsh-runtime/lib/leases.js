// Lease Manager: эксклюзивное право записи в workspace.
//
// Инвариант: в одном worktree одновременно максимум один writer. Захват —
// атомарный mkdir; владение подтверждается случайным owner-token (не PID:
// PID переиспользуются). Состояния:
//   ACTIVE   — владелец жив и heartbeat свежий: забирать нельзя;
//   STALE    — процесс с таким PID жив, но heartbeat протух: владелец завис
//              или не шлёт heartbeat; забирать всё ещё нельзя (живой owner);
//   ORPHANED — PID мёртв ЛИБО heartbeat старше жёсткого порога (защита от
//              PID-reuse: «живой» PID с давно умершим heartbeat считается
//              чужим процессом): такой lease можно перехватить.
// Перехват и снятие идут через rename, чтобы два претендента не удалили один
// и тот же lease. Чужой активный lease не удаляется никогда.

import { hostname } from 'node:os'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RuntimeError } from './errors.js'
import { assertId, generateOwnerToken } from './ids.js'
import { appendAudit } from './audit.js'

function timing(env, name, fallback) {
  const value = Number(env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
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

// Сравнение токенов постоянным временем: токен — capability сессии, и хотя
// граница безопасности между людьми — Unix-пользователь, дешёвая защита от
// сравнения по префиксу здесь ничего не стоит.
function tokensEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function createLeaseManager({ roots, env = process.env }) {
  const staleMs = timing(env, 'GILDRA_DSH_LEASE_STALE_MS', 90_000)
  const orphanMs = timing(env, 'GILDRA_DSH_LEASE_ORPHAN_MS', 15 * 60_000)

  const leasesRoot = join(roots.stateRoot, 'leases')
  const leaseDir = workspaceId => join(leasesRoot, `${assertId(workspaceId, 'workspaceId')}.lease`)
  // Счётчик поколений живёт ОТДЕЛЬНО от самого lease: он обязан пережить
  // удаление lease при takeover, иначе номер поколения переиспользовался бы
  // и fencing терял смысл.
  const generationPath = workspaceId => join(leasesRoot, `${assertId(workspaceId, 'workspaceId')}.generation.json`)

  async function readGeneration(workspaceId) {
    try {
      const value = JSON.parse(await readFile(generationPath(workspaceId), 'utf8'))
      return Number.isInteger(value?.generation) ? value.generation : 0
    } catch {
      return 0
    }
  }

  // Инкремент поколения выполняется ТОЛЬКО победителем mkdir-гонки, то есть
  // уже под взаимным исключением каталога lease.
  async function nextGeneration(workspaceId) {
    const generation = (await readGeneration(workspaceId)) + 1
    const path = generationPath(workspaceId)
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify({ workspaceId, generation })}\n`, { mode: 0o600 })
    await rename(temporary, path)
    return generation
  }

  async function readMetaAt(dir) {
    try {
      return JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
    } catch {
      return undefined
    }
  }

  function readMeta(workspaceId) {
    return readMetaAt(leaseDir(workspaceId))
  }

  function classify(meta, now = Date.now()) {
    if (!meta) return 'ORPHANED'
    const heartbeatAge = now - Date.parse(meta.heartbeatAt ?? meta.acquiredAt ?? 0)
    if (!Number.isFinite(heartbeatAge) || heartbeatAge >= orphanMs) return 'ORPHANED'
    if (!processAlive(meta.pid)) return 'ORPHANED'
    if (heartbeatAge >= staleMs) return 'STALE'
    return 'ACTIVE'
  }

  async function stateOf(workspaceId) {
    try {
      await access(leaseDir(workspaceId))
    } catch {
      return { state: 'FREE' }
    }
    // Каталог без meta — гонка с захватчиком или обломок; classify(undefined)
    // относит его к ORPHANED, и следующий acquire его перехватит.
    const meta = await readMeta(workspaceId)
    const state = classify(meta)
    return {
      state,
      generation: meta?.generation,
      ...(meta ? {
        sessionId: meta.sessionId,
        userId: meta.userId,
        pid: meta.pid,
        host: meta.host,
        acquiredAt: meta.acquiredAt,
        heartbeatAt: meta.heartbeatAt,
      } : {}),
    }
  }

  async function writeMeta(workspaceId, meta) {
    const path = join(leaseDir(workspaceId), 'meta.json')
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  }

  // Перехват осиротевшего lease выполняется под отдельным reaper-мьютексом:
  // без него между «прочитал meta мёртвого владельца» и «rename» конкурент
  // мог унести уже пересозданный СВЕЖИЙ lease победителя (dir живёт по тому
  // же пути), и выигрывали двое. Жнец ровно один (атомарный mkdir), и уже под
  // мьютексом он перепроверяет, что meta не сменилась (сравнение ownerToken).
  async function reapOrphanedLease(dir, expected) {
    const reap = `${dir}.reap`
    try {
      await mkdir(reap)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      // Жнец-предшественник упал? Критическая секция — миллисекунды, поэтому
      // reap старше 30 секунд считается брошенным.
      try {
        const info = await stat(reap)
        if (Date.now() - info.mtimeMs > 30_000) await rm(reap, { recursive: true, force: true })
      } catch {
        /* reap уже исчез */
      }
      await new Promise(resolveTimer => setTimeout(resolveTimer, 20))
      return false
    }
    try {
      const current = await readMetaAt(dir)
      if (classify(current) !== 'ORPHANED') return false
      // Meta сменилась с момента решения о перехвате — это чужой свежий
      // lease, его не трогаем. (expected === null означает «ожидаем обломок
      // без meta»: появление meta тоже отменяет перехват.)
      if ((current?.ownerToken ?? null) !== expected) return false
      const aside = `${dir}.orphan-${randomUUID()}`
      await rename(dir, aside)
      await rm(aside, { recursive: true, force: true }).catch(() => {})
      return true
    } catch {
      return false
    } finally {
      await rm(reap, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function acquire({ workspaceId, sessionId, userId, mode = 'write', pid = process.pid, host = hostname() }) {
    await mkdir(leasesRoot, { recursive: true, mode: 0o700 })
    const dir = leaseDir(workspaceId)
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await mkdir(dir)
        // Победитель mkdir — единственный, кто двигает поколение.
        const generation = await nextGeneration(workspaceId)
        const meta = {
          schemaVersion: 1,
          workspaceId,
          sessionId,
          userId,
          mode,
          pid,
          host,
          generation,
          ownerToken: generateOwnerToken(),
          // Момент старта владельца: вместе с pid отличает наш процесс от
          // чужого, занявшего тот же PID после перезапуска системы.
          processStartedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
          acquiredAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        }
        await writeMeta(workspaceId, meta)
        await appendAudit(roots.stateRoot, 'lease.acquired', { workspaceId, sessionId, userId, pid, generation })
        return { ownerToken: meta.ownerToken, workspaceId, state: 'ACTIVE', generation }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      let current = await readMeta(workspaceId)
      // Окно mkdir→writeMeta у только что победившего захватчика: каталог
      // уже есть, meta ещё нет. Даём победителю короткий grace, прежде чем
      // считать каталог обломком, — иначе конкурент перехватил бы живой lease.
      for (let waitIndex = 0; waitIndex < 20 && !current; waitIndex++) {
        await new Promise(resolveTimer => setTimeout(resolveTimer, 15))
        current = await readMeta(workspaceId)
      }
      const state = classify(current)
      if (state === 'ACTIVE' || state === 'STALE') {
        // Живой владелец (пусть даже с протухшим heartbeat) никогда не
        // выселяется автоматически.
        throw new RuntimeError('WORKSPACE_LOCKED', `Workspace уже занят write-сессией «${current?.sessionId ?? 'unknown'}» (${state}).`, {
          workspaceId,
          holder: { sessionId: current?.sessionId, userId: current?.userId, pid: current?.pid, state },
        })
      }
      if (await reapOrphanedLease(dir, current?.ownerToken ?? null)) {
        await appendAudit(roots.stateRoot, 'lease.orphan-takeover', { workspaceId, previousSession: current?.sessionId })
      }
      // Исход решает следующая итерация: mkdir выигрывает ровно один.
    }
    throw new RuntimeError('WORKSPACE_LOCKED', 'Не удалось захватить write-lease.', { workspaceId })
  }

  async function heartbeat(workspaceId, ownerToken) {
    const meta = await readMeta(workspaceId)
    if (!meta || !tokensEqual(meta.ownerToken, ownerToken)) {
      throw new RuntimeError('FOREIGN_OWNER', 'Lease принадлежит другой сессии или уже снят.', { workspaceId })
    }
    await writeMeta(workspaceId, { ...meta, heartbeatAt: new Date().toISOString() })
    return { state: 'ACTIVE', generation: meta.generation }
  }

  // Fencing: проверка, что предъявитель — ВСЁ ЕЩЁ текущий владелец. Токен
  // сам по себе закрывает ABA на короткой операции, но длинная destructive-
  // операция (cleanup, финализация merge) может начаться при живом lease и
  // дойти до необратимого шага уже после takeover. Поэтому перед последним
  // шагом поколение перепроверяется — устаревший writer не делает ничего.
  async function assertFence(workspaceId, { ownerToken, generation } = {}) {
    const meta = await readMeta(workspaceId)
    if (!meta || !tokensEqual(meta.ownerToken, ownerToken)) {
      throw new RuntimeError('FOREIGN_OWNER', 'Операция отклонена: lease принадлежит другой сессии.', { workspaceId })
    }
    if (generation !== undefined && meta.generation !== generation) {
      throw new RuntimeError('FOREIGN_OWNER', 'Операция отклонена: workspace был перехвачен другой сессией.', {
        workspaceId,
        expectedGeneration: generation,
        currentGeneration: meta.generation,
      })
    }
    return { generation: meta.generation }
  }

  async function currentGeneration(workspaceId) {
    return (await readMeta(workspaceId))?.generation ?? (await readGeneration(workspaceId))
  }

  async function release(workspaceId, ownerToken) {
    const meta = await readMeta(workspaceId)
    if (!meta) {
      // Идемпотентно: lease уже снят.
      await rm(leaseDir(workspaceId), { recursive: true, force: true }).catch(() => {})
      return { released: true }
    }
    if (!tokensEqual(meta.ownerToken, ownerToken)) {
      throw new RuntimeError('FOREIGN_OWNER', 'Чужой lease нельзя снять.', { workspaceId, holder: { sessionId: meta.sessionId, userId: meta.userId } })
    }
    await rm(leaseDir(workspaceId), { recursive: true, force: true })
    await appendAudit(roots.stateRoot, 'lease.released', { workspaceId, sessionId: meta.sessionId })
    return { released: true }
  }

  async function releaseIfOwner(workspaceId, ownerToken) {
    try {
      await release(workspaceId, ownerToken)
      return true
    } catch (error) {
      if (error?.code === 'FOREIGN_OWNER') return false
      throw error
    }
  }

  // Только для внутренних lifecycle-операций (cleanup workspace после всех
  // guard'ов): снимает lease без токена и фиксирует причину в audit.
  async function forceRelease(workspaceId, { reason }) {
    const meta = await readMeta(workspaceId)
    await rm(leaseDir(workspaceId), { recursive: true, force: true }).catch(() => {})
    if (meta) await appendAudit(roots.stateRoot, 'lease.force-released', { workspaceId, sessionId: meta.sessionId, reason })
  }

  return {
    acquire,
    release,
    releaseIfOwner,
    forceRelease,
    heartbeat,
    stateOf,
    assertFence,
    currentGeneration,
    timings: { staleMs, orphanMs },
  }
}
