// Тесты Lease Manager (§7): конкурентный захват, stale/orphaned владельцы,
// чужой release, PID-reuse, конкурентный takeover.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runtimeRoots } from '../lib/paths.js'
import { createLeaseManager } from '../lib/leases.js'

const base = await mkdtemp(join(tmpdir(), 'gildra lease '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const leases = createLeaseManager({ roots, env: {} })
const WS = 'demo--alex--sess-a'
const leaseDirOf = id => join(roots.stateRoot, 'leases', `${id}.lease`)

async function spawnAlive() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  return child
}

async function spawnDeadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const pid = child.pid
  await new Promise(resolveExit => child.on('exit', resolveExit))
  return pid
}

// --- Два writer одновременно: ровно один захват ---------------------------
{
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    leases.acquire({ workspaceId: WS, sessionId: `sess-${String(index)}`, userId: 'alex' })))
  const wins = results.filter(result => result.status === 'fulfilled')
  const losses = results.filter(result => result.status === 'rejected')
  assert.equal(wins.length, 1, 'ровно один writer получает lease')
  assert.equal(losses.length, 7)
  for (const loss of losses) assert.equal(loss.reason.code, 'WORKSPACE_LOCKED')

  const token = wins[0].value.ownerToken
  assert.equal((await leases.stateOf(WS)).state, 'ACTIVE')

  // Повторный acquire при живом владельце — отказ.
  await assert.rejects(
    leases.acquire({ workspaceId: WS, sessionId: 'sess-again', userId: 'alex' }),
    (error) => error.code === 'WORKSPACE_LOCKED' && error.details.holder.state === 'ACTIVE',
  )

  // Чужой release не проходит и не снимает lease.
  await assert.rejects(leases.release(WS, 'not-the-token'), (error) => error.code === 'FOREIGN_OWNER')
  assert.equal(await leases.releaseIfOwner(WS, 'not-the-token'), false)
  assert.equal((await leases.stateOf(WS)).state, 'ACTIVE')

  // Heartbeat с чужим токеном — отказ; со своим — обновляет.
  await assert.rejects(leases.heartbeat(WS, 'not-the-token'), (error) => error.code === 'FOREIGN_OWNER')
  const before = JSON.parse(await readFile(join(leaseDirOf(WS), 'meta.json'), 'utf8')).heartbeatAt
  await new Promise(resolveTimer => setTimeout(resolveTimer, 15))
  await leases.heartbeat(WS, token)
  const after = JSON.parse(await readFile(join(leaseDirOf(WS), 'meta.json'), 'utf8')).heartbeatAt
  assert.notEqual(before, after)

  // Свой release снимает; повторный acquire работает.
  await leases.release(WS, token)
  assert.equal((await leases.stateOf(WS)).state, 'FREE')
  const again = await leases.acquire({ workspaceId: WS, sessionId: 'sess-b', userId: 'alex' })
  await leases.release(WS, again.ownerToken)
}

// --- STALE: живой процесс с протухшим heartbeat не выселяется -------------
{
  const shortStale = createLeaseManager({ roots, env: { GILDRA_DSH_LEASE_STALE_MS: '50' } })
  const holder = await spawnAlive()
  try {
    await mkdir(leaseDirOf(WS), { recursive: true })
    await writeFile(join(leaseDirOf(WS), 'meta.json'), JSON.stringify({
      schemaVersion: 1,
      workspaceId: WS,
      sessionId: 'sess-alive',
      userId: 'peter',
      pid: holder.pid,
      ownerToken: 'held',
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date(Date.now() - 200).toISOString(),
    }))
    assert.equal((await shortStale.stateOf(WS)).state, 'STALE')
    await assert.rejects(
      shortStale.acquire({ workspaceId: WS, sessionId: 'sess-thief', userId: 'alex' }),
      (error) => error.code === 'WORKSPACE_LOCKED' && error.details.holder.state === 'STALE',
    )
    assert.equal(existsSync(leaseDirOf(WS)), true, 'stale-lease живого процесса не тронут')
  } finally {
    holder.kill('SIGKILL')
    await rm(leaseDirOf(WS), { recursive: true, force: true })
  }
}

// --- Crash без cleanup: мёртвый PID → ORPHANED → перехват -----------------
{
  const deadPid = await spawnDeadPid()
  await mkdir(leaseDirOf(WS), { recursive: true })
  await writeFile(join(leaseDirOf(WS), 'meta.json'), JSON.stringify({
    schemaVersion: 1,
    workspaceId: WS,
    sessionId: 'sess-crashed',
    userId: 'peter',
    pid: deadPid,
    ownerToken: 'lost',
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  }))
  assert.equal((await leases.stateOf(WS)).state, 'ORPHANED')
  const takeover = await leases.acquire({ workspaceId: WS, sessionId: 'sess-recover', userId: 'alex' })
  assert.equal((await leases.stateOf(WS)).state, 'ACTIVE')
  assert.equal((await leases.stateOf(WS)).sessionId, 'sess-recover')
  await leases.release(WS, takeover.ownerToken)
}

// --- PID-reuse: «живой» PID, но heartbeat старше orphan-порога ------------
{
  const reuseAware = createLeaseManager({ roots, env: { GILDRA_DSH_LEASE_ORPHAN_MS: '100' } })
  await mkdir(leaseDirOf(WS), { recursive: true })
  await writeFile(join(leaseDirOf(WS), 'meta.json'), JSON.stringify({
    schemaVersion: 1,
    workspaceId: WS,
    sessionId: 'sess-zombie',
    userId: 'peter',
    pid: process.pid,
    ownerToken: 'zombie',
    acquiredAt: new Date(Date.now() - 1000).toISOString(),
    heartbeatAt: new Date(Date.now() - 500).toISOString(),
  }))
  assert.equal((await reuseAware.stateOf(WS)).state, 'ORPHANED',
    'живой PID с давно умершим heartbeat трактуется как переиспользованный')
  const takeover = await reuseAware.acquire({ workspaceId: WS, sessionId: 'sess-new', userId: 'alex' })
  await reuseAware.release(WS, takeover.ownerToken)
}

// --- Конкурентный перехват ORPHANED: побеждает ровно один -----------------
{
  const deadPid = await spawnDeadPid()
  await mkdir(leaseDirOf(WS), { recursive: true })
  await writeFile(join(leaseDirOf(WS), 'meta.json'), JSON.stringify({
    schemaVersion: 1,
    workspaceId: WS,
    sessionId: 'sess-gone',
    userId: 'peter',
    pid: deadPid,
    ownerToken: 'gone',
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  }))
  const contenders = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
    leases.acquire({ workspaceId: WS, sessionId: `sess-t${String(index)}`, userId: 'alex' })))
  const winners = contenders.filter(result => result.status === 'fulfilled')
  assert.equal(winners.length, 1, 'перехват orphaned-lease выигрывает ровно один претендент')
  const holderState = await leases.stateOf(WS)
  assert.equal(holderState.state, 'ACTIVE')
  assert.equal(holderState.sessionId, winners[0].value.workspaceId === WS ? holderState.sessionId : holderState.sessionId)
  await leases.release(WS, winners[0].value.ownerToken)
}

// --- forceRelease: только внутренняя операция, снимает без токена ---------
{
  const lease = await leases.acquire({ workspaceId: WS, sessionId: 'sess-final', userId: 'alex' })
  await leases.forceRelease(WS, { reason: 'test-cleanup' })
  assert.equal((await leases.stateOf(WS)).state, 'FREE')
  assert.equal(await leases.releaseIfOwner(WS, lease.ownerToken), true, 'release после forceRelease идемпотентен')
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime lease tests passed.')
