// Quality Pipeline — фасад (§19 плана authority).
//
// Раньше этот файл владел шестью ответственностями сразу (620 строк:
// политика, окружение, раннер, evidence, regression, readiness) и сам был
// God-модулем по меркам собственного анализатора. Теперь он — только
// composition layer: собирает узкие модули и сохраняет прежний публичный
// API. Характеризация — существующие quality/verification-races/review/e2e
// наборы, прошедшие до и после декомпозиции без изменений.

export { qualityPolicyOf, DEFAULT_REVIEW_GATE } from './quality-policy.js'
export { buildVerificationEnv, redactSecrets } from './verification-env.js'
export { KNOWN_CHECK_STATUS } from './readiness.js'

import { createPolicyManager } from './quality-policy.js'
import { createVerificationRunner } from './verification-runner.js'
import { createEvidenceStore } from './verification-evidence.js'
import { createRegressionProof } from './regression-proof.js'
import { createReadiness } from './readiness.js'
import { KNOWN_CHECK_STATUS } from './readiness.js'

export function createQualityManager({
  store,
  roots,
  projects,
  tasks,
  workspaces,
  processes,
  repoIntel,
}) {
  const policy = createPolicyManager({ store, roots, projects })
  const evidence = createEvidenceStore({ store })
  const runner = createVerificationRunner({
    store,
    roots,
    projects,
    tasks,
    workspaces,
    processes,
    repoIntel,
  })
  const regression = createRegressionProof({ tasks, getVerification: evidence.getVerification })
  const readiness = createReadiness({ store, roots, projects, tasks, workspaces, repoIntel })

  return {
    setPolicy: policy.setPolicy,
    runVerification: runner.runVerification,
    cancelVerification: runner.cancelVerification,
    getVerification: evidence.getVerification,
    recordRegression: regression.recordRegression,
    readiness: readiness.readiness,
    promoteIfReady: readiness.promoteIfReady,
    KNOWN_CHECK_STATUS,
  }
}
