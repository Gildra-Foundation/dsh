// Тесты durable-store (§28–§30): атомарность и fsync записи, уборка забытых
// temp-файлов, forward-миграции схемы и различение critical/non-critical
// повреждений. Запуск: node plugins/gildra-dsh-runtime/test/store.test.mjs
//
// Windows-совместимость: POSIX-специфичные ассерты (права 0600) выполняются
// только при process.platform !== 'win32'.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CRITICAL_COLLECTIONS, JsonStore, isCriticalCollection } from '../lib/store.js'
import {
  BASELINE_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  migrateRecord,
  schemaVersionOf,
} from '../lib/migrations.js'

// Каталог с пробелом в имени — тот же инвариант Windows-путей, что и в
// остальных тестах Runtime.
const base = await mkdtemp(join(tmpdir(), 'gildra store '))

const tmpName = (root, collection, id) => join(root, collection, `${id}.json.${randomUUID()}.tmp`)
const backdate = async (path, ms) => {
  const when = new Date(Date.now() - ms)
  await utimes(path, when, when)
}

// --- Публичный API остаётся обратно совместимым --------------------------
{
  const store = new JsonStore(join(base, 'api-shape'))
  for (const method of ['read', 'write', 'delete', 'list', 'withLock', 'ensureRoot', 'filePath']) {
    assert.equal(typeof store[method], 'function', `JsonStore.${method} должен остаться публичным методом`)
  }
  for (const method of ['corruptions', 'hasCriticalCorruption']) {
    assert.equal(typeof store[method], 'function', `JsonStore.${method} должен быть доступен вызывающему коду`)
  }
}

// --- Атомарная запись: читатель видит либо старое, либо новое -------------
{
  const root = join(base, 'atomic')
  const store = new JsonStore(root)
  await store.ensureRoot()

  // Полезная нагрузка заведомо больше одного блока записи: неатомарная
  // запись «в тот же файл» порвалась бы на таком объёме наблюдаемо.
  const payload = size => Array.from({ length: size }, (_, index) => `line-${String(index)}`)
  const first = { schemaVersion: 1, marker: 'first', rows: payload(4000) }
  const second = { schemaVersion: 1, marker: 'second', rows: payload(4000) }

  await store.write('sessions', 'sess-atomic', first)
  assert.equal((await store.read('sessions', 'sess-atomic')).marker, 'first')
  if (process.platform !== 'win32') {
    assert.equal((await stat(store.filePath('sessions', 'sess-atomic'))).mode & 0o777, 0o600, 'файл состояния доступен только владельцу')
  }

  const writer = store.write('sessions', 'sess-atomic', second)
  const seen = new Set()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const record = await store.read('sessions', 'sess-atomic')
    assert.ok(record, 'запись не должна исчезать во время перезаписи')
    assert.ok(record.marker === 'first' || record.marker === 'second', 'читатель видит только целое содержимое')
    assert.equal(record.rows.length, 4000, 'частично записанный файл читателю недоступен')
    seen.add(record.marker)
  }
  await writer
  assert.equal((await store.read('sessions', 'sess-atomic')).marker, 'second')
  assert.deepEqual(store.corruptions(), [], 'ни одно чтение не увидело порванного JSON')
  assert.ok(seen.size >= 1)

  // Temp-файлы после успешной записи не остаются.
  const leftovers = (await readdir(join(root, 'sessions'))).filter(name => name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [], 'после успешной записи temp-файлов быть не должно')

  // Ошибка записи тоже не оставляет мусора: id проходит валидацию, а значение
  // не сериализуется (циклическая ссылка) — temp удаляется в catch.
  const cyclic = { schemaVersion: 1 }
  cyclic.self = cyclic
  await assert.rejects(store.write('sessions', 'sess-cyclic', cyclic))
  assert.deepEqual(
    (await readdir(join(root, 'sessions'))).filter(name => name.endsWith('.tmp')),
    [],
    'неудачная запись убирает свой temp-файл',
  )
}

// --- fsync-путь проходит на текущей платформе ----------------------------
{
  // fsync каталога на Windows невозможен (документированное ограничение) и
  // подавляется по коду ошибки; на POSIX он выполняется. Тест фиксирует, что
  // ни один из путей не ломает запись, включая только что созданную коллекцию.
  const store = new JsonStore(join(base, 'fsync'))
  await store.ensureRoot()
  await assert.doesNotReject(store.write('projects', 'demo', { schemaVersion: 1, projectId: 'demo' }))
  await assert.doesNotReject(store.write('projects', 'demo', { schemaVersion: 1, projectId: 'demo', updated: true }))
  assert.equal((await store.read('projects', 'demo')).updated, true)
  assert.deepEqual(await store.list('projects'), ['demo'])
}

// --- ensureRoot убирает забытые .tmp, но не данные и не улики ------------
{
  const root = join(base, 'sweep')
  const store = new JsonStore(root)
  await store.ensureRoot()
  await store.write('sessions', 'sess-keep', { schemaVersion: 1, status: 'ACTIVE' })

  const corrupt = join(root, 'sessions', 'sess-old.json.corrupt-abc123')
  await writeFile(corrupt, '{broken', { mode: 0o600 })
  const staleTmp = tmpName(root, 'sessions', 'sess-keep')
  await writeFile(staleTmp, '{"schemaVersion":1}', { mode: 0o600 })
  await backdate(staleTmp, 10 * 60_000)
  const freshTmp = tmpName(root, 'sessions', 'sess-keep')
  await writeFile(freshTmp, '{"schemaVersion":1}', { mode: 0o600 })

  // Вложенный уровень: temp lease-меты живёт на два каталога глубже корня.
  const leaseDir = join(root, 'leases', 'demo--alex--sess-a.lease')
  await mkdir(leaseDir, { recursive: true })
  await writeFile(join(leaseDir, 'meta.json'), '{"schemaVersion":1}', { mode: 0o600 })
  const staleLeaseTmp = join(leaseDir, `meta.json.${randomUUID()}.tmp`)
  await writeFile(staleLeaseTmp, '{}', { mode: 0o600 })
  await backdate(staleLeaseTmp, 10 * 60_000)

  await store.ensureRoot()

  assert.equal(existsSync(staleTmp), false, 'забытый temp-файл удаляется')
  assert.equal(existsSync(staleLeaseTmp), false, 'забытый temp-файл убирается и во вложенном каталоге')
  assert.equal(existsSync(freshTmp), true, 'свежий temp живого писателя трогать нельзя')
  assert.equal(existsSync(corrupt), true, '.corrupt-* — улика для диагностики, удалять её нельзя')
  assert.equal(existsSync(join(leaseDir, 'meta.json')), true, 'данные lease не трогаются')
  assert.equal(existsSync(store.filePath('sessions', 'sess-keep')), true, '.json удалять нельзя никогда')
  // Чтение прогоняет запись через миграции: v1-сессия получает текущую
  // версию тождественным шагом (формат сессий в v2 не менялся).
  assert.deepEqual(await store.read('sessions', 'sess-keep'), { schemaVersion: 2, status: 'ACTIVE' })
}

// --- Реестр миграций ------------------------------------------------------
{
  assert.equal(CURRENT_SCHEMA_VERSION, 2)
  assert.equal(BASELINE_SCHEMA_VERSION, 1)
  for (const key of Object.keys(MIGRATIONS)) {
    const from = Number(key)
    assert.ok(Number.isInteger(from), 'ключ реестра — версия, из которой мигрируем')
    assert.ok(from >= BASELINE_SCHEMA_VERSION && from < CURRENT_SCHEMA_VERSION, `миграция ${key} ведёт за пределы текущей схемы`)
  }

  // Запись текущей версии проходит насквозь без изменений.
  const current = { schemaVersion: CURRENT_SCHEMA_VERSION, status: 'ACTIVE' }
  assert.equal(migrateRecord(current, { collection: 'sessions' }), current)
  // Запись без schemaVersion — baseline первой версии, а не «текущая».
  assert.equal(schemaVersionOf({ status: 'ACTIVE' }), BASELINE_SCHEMA_VERSION)
  assert.deepEqual(migrateRecord({ status: 'ACTIVE' }, { collection: 'sessions' }), { status: 'ACTIVE', schemaVersion: CURRENT_SCHEMA_VERSION })
  // Не-запись (примитив, массив) миграции не «чинят».
  assert.equal(migrateRecord(null, { collection: 'sessions' }), null)
  assert.deepEqual(migrateRecord([1, 2], { collection: 'sessions' }), [1, 2])
}

// --- Forward-миграция применяется последовательно ------------------------
{
  // Цепочка проверяется на инъецированном реестре — тем же кодом, что и
  // боевой (боевой реестр дополнительно проверяется в tasks.test.mjs).
  const migrations = {
    1: record => ({ ...record, steps: [...(record.steps ?? []), 'v1->v2'] }),
    2: record => ({ ...record, steps: [...record.steps, 'v2->v3'] }),
  }
  const legacy = { schemaVersion: 1, status: 'ACTIVE' }
  const migrated = migrateRecord(legacy, { collection: 'sessions', migrations, targetVersion: 3 })
  assert.deepEqual(migrated, { schemaVersion: 3, status: 'ACTIVE', steps: ['v1->v2', 'v2->v3'] })
  assert.deepEqual(legacy, { schemaVersion: 1, status: 'ACTIVE' }, 'исходная запись не мутируется')

  // Запись без версии тоже мигрируется от baseline.
  assert.equal(migrateRecord({ status: 'ACTIVE' }, { collection: 'sessions', migrations, targetVersion: 2 }).schemaVersion, 2)

  // Версию проставляет реестр, даже если шаг о ней забыл.
  const forgetful = { 1: record => ({ ...record, touched: true }) }
  assert.equal(migrateRecord({ schemaVersion: 1 }, { collection: 'tasks', migrations: forgetful, targetVersion: 2 }).schemaVersion, 2)

  // Пропуск шага в реестре — повреждение, а не «пропустим и поедем».
  assert.throws(
    () => migrateRecord({ schemaVersion: 1 }, { collection: 'sessions', migrations: {}, targetVersion: 2 }),
    error => error.code === 'STORE_CORRUPT' && error.details?.reason === 'MISSING_MIGRATION',
  )
  // Сломанный шаг (вернул не запись) тоже не проходит молча.
  assert.throws(
    () => migrateRecord({ schemaVersion: 1 }, { collection: 'sessions', migrations: { 1: () => undefined }, targetVersion: 2 }),
    error => error.code === 'STORE_CORRUPT' && error.details?.reason === 'BROKEN_MIGRATION',
  )
}

// --- Запись из будущего отвергается, а не «чинится» ----------------------
{
  const future = { schemaVersion: CURRENT_SCHEMA_VERSION + 1, status: 'ACTIVE' }
  assert.throws(
    () => migrateRecord(future, { collection: 'sessions', id: 'sess-1' }),
    error => error.code === 'STORE_CORRUPT'
      && error.status === 500
      && error.details?.reason === 'FUTURE_SCHEMA_VERSION'
      && error.details?.supportedSchemaVersion === CURRENT_SCHEMA_VERSION
      && /более новой версией Runtime/.test(error.message),
  )
  // Мусорная версия — тоже повреждение.
  for (const broken of [0, -1, 1.5, 'два', true]) {
    assert.throws(
      () => migrateRecord({ schemaVersion: broken }, { collection: 'sessions' }),
      error => error.code === 'STORE_CORRUPT' && error.details?.reason === 'INVALID_SCHEMA_VERSION',
      `schemaVersion «${String(broken)}» должен отвергаться`,
    )
  }
}

// --- read() прогоняет запись через миграции ------------------------------
{
  const root = join(base, 'migrate-read')
  const store = new JsonStore(root)
  await store.ensureRoot()
  await mkdir(join(root, 'sessions'), { recursive: true })
  const path = store.filePath('sessions', 'sess-future')
  await writeFile(path, JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, status: 'ACTIVE' }), { mode: 0o600 })

  await assert.rejects(
    store.read('sessions', 'sess-future'),
    error => error.code === 'STORE_CORRUPT' && error.details?.reason === 'FUTURE_SCHEMA_VERSION',
  )
  // Состояние более новой версии не повреждено и не отложено в сторону: его
  // должен прочитать обновлённый Runtime.
  assert.equal(existsSync(path), true, 'запись из будущего остаётся на месте')
  assert.equal(JSON.parse(await readFile(path, 'utf8')).schemaVersion, CURRENT_SCHEMA_VERSION + 1)
  assert.deepEqual(store.corruptions(), [], 'запись из будущего — не повреждение файла')

  // Обычная запись читается как раньше (v1 мигрирует на чтении в текущую).
  await store.write('sessions', 'sess-ok', { schemaVersion: 1, status: 'ACTIVE' })
  assert.deepEqual(await store.read('sessions', 'sess-ok'), { schemaVersion: 2, status: 'ACTIVE' })
}

// --- Повреждение критической коллекции видно вызывающему коду ------------
{
  const root = join(base, 'corrupt')
  const callbackSeen = []
  const store = new JsonStore(root, { onCorrupt: entry => callbackSeen.push(entry) })
  await store.ensureRoot()

  assert.deepEqual([...CRITICAL_COLLECTIONS], ['sessions', 'workspaces', 'projects'])
  assert.equal(isCriticalCollection('sessions'), true)
  assert.equal(isCriticalCollection('ports'), false)

  await store.write('sessions', 'sess-1', { schemaVersion: 1, status: 'ACTIVE' })
  await writeFile(store.filePath('sessions', 'sess-1'), '{broken', { mode: 0o600 })
  assert.equal(await store.read('sessions', 'sess-1'), undefined, 'повреждение не роняет Runtime')

  const [entry] = store.corruptions()
  assert.equal(store.corruptions().length, 1)
  assert.equal(entry.collection, 'sessions')
  assert.equal(entry.id, 'sess-1')
  assert.equal(entry.critical, true, 'sessions — критическая коллекция')
  assert.equal(existsSync(entry.aside), true, 'повреждённый файл отложен, а не удалён')
  assert.equal(existsSync(store.filePath('sessions', 'sess-1')), false)
  assert.equal(store.hasCriticalCorruption(), true)
  assert.deepEqual(callbackSeen, store.corruptions(), 'onCorrupt-колбэк продолжает работать')

  // Некритическая коллекция помечается иначе — и не мешает отбору критических.
  await store.write('tasks', 'task-1', { schemaVersion: 1 })
  await writeFile(store.filePath('tasks', 'task-1'), 'not json', { mode: 0o600 })
  assert.equal(await store.read('tasks', 'task-1'), undefined)
  assert.equal(store.corruptions().length, 2)
  assert.equal(store.corruptions().at(-1).critical, false)
  assert.deepEqual(store.corruptions({ criticalOnly: true }).map(row => row.id), ['sess-1'])

  // Список — копия: внешний код не может испортить журнал экземпляра.
  store.corruptions().push({ collection: 'fake' })
  assert.equal(store.corruptions().length, 2)

  // throwOnCorrupt: вызывающий код, для которого «нет записи» и «запись
  // повреждена» — разные исходы, получает структурированную ошибку.
  await store.write('workspaces', 'demo--alex--sess-a', { schemaVersion: 1 })
  await writeFile(store.filePath('workspaces', 'demo--alex--sess-a'), '{', { mode: 0o600 })
  await assert.rejects(
    store.read('workspaces', 'demo--alex--sess-a', { throwOnCorrupt: true }),
    error => error.code === 'STORE_CORRUPT' && error.details?.critical === true,
  )
  assert.equal(store.corruptions().length, 3)

  // Отсутствующая запись остаётся просто отсутствующей и в строгом режиме.
  assert.equal(await store.read('sessions', 'sess-missing', { throwOnCorrupt: true }), undefined)
}

// --- withLock по-прежнему сериализует конкурентов ------------------------
{
  const root = join(base, 'lock')
  const store = new JsonStore(root)
  await store.ensureRoot()
  const counterPath = join(root, 'counter.json')
  await writeFile(counterPath, '0')
  await Promise.all(Array.from({ length: 20 }, () => store.withLock('counter', async () => {
    const value = Number(await readFile(counterPath, 'utf8'))
    await new Promise(resolveTimer => setTimeout(resolveTimer, 2))
    await writeFile(counterPath, String(value + 1))
  })))
  assert.equal(Number(await readFile(counterPath, 'utf8')), 20, 'ни один инкремент не потерян')
}

await rm(base, { recursive: true, force: true })

// --- withLock: ветка мёртвого владельца соблюдает дедлайн (регрессия) ----
// Сценарий из стресс-теста: жнеца убили SIGKILL, его reap-каталог остался.
// Раньше ветка мёртвого владельца делала `continue` в обход проверки дедлайна
// и паузы — вызов не возвращался по timeoutMs и крутил CPU в тугом цикле.
{
  const root = await mkdtemp(join(tmpdir(), 'gildra-lock-deadline-'))
  const store = new JsonStore(root)
  await store.ensureRoot()

  const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const deadPid = deadChild.pid
  await new Promise(resolveExit => deadChild.on('exit', resolveExit))

  const lockPath = join(root, 'locks', 'stuck.lock')
  await mkdir(lockPath, { recursive: true })
  await writeFile(join(lockPath, 'meta.json'), JSON.stringify({ pid: deadPid }))
  // Осиротевший reap-мьютекс: свежий, поэтому 30-секундный порог «брошенного»
  // ещё не сработает и перехват будет проваливаться на каждой итерации.
  await mkdir(`${lockPath}.reap`, { recursive: true })

  const startedAt = Date.now()
  let thrown
  try {
    await store.withLock('stuck', async () => 'не должно выполниться', { timeoutMs: 300 })
  } catch (error) {
    thrown = error
  }
  const elapsed = Date.now() - startedAt
  assert.equal(thrown?.code, 'WORKSPACE_BUSY', 'заклинивший перехват обязан завершиться по таймауту')
  assert.ok(elapsed < 3000, `таймаут 300 мс должен соблюдаться, а ожидание заняло ${String(elapsed)} мс`)

  await rm(root, { recursive: true, force: true })
}

console.log('Gildra Runtime store tests passed.')
