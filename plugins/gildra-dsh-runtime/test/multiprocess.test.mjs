// Межпроцессная конкуренция Gildra Runtime (§50).
//
// Все примитивы взаимного исключения Runtime — mkdir-локи в общем каталоге
// state и классификация владельца по PID. Ни то, ни другое невозможно
// проверить Promise.all внутри одного Node-процесса: конкуренты делили бы
// event loop и один process.pid, а перехват мёртвого владельца вообще не
// исполнялся бы. Поэтому здесь настоящие ОС-процессы (child_process.spawn),
// работающие с ОДНИМ GILDRA_DSH_STATE_DIR.
//
// Проверяемые инварианты:
//   1. store.withLock — взаимное исключение между процессами: ни один
//      инкремент неатомарного read-modify-write не теряется, критические
//      секции не пересекаются;
//   2. leases.acquire — ровно один победитель на workspace, остальные
//      получают WORKSPACE_LOCKED, generation растёт ровно на 1;
//   3. аллокация портов — выданные разным процессам порты уникальны;
//   4. лок процесса, убитого SIGKILL, перехватывается живым процессом.
//
// Синхронизация — только барьер-рандеву на файлах и ожидание условия с
// дедлайном; фиксированных sleep для синхронизации здесь нет.
// Запуск: node plugins/gildra-dsh-runtime/test/multiprocess.test.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLeaseManager } from '../lib/leases.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'

const startedAt = Date.now()
const WORKER = fileURLToPath(new URL('./helpers/child-worker.mjs', import.meta.url))

// Каталог-стенд с пробелом в имени — тот же инвариант путей, что и в
// остальных тестах Runtime (пробел ломает всё, что собирает команду строкой).
const base = await mkdtemp(join(tmpdir(), 'gildra multiproc '))
const stateDir = join(base, 'state')
const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: stateDir })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()

const delay = ms => new Promise(resolveTimer => setTimeout(resolveTimer, ms))

// Ожидание условия с дедлайном. Никаких «поспать и надеяться»: любой сценарий
// ниже либо доказуемо сходится, либо падает с внятным сообщением.
async function waitUntil(predicate, message, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error(`таймаут ожидания: ${message}`)
    await delay(10)
  }
}

// Дочерние процессы запускаются с зачищенным GILDRA_DSH_*-окружением: любая
// унаследованная переменная (таймауты lease, диапазон портов) молча изменила
// бы поведение проверяемых инвариантов.
function childEnv(extra = {}) {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith('GILDRA_DSH_')) delete env[name]
  }
  return { ...env, GILDRA_DSH_STATE_DIR: stateDir, ...extra }
}

const describeWorker = worker => [
  `режим=${worker.mode}`,
  `pid=${String(worker.pid)}`,
  `exit=${JSON.stringify(worker.exit ?? null)}`,
  `stdout=${worker.stdout.trim() || '<пусто>'}`,
  `stderr=${worker.stderr.trim() || '<пусто>'}`,
].join(' ')

function startWorker(mode, payload, extraEnv = {}) {
  const child = spawn(process.execPath, [WORKER, mode, JSON.stringify(payload)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(extraEnv),
  })
  const worker = { mode, pid: child.pid, child, stdout: '', stderr: '', result: undefined, exit: undefined }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    worker.stdout += chunk
    const end = worker.stdout.indexOf('\n')
    if (worker.result === undefined && end !== -1) {
      try {
        worker.result = JSON.parse(worker.stdout.slice(0, end))
      } catch {
        // Строка не разобралась — оставляем result пустым; ассерт ниже
        // покажет и stdout, и stderr целиком.
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { worker.stderr += chunk })
  worker.exited = new Promise(resolveExit => child.on('exit', (code, signal) => {
    worker.exit = { code, signal }
    resolveExit()
  }))
  return worker
}

// Открытие барьера: ждём, пока ВСЕ процессы доложат о готовности, и только
// потом даём общий старт. Иначе первый запущенный успел бы отработать раньше,
// чем последний закончит загружать Node, и конкуренции бы не было вовсе.
async function openBarrier(barrierDir, workers) {
  await waitUntil(async () => {
    for (const worker of workers) {
      assert.equal(worker.exit, undefined, `дочерний процесс умер, не дойдя до барьера: ${describeWorker(worker)}`)
    }
    const names = await readdir(barrierDir).catch(() => [])
    return names.filter(name => name.startsWith('ready-')).length === workers.length
  }, `все ${String(workers.length)} процессов дошли до барьера`)
  await writeFile(join(barrierDir, 'go'), '')
}

// Результат читаем из stdout, НЕ дожидаясь выхода процесса: в сценариях с
// lease и портами победитель обязан оставаться живым, пока родитель снимает
// показания (см. комментарии в helpers/child-worker.mjs).
async function collectResults(workers) {
  await waitUntil(
    () => workers.every(worker => worker.result !== undefined || worker.exit !== undefined),
    'все дочерние процессы напечатали результат',
  )
  for (const worker of workers) {
    assert.notEqual(worker.result, undefined, `дочерний процесс не напечатал результат: ${describeWorker(worker)}`)
  }
  return workers.map(worker => worker.result)
}

async function awaitExit(workers) {
  await Promise.all(workers.map(worker => worker.exited))
  for (const worker of workers) {
    assert.equal(worker.exit.code, 0, `дочерний процесс завершился с ошибкой: ${describeWorker(worker)}`)
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

// --- 1. store.withLock: ни одного потерянного инкремента ------------------
// Шесть процессов делают заведомо НЕатомарный read-modify-write одного файла
// под одним локом. Если бы лок не работал между процессами, часть процессов
// прочитала бы одно и то же значение и итог оказался бы меньше шести.
{
  const barrierDir = join(base, 'barrier counter')
  const counterPath = join(base, 'counter.json')
  const witnessPath = join(base, 'witness.log')
  const CHILDREN = 6
  await mkdir(barrierDir, { recursive: true })
  await writeFile(counterPath, `${JSON.stringify({ value: 0 })}\n`)
  await writeFile(witnessPath, '')

  const workers = Array.from({ length: CHILDREN }, (_, index) => startWorker('store-counter', {
    barrierDir, index, lockName: 'counter', counterPath, witnessPath,
  }))
  await openBarrier(barrierDir, workers)
  await awaitExit(workers)
  await collectResults(workers)

  const counter = JSON.parse(await readFile(counterPath, 'utf8'))
  assert.equal(counter.value, CHILDREN,
    `под общим локом потерян инкремент: ожидалось ${String(CHILDREN)}, на диске ${String(counter.value)}`)

  // Прямое доказательство взаимного исключения: журнал входов/выходов обязан
  // строго чередоваться enter/exit одного и того же pid. Пересечение секций
  // двух процессов видно здесь даже тогда, когда счётчик случайно сошёлся.
  const witness = (await readFile(witnessPath, 'utf8')).split('\n').filter(Boolean)
  assert.equal(witness.length, CHILDREN * 2, `в журнале критических секций ${String(witness.length)} записей вместо ${String(CHILDREN * 2)}`)
  const owners = new Set()
  for (let index = 0; index < witness.length; index += 2) {
    const [enterTag, enterPid] = witness[index].split(' ')
    const [exitTag, exitPid] = witness[index + 1].split(' ')
    assert.equal(enterTag, 'enter', `нарушен порядок журнала на строке ${String(index)}: ${witness[index]}`)
    assert.equal(exitTag, 'exit', `нарушен порядок журнала на строке ${String(index + 1)}: ${witness[index + 1]}`)
    assert.equal(enterPid, exitPid,
      `критические секции пересеклись: процесс ${enterPid} вошёл, а вышел ${exitPid} — лок не исключает процессы`)
    owners.add(enterPid)
  }
  assert.equal(owners.size, CHILDREN, 'критическую секцию прошли не все процессы')
}

// --- 2. leases.acquire: ровно один победитель между процессами ------------
{
  const barrierDir = join(base, 'barrier lease')
  const finishPath = join(base, 'lease finish')
  const WORKSPACE = 'demo--alex--sess-mp'
  const CHILDREN = 8
  await mkdir(barrierDir, { recursive: true })
  const leases = createLeaseManager({ roots, env: {} })
  const generationBefore = await leases.currentGeneration(WORKSPACE)
  assert.equal(generationBefore, 0, 'стенд стартует с нулевым поколением lease')

  const workers = Array.from({ length: CHILDREN }, (_, index) => startWorker('lease-acquire', {
    barrierDir, index, finishPath, workspaceId: WORKSPACE, userId: 'alex', sessionId: `sess-mp${String(index)}`,
  }))
  await openBarrier(barrierDir, workers)
  const results = await collectResults(workers)

  const winners = results.filter(result => result.ok)
  const losers = results.filter(result => !result.ok)
  assert.equal(winners.length, 1,
    `write-lease одного workspace получили ${String(winners.length)} процессов вместо одного: ${JSON.stringify(results)}`)
  assert.equal(losers.length, CHILDREN - 1)
  for (const loser of losers) {
    assert.equal(loser.code, 'WORKSPACE_LOCKED',
      `проигравший процесс получил код «${String(loser.code)}» вместо WORKSPACE_LOCKED`)
  }

  // Поколение — fencing-счётчик: его двигает только победитель mkdir-гонки.
  // Рост больше чем на 1 означал бы, что кто-то перехватил живой lease.
  const generationAfter = await leases.currentGeneration(WORKSPACE)
  assert.equal(generationAfter, generationBefore + 1,
    `generation вырос с ${String(generationBefore)} до ${String(generationAfter)}: захват выполнил не один процесс`)
  assert.equal(winners[0].generation, generationAfter, 'победитель предъявляет актуальное поколение')

  const state = await leases.stateOf(WORKSPACE)
  assert.equal(state.state, 'ACTIVE', 'после захвата lease обязан быть активным')
  assert.equal(state.pid, winners[0].pid, 'владельцем на диске записан именно процесс-победитель')

  await writeFile(finishPath, '')
  await awaitExit(workers)
}

// --- 3. Аллокация портов между процессами: все порты уникальны ------------
// Диапазон намеренно узкий: все процессы начинают перебор с одного и того же
// порта, поэтому без сериализации в store.withLock двое получили бы один порт.
{
  const barrierDir = join(base, 'barrier ports')
  const finishPath = join(base, 'ports finish')
  const CHILDREN = 6
  await mkdir(barrierDir, { recursive: true })

  const workers = Array.from({ length: CHILDREN }, (_, index) => startWorker(
    'port-allocate',
    { barrierDir, index, finishPath, sessionId: `sess-port${String(index)}` },
    { GILDRA_DSH_PORT_RANGE: '31700-31719' },
  ))
  await openBarrier(barrierDir, workers)
  const results = await collectResults(workers)

  const ports = results.map(result => result.port)
  for (const port of ports) {
    assert.equal(Number.isInteger(port), true, `процесс не получил порт: ${JSON.stringify(results)}`)
    assert.equal(port >= 31700 && port <= 31719, true, `порт ${String(port)} вне выделенного диапазона 31700–31719`)
  }
  assert.equal(new Set(ports).size, CHILDREN,
    `один порт выдан нескольким процессам: ${JSON.stringify(ports.slice().sort())}`)

  // Бухгалтерия в state обязана совпадать с тем, что процессы получили на руки.
  const leased = []
  for (const id of await store.list('ports')) leased.push((await store.read('ports', id)).port)
  assert.deepEqual(leased.slice().sort(), ports.slice().sort(),
    'в store записан не тот набор портов, который выдан процессам')

  await writeFile(finishPath, '')
  await awaitExit(workers)
}

// --- 4. Stale-лок мёртвого процесса перехватывается живым -----------------
{
  const LOCK = 'stale-demo'
  const lockDir = join(roots.stateRoot, 'locks', `${LOCK}.lock`)
  const holder = startWorker('hold-store-lock', { lockName: LOCK })
  const [held] = await collectResults([holder])
  assert.equal(held.ok, true, `дочерний процесс не смог взять лок: ${describeWorker(holder)}`)

  const meta = JSON.parse(await readFile(join(lockDir, 'meta.json'), 'utf8'))
  assert.equal(meta.pid, holder.pid, 'лок на диске принадлежит дочернему процессу')

  // SIGKILL не даёт отработать finally: лок гарантированно останется на диске.
  holder.child.kill('SIGKILL')
  await holder.exited
  assert.equal(existsSync(lockDir), true, 'убитый владелец не мог отпустить лок — каталог обязан остаться')

  // Ждём условие, а не «немножко»: PID перестал быть живым (Node снимает
  // зомби к моменту события exit, но проверяем это явно — от этого зависит
  // весь механизм перехвата).
  await waitUntil(() => !alive(holder.pid), 'PID убитого владельца перестал определяться как живой')

  let entered = false
  const takenAt = Date.now()
  const outcome = await store.withLock(LOCK, async () => {
    entered = true
    // Внутри секции лок обязан принадлежать уже нам.
    const current = JSON.parse(await readFile(join(lockDir, 'meta.json'), 'utf8'))
    assert.equal(current.pid, process.pid, 'после перехвата владельцем лока записан текущий процесс')
    return 'перехвачен'
  }, { timeoutMs: 20_000 })
  assert.equal(entered, true, 'критическая секция после перехвата не выполнилась')
  assert.equal(outcome, 'перехвачен')
  assert.equal(existsSync(lockDir), false, 'после выхода из секции лок обязан быть снят')
  assert.equal(Date.now() - takenAt < 20_000, true, 'перехват stale-лока уложился в дедлайн')
}

await rm(base, { recursive: true, force: true })
console.log(`Gildra Runtime multiprocess tests passed (${String(Date.now() - startedAt)} ms).`)
