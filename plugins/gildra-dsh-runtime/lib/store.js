// Durable-состояние Gildra Runtime: JSON-файлы с атомарной записью,
// schemaVersion, mkdir-локами и обработкой повреждений.
//
// Почему не SQLite: объём state мал (десятки записей), конкуренция —
// между небольшим числом процессов одного пользователя, а инвариант
// «только node:-модули» для локальных плагинов жёсткий. Повреждённый файл
// откладывается в сторону (.corrupt-*) и никогда не роняет процесс.
//
// Долговечность записи (§28): temp → fsync(файл) → rename → fsync(каталог).
// Без fsync каталога переименование живёт только в page cache: после потери
// питания читатель может увидеть каталог БЕЗ нового имени, хотя данные файла
// уже на диске. Без fsync файла — наоборот, имя есть, а содержимое нулевое.

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RuntimeError } from './errors.js'
import { assertId, assertSegment } from './ids.js'
import { migrateRecord } from './migrations.js'

const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 10_000

// Забытый temp-файл (краш между write и rename) — мусор, но удалять его
// сразу нельзя: рядом может писать живой процесс, и удаление его temp
// сломало бы чужую запись. Трогаем только заведомо старые.
const STALE_TMP_MS = 60_000
// Глубина обхода при уборке: rootDir (0) → коллекция/leases (1) → каталог
// одного lease с его meta.json.*.tmp (2). Глубже temp-файлов не бывает.
const TMP_SCAN_DEPTH = 2

// fsync каталога поддерживают не все платформы и ФС: Windows не позволяет
// открыть каталог как файл, часть сетевых/FUSE-ФС отвечает EINVAL/ENOTSUP.
// Это документированное ограничение платформы: rename уже выполнен, терять
// из-за него саму запись нельзя.
const DIR_SYNC_IGNORED = new Set(['EPERM', 'EACCES', 'EISDIR', 'ENOTSUP', 'EINVAL', 'ENOSYS', 'EBADF'])

// Windows: rename поверх существующего файла падает с EPERM/EACCES, если
// цель в этот момент открыта конкурентным читателем (или просканирована
// антивирусом). Окно — миллисекунды, поэтому короткий ограниченный retry
// превращает «случайно не записали» в «записали чуть позже». На POSIX
// rename поверх открытого файла атомарен, ретраить нечего.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES'])
const RENAME_RETRIES = 5
const RENAME_RETRY_MS = 20

// Коллекции, для которых «записи нет» и «запись повреждена» — принципиально
// разные события: за каждой записью стоит реальный worktree или репозиторий
// на диске. Если после повреждения наверху появится пустой state, Runtime
// попытается создать сессию поверх существующего worktree (см.
// docs/runtime-reliability.md, таблица crash-recovery). Поэтому повреждение
// критической записи обязано быть видимым вызывающему коду.
export const CRITICAL_COLLECTIONS = Object.freeze(['sessions', 'workspaces', 'projects'])

export function isCriticalCollection(collection) {
  return CRITICAL_COLLECTIONS.includes(collection)
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

async function syncDirectory(dir) {
  let handle
  try {
    handle = await open(dir, 'r')
    await handle.sync()
  } catch (error) {
    if (!DIR_SYNC_IGNORED.has(error?.code)) throw error
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

async function renameAtomic(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const retryable = process.platform === 'win32' && RENAME_RETRY_CODES.has(error?.code)
      if (!retryable || attempt >= RENAME_RETRIES) throw error
      await new Promise(resolveTimer => setTimeout(resolveTimer, RENAME_RETRY_MS * (attempt + 1)))
    }
  }
}

// Уборка забытых temp-файлов. Удаляются ТОЛЬКО обычные файлы с суффиксом
// .tmp старше STALE_TMP_MS: ни .json, ни отложенные .corrupt-* тронуты быть
// не могут — они и есть данные/улики для диагностики.
async function sweepStaleTemp(dir, depth, now) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // Каталога нет или он недоступен — уборка не обязана быть успешной.
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0) await sweepStaleTemp(path, depth - 1, now)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue
    try {
      const info = await stat(path)
      if (now - info.mtimeMs < STALE_TMP_MS) continue
      await rm(path, { force: true })
    } catch {
      // Файл уже унесли (наш же конкурент) — это ожидаемый исход гонки.
    }
  }
}

export class JsonStore {
  constructor(rootDir, { onCorrupt } = {}) {
    this.rootDir = rootDir
    this.onCorrupt = onCorrupt ?? (() => {})
    // Журнал повреждений за время жизни экземпляра: onCorrupt-колбэк удобен
    // для логов, но reconciliation нужен опрашиваемый список — он стартует
    // позже, чем случилось первое чтение.
    this.corruptionLog = []
  }

  async ensureRoot() {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
    // Старт — единственный момент, когда точно известно, что чужих
    // незавершённых записей этого процесса нет: подходящее место убрать
    // temp-файлы, оставшиеся после краха между write и rename.
    await sweepStaleTemp(this.rootDir, TMP_SCAN_DEPTH, Date.now())
  }

  filePath(collection, id) {
    return join(this.rootDir, assertSegment(collection, 'collection'), `${assertId(id, 'id')}.json`)
  }

  // Повреждения, зафиксированные этим экземпляром. `criticalOnly` отбирает
  // записи коллекций из CRITICAL_COLLECTIONS — по ним нельзя молча ехать
  // дальше с пустым состоянием.
  corruptions({ criticalOnly = false } = {}) {
    return criticalOnly ? this.corruptionLog.filter(entry => entry.critical) : [...this.corruptionLog]
  }

  hasCriticalCorruption() {
    return this.corruptionLog.some(entry => entry.critical)
  }

  // throwOnCorrupt — опция для вызывающего кода, которому «нет записи» и
  // «запись повреждена» нельзя путать (создание сессии, reconciliation).
  // По умолчанию поведение прежнее: undefined, файл отложен, Runtime жив.
  async read(collection, id, { throwOnCorrupt = false } = {}) {
    const path = this.filePath(collection, id)
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      // Повреждение не должно ронять Runtime и не должно молча теряться:
      // файл откладывается в сторону для диагностики, запись считается
      // отсутствующей.
      const aside = `${path}.corrupt-${Date.now().toString(36)}`
      await rename(path, aside).catch(() => {})
      const entry = { collection, id, aside, critical: isCriticalCollection(collection), at: new Date().toISOString() }
      this.corruptionLog.push(entry)
      this.onCorrupt(entry)
      if (throwOnCorrupt) {
        throw new RuntimeError('STORE_CORRUPT', `Запись «${collection}/${id}» повреждена и отложена в сторону; продолжать с пустым состоянием нельзя.`, { collection, id, aside, critical: entry.critical })
      }
      return undefined
    }
    // Миграция схемы — на чтении и БЕЗ переписывания файла: read() не берёт
    // лок, а значит не имеет права трогать диск. Запись более новой версии
    // Runtime бросает здесь STORE_CORRUPT и остаётся на диске нетронутой
    // (см. migrations.js).
    return migrateRecord(parsed, { collection, id })
  }

  async write(collection, id, value) {
    const path = this.filePath(collection, id)
    const dir = join(this.rootDir, collection)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      // 'wx' — temp-имя уникально по построению, и любое столкновение
      // означало бы чужую запись, поверх которой писать нельзя.
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await renameAtomic(temporary, path)
      await syncDirectory(dir)
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
        // Перехват — только под reaper-мьютексом с повторной проверкой pid:
        // иначе между чтением meta и rename конкурент мог унести уже
        // пересозданный СВЕЖИЙ лок нового владельца (та же гонка, что была в
        // lease-перехвате и воспроизводилась на CI).
        const reap = `${lockPath}.reap`
        let reaping = false
        try {
          await mkdir(reap)
          reaping = true
        } catch {
          try {
            const info = await stat(reap)
            if (Date.now() - info.mtimeMs > 30_000) await rm(reap, { recursive: true, force: true })
          } catch {
            /* reap уже исчез */
          }
        }
        let reaped = false
        if (reaping) {
          try {
            let livePid = null
            try {
              livePid = JSON.parse(await readFile(join(lockPath, 'meta.json'), 'utf8')).pid
            } catch {
              livePid = null
            }
            if (livePid === ownerPid && !processAlive(livePid)) {
              const stale = `${lockPath}.stale-${randomUUID()}`
              await rename(lockPath, stale)
              await rm(stale, { recursive: true, force: true }).catch(() => {})
              reaped = true
            }
          } catch {
            // Лок уже исчез или сменил владельца — просто повторяем цикл.
          } finally {
            await rm(reap, { recursive: true, force: true }).catch(() => {})
          }
        }
        // Ветка мёртвого владельца ОБЯЗАНА подчиняться тем же дедлайну и
        // паузе, что и обычное ожидание. Раньше она делала `continue` в обход
        // обеих проверок: при заклинившем перехвате (например брошенный
        // reap-каталог после SIGKILL жнеца или EPERM на rename в Windows)
        // цикл крутился на 100% CPU и игнорировал timeoutMs.
        if (Date.now() >= deadline) {
          throw new RuntimeError('WORKSPACE_BUSY', `Операция «${name}» занята другим процессом.`, { lock: name, ownerPid })
        }
        // Успешный перехват освободил путь — повторяем сразу; проигравший
        // гонку за reap-мьютекс ждёт, чтобы не жечь CPU.
        if (!reaped) await new Promise(resolveTimer => setTimeout(resolveTimer, LOCK_RETRY_MS))
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
