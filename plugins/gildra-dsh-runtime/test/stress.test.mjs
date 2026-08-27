// Нагрузочные сценарии конкуренции Gildra Runtime (§47).
//
// Тест тяжелее обычных, но детерминирован по ИНВАРИАНТАМ, а не по таймингам:
// ни один ассерт не измеряет скорость, нигде нет фиксированного sleep как
// средства синхронизации — только Promise.allSettled и ожидание условия с
// дедлайном. Сеть не нужна: git-фикстуры целиком локальные.
//
// Проверяемые инварианты:
//   1. 50 одновременных acquire одного lease → ровно 1 победитель,
//      49 отказов WORKSPACE_LOCKED, generation вырос ровно на 1;
//   2. 20 параллельных createWorkspace в одном проекте → 20 разных worktree
//      и веток без коллизий, canonical main не сдвинулся;
//   3. гонка create↔cleanup не оставляет полуудалённого состояния: запись в
//      store и каталог на диске согласованы в обе стороны;
//   4. повторный перехват осиротевшего lease (10 раз) двигает generation
//      монотонно и ровно на 1 за перехват;
//   5. 20 конкурентных аллокаций портов дают 20 разных портов.
//
// Запуск: node plugins/gildra-dsh-runtime/test/stress.test.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, currentBranch, git, listWorktrees, revParse } from '../lib/gitx.js'
import { createLeaseManager } from '../lib/leases.js'
import { runtimeRoots } from '../lib/paths.js'
import { createPortAllocator } from '../lib/ports.js'
import { createProjectRegistry } from '../lib/projects.js'
import { JsonStore } from '../lib/store.js'
import { createWorkspaceManager } from '../lib/workspaces.js'

const startedAt = Date.now()

// Каталог-стенд с пробелом в имени — инвариант путей с пробелами (§39).
const base = await mkdtemp(join(tmpdir(), 'gildra stress '))
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
const leases = createLeaseManager({ roots, env: {} })
const workspaces = createWorkspaceManager({ store, roots, projects, leases, env: {} })

const delay = ms => new Promise(resolveTimer => setTimeout(resolveTimer, ms))

// Ожидание условия с дедлайном — единственная форма ожидания в этом файле.
async function waitUntil(predicate, message, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error(`таймаут ожидания: ${message}`)
    await delay(10)
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// PID заведомо мёртвого процесса: событие exit приходит после того, как Node
// снял зомби, поэтому такой pid действительно перестаёт быть живым.
async function spawnDeadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const pid = child.pid
  await new Promise(resolveExit => child.on('exit', resolveExit))
  await waitUntil(() => !alive(pid), `PID ${String(pid)} перестал определяться как живой`)
  return pid
}

const reasons = settled => settled
  .filter(entry => entry.status === 'rejected')
  .map(entry => `${String(entry.reason?.code ?? 'INTERNAL')}: ${String(entry.reason?.message ?? entry.reason)}`)

// --- Канонический bare-репозиторий ----------------------------------------
// core.autocrlf=false и у seed, и у bare: иначе Windows подставил бы CRLF и
// сравнение содержимого разъехалось бы между платформами.
const seed = join(base, 'seed repo')
await git(['init', '-b', 'main', seed])
await git(['-C', seed, 'config', 'core.autocrlf', 'false'])
await writeFile(join(seed, 'README.md'), '# stress\n')
await writeFile(join(seed, 'shared.txt'), 'line-1\nline-2\n')
await commitAll(seed, 'initial', { name: 'Seed', email: 'seed@test' })
const canonical = join(base, 'repos', 'demo.git')
await git(['clone', '--bare', seed, canonical])
await git(['-C', canonical, 'config', 'core.autocrlf', 'false'])
await projects.register({ projectId: 'demo', path: canonical })
const mainShaBefore = await revParse(canonical, 'main')

// --- 1. 50 конкурентных acquire одного lease ------------------------------
// Все претенденты живут в одном процессе, то есть их pid жив: проигравшие
// обязаны увидеть ACTIVE-владельца и получить WORKSPACE_LOCKED, а не
// «перехватить» его.
{
  const WORKSPACE = 'demo--alex--sess-hot'
  const ATTEMPTS = 50
  const generationBefore = await leases.currentGeneration(WORKSPACE)
  const settled = await Promise.allSettled(Array.from({ length: ATTEMPTS }, (_, index) =>
    leases.acquire({ workspaceId: WORKSPACE, sessionId: `sess-h${String(index)}`, userId: 'alex' })))

  const winners = settled.filter(entry => entry.status === 'fulfilled')
  const losers = settled.filter(entry => entry.status === 'rejected')
  assert.equal(winners.length, 1,
    `write-lease получили ${String(winners.length)} претендентов вместо одного`)
  assert.equal(losers.length, ATTEMPTS - 1)
  for (const loser of losers) {
    assert.equal(loser.reason.code, 'WORKSPACE_LOCKED',
      `проигравший получил «${String(loser.reason.code)}» вместо WORKSPACE_LOCKED: ${String(loser.reason.message)}`)
  }

  const generationAfter = await leases.currentGeneration(WORKSPACE)
  assert.equal(generationAfter, generationBefore + 1,
    `generation сдвинулся с ${String(generationBefore)} на ${String(generationAfter)}: захват выполнил не один претендент`)
  assert.equal(winners[0].value.generation, generationAfter)
  assert.equal((await leases.stateOf(WORKSPACE)).state, 'ACTIVE')
  await leases.release(WORKSPACE, winners[0].value.ownerToken)
  assert.equal((await leases.stateOf(WORKSPACE)).state, 'FREE')
}

// --- 2. 20 параллельных createWorkspace в одном проекте -------------------
// Создание ветки и worktree сериализовано локом repo-<projectId>; проверяем,
// что сериализация действительно даёт 20 независимых воркспейсов, а не
// частично перезаписанные друг другом каталоги.
const PARALLEL_CREATES = 20
{
  const settled = await Promise.allSettled(Array.from({ length: PARALLEL_CREATES }, (_, index) =>
    workspaces.createWorkspace({
      projectId: 'demo',
      userId: 'many',
      sessionId: `s${String(index).padStart(2, '0')}`,
    })))
  const created = settled.filter(entry => entry.status === 'fulfilled').map(entry => entry.value)
  assert.equal(created.length, PARALLEL_CREATES,
    `часть параллельных созданий провалилась: ${reasons(settled).join(' | ')}`)

  assert.equal(new Set(created.map(record => record.workspaceId)).size, PARALLEL_CREATES, 'workspaceId столкнулись')
  assert.equal(new Set(created.map(record => record.path)).size, PARALLEL_CREATES, 'два воркспейса получили один каталог')
  assert.equal(new Set(created.map(record => record.branch)).size, PARALLEL_CREATES, 'два воркспейса получили одну ветку')

  for (const record of created) {
    assert.equal(existsSync(record.path), true, `worktree ${record.workspaceId} не создан на диске`)
    assert.equal(await currentBranch(record.path), record.branch,
      `worktree ${record.workspaceId} стоит не на своей ветке`)
    assert.notEqual(await revParse(canonical, record.branch), undefined,
      `ветка «${record.branch}» не появилась в каноническом репозитории`)
    // Изоляция: свежий worktree видит содержимое базы, а не чужие правки.
    assert.equal(await readFile(join(record.path, 'shared.txt'), 'utf8'), 'line-1\nline-2\n',
      `worktree ${record.workspaceId} стартовал не с содержимого базовой ветки`)
  }

  // Git обязан знать ровно те worktree, что создал Runtime (+ сам bare-репо).
  const tracked = (await listWorktrees(canonical)).filter(entry => !entry.bare)
  assert.equal(tracked.length, PARALLEL_CREATES,
    `git видит ${String(tracked.length)} worktree вместо ${String(PARALLEL_CREATES)}`)

  assert.equal(await revParse(canonical, 'main'), mainShaBefore,
    'параллельное создание воркспейсов сдвинуло защищённую ветку main')
}

// --- 3. Гонка create↔cleanup: никакого полуудалённого состояния -----------
// cleanup работает под локом workspace-<id>, create — под локом repo-<id>:
// это РАЗНЫЕ локи, поэтому git-операции двух этих путей реально пересекаются.
// Инвариант формулируем в обе стороны: есть запись → есть каталог; нет
// записи → нет каталога.
const RACE_PAIRS = 8
{
  const doomed = []
  for (let index = 0; index < RACE_PAIRS; index += 1) {
    doomed.push(await workspaces.createWorkspace({ projectId: 'demo', userId: 'race', sessionId: `r${String(index)}` }))
  }

  // Перемежаем удаление и создание, чтобы операции стартовали вперемешку.
  const operations = []
  for (let index = 0; index < RACE_PAIRS; index += 1) {
    operations.push(workspaces.cleanupWorkspace(doomed[index].workspaceId))
    operations.push(workspaces.createWorkspace({ projectId: 'demo', userId: 'race', sessionId: `n${String(index)}` }))
  }
  const settled = await Promise.allSettled(operations)
  assert.equal(settled.filter(entry => entry.status === 'rejected').length, 0,
    `операции в гонке create↔cleanup завершились ошибкой: ${reasons(settled).join(' | ')}`)

  // Мутации канонического репозитория обязаны быть взаимно исключающими.
  // Проверяем это наблюдаемо: держим лок репозитория снаружи и убеждаемся,
  // что cleanup не проходит, пока лок занят, и проходит сразу после его
  // освобождения. Без этого create и cleanup правили бы метаданные одного
  // репозитория параллельно (на Windows это убивало соседний git-процесс).
  {
    const victim = await workspaces.createWorkspace({ projectId: 'demo', userId: 'race', sessionId: 'lockcheck' })
    let settled = false
    let holding = true
    // Лок держим до тех пор, пока внешний флаг не снят: сам cleanup стартует
    // снаружи withLock, иначе он ждал бы лок, который держит его же вызов.
    const held = store.withLock('repo-demo', () => waitUntil(() => !holding, 'освобождение repo-demo'))
    const pending = workspaces.cleanupWorkspace(victim.workspaceId).then(() => { settled = true })

    await delay(400)
    assert.equal(settled, false,
      'cleanup изменил репозиторий, пока лок repo-demo держал кто-то другой')
    assert.equal(existsSync(victim.path), true,
      'worktree удалён в обход лока репозитория')

    holding = false
    await held
    await pending
    assert.equal(existsSync(victim.path), false, 'cleanup не отработал после освобождения лока')
  }

  // Сторона «есть запись → есть каталог»: проверяем ВСЕ записи проекта,
  // включая созданные предыдущим сценарием.
  const records = await workspaces.listRecords({ projectId: 'demo' })
  assert.equal(records.length, PARALLEL_CREATES + RACE_PAIRS,
    `в store ${String(records.length)} записей вместо ${String(PARALLEL_CREATES + RACE_PAIRS)}`)
  for (const record of records) {
    assert.equal(existsSync(record.path), true,
      `запись ${record.workspaceId} есть в store, а каталога на диске нет — полуудалённое состояние`)
    assert.equal(await currentBranch(record.path), record.branch,
      `worktree ${record.workspaceId} не работает как git-дерево — полусозданное состояние`)
  }

  // Сторона «нет записи → нет каталога»: сканируем диск, а не список
  // ожидаемых путей, — так видно и каталоги, оставленные любым третьим путём.
  const known = new Set(records.map(record => record.path))
  const raceRoot = join(roots.workspacesRoot, 'demo', 'race')
  const onDisk = await readdir(raceRoot)
  assert.equal(onDisk.length, records.filter(record => record.userId === 'race').length,
    `на диске ${String(onDisk.length)} каталогов участников гонки при другом числе записей в store`)
  for (const name of onDisk) {
    assert.equal(known.has(join(raceRoot, name)), true,
      `каталог «${name}» остался на диске без записи в store — полуудалённое состояние`)
  }
  for (const record of doomed) {
    assert.equal(existsSync(record.path), false, `удалённый ${record.workspaceId} остался на диске`)
    assert.equal(await store.read('workspaces', record.workspaceId), undefined,
      `запись удалённого ${record.workspaceId} осталась в store`)
    assert.equal(await revParse(canonical, `refs/heads/${record.branch}`), undefined,
      `ветка удалённого ${record.workspaceId} осталась в каноническом репозитории`)
  }
  assert.equal(await revParse(canonical, 'main'), mainShaBefore, 'гонка create↔cleanup сдвинула main')
}

// --- 4. Повторный перехват осиротевшего lease -----------------------------
// Каждый цикл: владелец «умер» → lease ORPHANED → перехват. Поколение живёт
// в отдельном файле и обязано пережить удаление самого lease, поэтому расти
// оно может только монотонно и ровно на 1 за перехват.
{
  const WORKSPACE = 'demo--alex--sess-orphan'
  const leaseDir = join(roots.stateRoot, 'leases', `${WORKSPACE}.lease`)
  const TAKEOVERS = 10
  let previous = await leases.currentGeneration(WORKSPACE)
  assert.equal(previous, 0, 'стенд стартует с нулевым поколением lease')

  for (let round = 1; round <= TAKEOVERS; round += 1) {
    const deadPid = await spawnDeadPid()
    await mkdir(leaseDir, { recursive: true })
    await writeFile(join(leaseDir, 'meta.json'), JSON.stringify({
      schemaVersion: 1,
      workspaceId: WORKSPACE,
      sessionId: `sess-dead-${String(round)}`,
      userId: 'peter',
      pid: deadPid,
      generation: previous,
      ownerToken: `lost-${String(round)}`,
      acquiredAt: new Date().toISOString(),
      // Heartbeat свежий: единственная причина ORPHANED — мёртвый владелец.
      heartbeatAt: new Date().toISOString(),
    }))
    assert.equal((await leases.stateOf(WORKSPACE)).state, 'ORPHANED',
      `круг ${String(round)}: lease мёртвого владельца не признан осиротевшим`)

    const taken = await leases.acquire({ workspaceId: WORKSPACE, sessionId: `sess-live-${String(round)}`, userId: 'alex' })
    assert.equal(taken.generation, previous + 1,
      `круг ${String(round)}: generation ${String(taken.generation)} вместо ${String(previous + 1)} — fencing-счётчик не монотонен`)
    assert.equal((await leases.stateOf(WORKSPACE)).generation, taken.generation,
      `круг ${String(round)}: поколение на диске разошлось с выданным победителю`)

    // Устаревший токен предыдущего владельца не должен проходить fencing.
    await assert.rejects(
      leases.assertFence(WORKSPACE, { ownerToken: `lost-${String(round)}` }),
      (error) => error.code === 'FOREIGN_OWNER',
      `круг ${String(round)}: «воскресший» владелец прошёл fencing`,
    )

    previous = taken.generation
    await leases.release(WORKSPACE, taken.ownerToken)
  }
  assert.equal(previous, TAKEOVERS, `после ${String(TAKEOVERS)} перехватов поколение равно ${String(previous)}`)
  // Поколение переживает снятие lease — иначе номера переиспользовались бы.
  assert.equal(await leases.currentGeneration(WORKSPACE), TAKEOVERS,
    'счётчик поколений не пережил снятие lease')
}

// --- 5. 20 конкурентных аллокаций портов ----------------------------------
// Диапазон узкий, и все аллокации начинают перебор с одного порта: без
// сериализации в store.withLock проба bind у двух сессий прошла бы
// одновременно и один порт был бы выдан дважды.
{
  const ALLOCATIONS = 20
  const ports = createPortAllocator({ store, env: { GILDRA_DSH_PORT_RANGE: '31800-31839' } })
  const settled = await Promise.allSettled(Array.from({ length: ALLOCATIONS }, (_, index) =>
    ports.allocate({ sessionId: `sess-p${String(index)}`, name: 'app' })))
  assert.equal(settled.filter(entry => entry.status === 'rejected').length, 0,
    `часть аллокаций провалилась: ${reasons(settled).join(' | ')}`)

  const allocated = settled.map(entry => entry.value.port)
  assert.equal(new Set(allocated).size, ALLOCATIONS,
    `один порт выдан нескольким сессиям: ${JSON.stringify(allocated.slice().sort())}`)
  for (const port of allocated) {
    assert.equal(port >= 31800 && port <= 31839, true, `порт ${String(port)} вне выделенного диапазона`)
  }

  // Бухгалтерия в store обязана совпадать с выданным набором.
  const leased = []
  for (const id of await store.list('ports')) leased.push((await store.read('ports', id)).port)
  assert.deepEqual(leased.slice().sort(), allocated.slice().sort(),
    'набор портов в store разошёлся с выданным сессиям')
}

await rm(base, { recursive: true, force: true })
console.log(`Gildra Runtime stress tests passed (${String(Date.now() - startedAt)} ms).`)
