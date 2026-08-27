// Версионирование durable-записей Gildra Runtime (§29).
//
// State переживает обновление Runtime, поэтому у каждой записи есть
// schemaVersion, а у Runtime — реестр forward-миграций. Модуль вынесен из
// store.js, потому что правило одно на все коллекции и должно проверяться
// тестом отдельно от файловых деталей:
//   1) миграции применяются последовательно и только вперёд;
//   2) запись БОЛЕЕ НОВОЙ версии, чем понимает этот Runtime, не читается и не
//      «чинится» — старый код не знает, какие инварианты добавила новая
//      версия, и молчаливая деградация здесь означала бы потерю данных
//      (unknown future version → refuse safely).

import { RuntimeError } from './errors.js'

export const CURRENT_SCHEMA_VERSION = 2

// Первая версия формата. Запись без schemaVersion считается именно ею (а не
// текущей): иначе после ввода версии 2 старые файлы проскочили бы мимо
// миграции и были бы прочитаны как уже мигрированные.
export const BASELINE_SCHEMA_VERSION = 1

// v1 → v2: инженерная модель Task (docs/ai-quality.md). Статусы задач
// переименованы, появились критерии/scope/claims/acknowledgments. Остальные
// коллекции формат не меняли — для них шаг тождественный.
const TASK_STATUS_V1_TO_V2 = Object.freeze({
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IMPLEMENTING',
  TESTING: 'VERIFYING',
  REVIEW: 'REVIEWING',
  // Старый READY назначался словами, без evidence: честнее вернуть задачу в
  // REVIEWING, чем объявить её прошедшей gate, которого тогда не существовало.
  READY: 'REVIEWING',
  MERGED: 'MERGED',
  FAILED: 'FAILED',
})

function migrateTaskV1(record) {
  return {
    ...record,
    status: TASK_STATUS_V1_TO_V2[record.status] ?? 'PLANNED',
    kind: record.kind ?? 'feature',
    acceptanceCriteria: record.acceptanceCriteria ?? [],
    expectedAreas: record.expectedAreas ?? [],
    claims: record.claims ?? [],
    acknowledgments: record.acknowledgments ?? [],
    reviews: record.reviews ?? [],
    ...(record.status === 'READY' ? { blockReason: 'Статус READY из старой схемы: пройдите quality-gate заново.' } : {}),
    ...(record.status === 'FAILED' && !record.failureKind ? { failureKind: 'IMPLEMENTATION' } : {}),
  }
}

// Реестр forward-миграций: ключ — версия, ИЗ которой мигрируем
// (MIGRATIONS[1] превращает запись v1 в v2, MIGRATIONS[2] — v2 в v3, …).
// Сам шаг возвращает новую запись; поле schemaVersion проставляет migrateRecord.
export const MIGRATIONS = Object.freeze({
  1: (record, { collection } = {}) => (collection === 'tasks' ? migrateTaskV1(record) : record),
})

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function label(collection, id) {
  if (collection === undefined || collection === null) return 'state'
  return id === undefined || id === null ? String(collection) : `${String(collection)}/${String(id)}`
}

export function schemaVersionOf(record) {
  if (!isRecord(record)) return BASELINE_SCHEMA_VERSION
  const raw = record.schemaVersion
  return raw === undefined || raw === null ? BASELINE_SCHEMA_VERSION : raw
}

// Применяет forward-миграции к прочитанной записи. Опциональные `migrations`
// и `targetVersion` существуют ради тестов реестра: боевой вызов передаёт
// только { collection, id }.
export function migrateRecord(record, { collection, id, migrations = MIGRATIONS, targetVersion = CURRENT_SCHEMA_VERSION } = {}) {
  // Примитив или массив — это не запись state (например, чужой файл в
  // каталоге). Возвращаем как есть: миграции не должны «чинить» чужой формат.
  if (!isRecord(record)) return record

  const where = { collection, ...(id === undefined ? {} : { id }) }
  const version = schemaVersionOf(record)
  if (!Number.isInteger(version) || version < BASELINE_SCHEMA_VERSION) {
    throw new RuntimeError('STORE_CORRUPT', `Запись «${label(collection, id)}» содержит недопустимый schemaVersion — состояние повреждено.`, {
      ...where,
      schemaVersion: record.schemaVersion,
      reason: 'INVALID_SCHEMA_VERSION',
    })
  }
  if (version > targetVersion) {
    // Единственная реакция, которая не теряет данные: отказаться. Запись
    // остаётся на диске нетронутой, чтобы её прочитал более новый Runtime.
    throw new RuntimeError('STORE_CORRUPT', `Состояние «${label(collection, id)}» создано более новой версией Runtime (schemaVersion ${String(version)} > ${String(targetVersion)}). Обновите Gildra DSH: старый Runtime не станет читать или переписывать такую запись.`, {
      ...where,
      schemaVersion: version,
      supportedSchemaVersion: targetVersion,
      reason: 'FUTURE_SCHEMA_VERSION',
    })
  }

  let current = record
  for (let from = version; from < targetVersion; from += 1) {
    const step = Object.hasOwn(migrations, from) ? migrations[from] : undefined
    if (typeof step !== 'function') {
      throw new RuntimeError('STORE_CORRUPT', `Нет миграции состояния «${label(collection, id)}» с версии ${String(from)} на ${String(from + 1)}.`, {
        ...where,
        schemaVersion: from,
        supportedSchemaVersion: targetVersion,
        reason: 'MISSING_MIGRATION',
      })
    }
    const next = step(current, { collection, id })
    if (!isRecord(next)) {
      throw new RuntimeError('STORE_CORRUPT', `Миграция состояния «${label(collection, id)}» с версии ${String(from)} вернула не запись.`, {
        ...where,
        schemaVersion: from,
        reason: 'BROKEN_MIGRATION',
      })
    }
    // Версию проставляет реестр, а не сам шаг: миграция, забывшая обновить
    // schemaVersion, иначе зациклила бы обновление.
    current = { ...next, schemaVersion: from + 1 }
  }
  return current
}
