// Task — фасад (§20 плана authority).
//
// tasks.js владел десятком ответственностей (689 строк) и был God-модулем по
// меркам собственного анализатора. Теперь — composition layer над узкими
// модулями: task-store (записи и валидаторы), task-lifecycle (переходы и
// gates), task-planning (постановка/план/workspace), task-claims
// (пересечения и их решения), task-acknowledgments (гашение сигналов),
// task-delivery (PR/CI/human-approvals), task-team-view (обзор и
// синхронизация). Публичный API сохранён; характеризация — все существующие
// наборы.

export {
  TASK_STATUSES,
  ACTIVE_TASK_STATUSES,
  FAILURE_KINDS,
  TASK_KINDS,
} from './task-store.js'
export { ACKNOWLEDGEABLE_SIGNALS, REVIEWER_ACK_SIGNALS } from './task-acknowledgments.js'
export { OVERLAP_DECISIONS } from './task-claims.js'

import { createTaskStore } from './task-store.js'
import { createTaskTeamView } from './task-team-view.js'
import { createTaskClaims } from './task-claims.js'
import { createTaskPlanning } from './task-planning.js'
import { createTaskAcknowledgments } from './task-acknowledgments.js'
import { createTaskDelivery } from './task-delivery.js'
import { createTaskLifecycle } from './task-lifecycle.js'

export function createTaskManager({ store, roots, projects, team, repoIntel }) {
  const taskStore = createTaskStore({ store })
  const teamView = createTaskTeamView({ store, roots, team, taskStore })
  const claims = createTaskClaims({ roots, team, repoIntel, taskStore, teamView })
  const planning = createTaskPlanning({ store, roots, projects, taskStore, claims })
  const acknowledgments = createTaskAcknowledgments({ roots, taskStore })
  const delivery = createTaskDelivery({ roots, taskStore })
  const lifecycle = createTaskLifecycle({ roots, projects, team, taskStore, claims, teamView })

  return {
    createTask: planning.createTask,
    setModulePlan: planning.setModulePlan,
    attachWorkspace: planning.attachWorkspace,
    updateTask: planning.updateTask,
    getTask: taskStore.getTask,
    listTasks: taskStore.listTasks,
    saveTask: taskStore.saveTask,
    transition: lifecycle.transition,
    setClaims: claims.setClaims,
    recordOverlapDecision: claims.recordOverlapDecision,
    overlapsFor: claims.overlapsFor,
    semanticOverlapsFor: claims.semanticOverlapsFor,
    acknowledgeSignal: acknowledgments.acknowledgeSignal,
    recordDelivery: delivery.recordDelivery,
    recordCiEvidence: delivery.recordCiEvidence,
    recordHumanApproval: delivery.recordHumanApproval,
    teamOverview: teamView.teamOverview,
    teamSyncState: teamView.teamSyncState,
  }
}
