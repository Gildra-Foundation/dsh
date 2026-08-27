// Дочерний процесс для межпроцессных тестов Gildra Runtime
// (см. test/multiprocess.test.mjs).
//
// Почему отдельный ОС-процесс, а не Promise.all в одном Node: mkdir-локи
// store.js и leases.js координируют РАЗНЫЕ процессы. Внутри одного процесса
// конкуренты делят event loop, таблицу открытых файлов и, главное, один
// process.pid — а именно на pid построены и перехват мёртвого владельца, и
// классификация lease. Тест «в одном процессе» такие пути просто не трогает.
//
// Контракт с родителем:
//   argv[2] — режим, argv[3] — JSON-полезная нагрузка;
//   stdout  — РОВНО одна строка JSON с результатом;
//   stderr  — диагностика (родитель показывает её в сообщении assert).
//
// Запуск идёт через spawn, а не fork, и здесь нет process.exit():
// у fork всегда есть IPC-канал, который держал бы event loop живым и мешал
// процессу завершиться сам, а явный process.exit() умеет обрезать ещё не
// вытолкнутый в пайп хвост stdout. Естественное завершение цикла событий
// гарантирует, что родитель дочитает результат.

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createLeaseManager } from '../../lib/leases.js'
import { runtimeRoots } from '../../lib/paths.js'
import { createPortAllocator } from '../../lib/ports.js'
import { JsonStore } from '../../lib/store.js'

const delay = ms => new Promise(resolveTimer => setTimeout(resolveTimer, ms))

// Единственная разрешённая форма ожидания: условие + дедлайн. Фиксированный
// sleep дал бы тест, зелёный на быстрой машине и красный на загруженном CI.
async function waitForPath(path, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (existsSync(path)) return
    if (Date.now() >= deadline) throw new Error(`таймаут ожидания «${label}»: ${path}`)
    await delay(10)
  }
}

// Барьер-рандеву: процесс отмечается готовым и ждёт общего старта. Без него
// первый запущенный процесс успевал бы отработать раньше, чем последний
// закончит загрузку Node, и никакой конкуренции бы не возникло.
async function rendezvous({ barrierDir, index }) {
  await mkdir(barrierDir, { recursive: true })
  await writeFile(join(barrierDir, `ready-${String(index)}`), String(process.pid))
  await waitForPath(join(barrierDir, 'go'), 'общий старт от родителя')
}

function openRoots() {
  return runtimeRoots(process.env)
}

async function openStore() {
  const roots = openRoots()
  const store = new JsonStore(roots.stateRoot)
  await store.ensureRoot()
  return { roots, store }
}

// Режим 1: неатомарный read-modify-write общего счётчика под общим локом.
async function storeCounter(payload, emit) {
  const { store } = await openStore()
  await rendezvous(payload)
  await store.withLock(payload.lockName, async () => {
    // Пауза внутри критической секции — не синхронизация, а намеренное
    // расширение окна гонки: read → пауза → write. Если бы лок не работал
    // между процессами, инкременты гарантированно терялись бы именно тут.
    await appendFile(payload.witnessPath, `enter ${String(process.pid)}\n`)
    const before = JSON.parse(await readFile(payload.counterPath, 'utf8'))
    await delay(25)
    await writeFile(payload.counterPath, `${JSON.stringify({ value: before.value + 1 })}\n`)
    await appendFile(payload.witnessPath, `exit ${String(process.pid)}\n`)
  }, { timeoutMs: 60_000 })
  emit({ ok: true, pid: process.pid })
}

// Режим 2: захват lease одного workspace несколькими процессами сразу.
async function leaseAcquire(payload, emit) {
  const leases = createLeaseManager({ roots: openRoots(), env: process.env })
  await rendezvous(payload)
  try {
    const lease = await leases.acquire({
      workspaceId: payload.workspaceId,
      sessionId: payload.sessionId,
      userId: payload.userId,
    })
    emit({ ok: true, pid: process.pid, ownerToken: lease.ownerToken, generation: lease.generation })
  } catch (error) {
    emit({ ok: false, pid: process.pid, code: error?.code, message: error?.message })
  }
  // Победитель обязан дожить до снятия показаний родителем: мёртвый владелец
  // делает свой lease ORPHANED, и любой проигравший законно перехватит его.
  // Тогда «ровно один победитель» станет свойством тайминга, а не менеджера.
  await waitForPath(payload.finishPath, 'разрешение родителя завершиться')
}

// Режим 3: аллокация порта из общего узкого диапазона.
async function portAllocate(payload, emit) {
  const { store } = await openStore()
  const ports = createPortAllocator({ store, env: process.env })
  await rendezvous(payload)
  const record = await ports.allocate({ sessionId: payload.sessionId, name: 'app' })
  emit({ ok: true, pid: process.pid, port: record.port })
  // Тот же мотив, что и у lease: аллокатор возвращает порт в пул, когда его
  // владелец мёртв И порт свободен. Ранняя смерть процесса сделала бы выдачу
  // одного порта двум сессиям законной, и инвариант уникальности проверял бы
  // скорость запуска, а не сериализацию аллокации.
  await waitForPath(payload.finishPath, 'разрешение родителя завершиться')
}

// Режим 4: взять store-лок и умереть, не отпустив его.
async function holdStoreLock(payload, emit) {
  const { store } = await openStore()
  await store.withLock(payload.lockName, async () => {
    // О готовности сообщаем ИЗНУТРИ критической секции: withLock пишет
    // meta.json с pid до вызова action, поэтому родитель, увидев эту строку,
    // гарантированно видит на диске лок с живым владельцем.
    emit({ ok: true, pid: process.pid })
    // Лок не отпускается никогда — родитель убьёт процесс SIGKILL'ом.
    // Долгий таймер нужен только чтобы event loop не опустел: иначе процесс
    // завершился бы сам и отпустил лок через finally, и сценарий «мёртвый
    // владелец» не воспроизвёлся бы.
    await new Promise(resolveNever => { setTimeout(resolveNever, 10 * 60_000) })
  }, { timeoutMs: 60_000 })
}

const MODES = {
  'store-counter': storeCounter,
  'lease-acquire': leaseAcquire,
  'port-allocate': portAllocate,
  'hold-store-lock': holdStoreLock,
}

const mode = process.argv[2]
const payload = JSON.parse(process.argv[3] ?? '{}')

let emitted = false
const emit = value => {
  // Ровно одна строка JSON — контракт с родителем; повторная запись сломала
  // бы разбор результата.
  if (emitted) return
  emitted = true
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

if (!Object.hasOwn(MODES, mode)) {
  process.stderr.write(`неизвестный режим воркера: ${String(mode)}\n`)
  process.exitCode = 2
} else {
  try {
    await MODES[mode](payload, emit)
  } catch (error) {
    // Молчаливое падение дочернего процесса — худший исход для теста:
    // родитель увидел бы только «нет результата». Отдаём полный stack.
    process.stderr.write(`${String(error?.stack ?? error)}\n`)
    process.exitCode = 1
  }
}
