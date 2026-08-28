// Verification Evidence: durable-записи прогонов и их чтение (§19).
//
// Владеет именем коллекции и доступом к записям; свежесть и выбор последнего
// прогона решает readiness, исполнение — runner.

import { RuntimeError } from './errors.js'
import { assertId } from './ids.js'

export const VERIFICATIONS = 'verifications'

export function createEvidenceStore({ store }) {
  async function getVerification(runId) {
    const run = await store.read(VERIFICATIONS, assertId(runId, 'runId'))
    if (!run) throw new RuntimeError('TASK_NOT_FOUND', `Прогон «${runId}» не найден.`, { runId })
    return run
  }

  return { getVerification }
}
