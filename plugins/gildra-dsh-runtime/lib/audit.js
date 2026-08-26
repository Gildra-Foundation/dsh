// Локальный audit-лог опасных операций Runtime (JSONL).
//
// Нужен для диагностики конкурентных багов: кто создал/удалил workspace,
// кто захватил lease, какой процесс был завершён. Никогда не пишет секреты,
// токены, env целиком или содержимое пользовательского кода — вызывающий код
// передаёт только идентификаторы и краткие факты.

import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const MAX_LOG_BYTES = 5 * 1024 * 1024

export function auditLogPath(stateRoot) {
  return join(stateRoot, 'audit.log')
}

export async function appendAudit(stateRoot, event, fields = {}) {
  const path = auditLogPath(stateRoot)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    const info = await stat(path)
    if (info.size > MAX_LOG_BYTES) {
      // Одна ротация достаточна: это диагностический лог, не журнал аудита
      // соответствия. Старший файл перезаписывается.
      await rename(path, `${path}.1`).catch(() => {})
    }
  } catch {
    // Файла ещё нет.
  }
  const line = JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, event, ...fields })
  await appendFile(path, `${line}\n`, { mode: 0o600 })
}
