// Regression proof (§18 плана AI-качества): доказательство «проваленный →
// прошедший» из СОБСТВЕННЫХ записей Runtime, либо явный MANUAL_REPRO_ONLY.
//
// Выделен из quality.js (§19): узкая ответственность — валидация пары
// прогонов; чтение прогонов делегируется evidence-store.

import { RuntimeError } from './errors.js'

export function createRegressionProof({ tasks, getVerification }) {
  // Regression-first bugfix (§18): доказательство — ДВА реальных прогона:
  // проваленный (баг воспроизведён) и прошедший (баг исправлен). Runtime
  // проверяет прогоны по своим же записям — сочинить их словами нельзя.
  async function recordRegression(taskId, { failingRunId, passingRunId, manualReproOnly, reason }) {
    const task = await tasks.getTask(taskId)
    if (manualReproOnly === true) {
      if (typeof reason !== 'string' || reason.trim().length < 10) {
        throw new RuntimeError(
          'INVALID_INPUT',
          'MANUAL_REPRO_ONLY требует содержательной причины: почему баг нельзя воспроизвести автоматически.',
        )
      }
      return tasks.saveTask({
        ...task,
        regression: { status: 'MANUAL_REPRO_ONLY', reason: reason.trim().slice(0, 1000) },
      })
    }
    const failing = await getVerification(failingRunId)
    const passing = await getVerification(passingRunId)
    if (failing.taskId !== taskId || passing.taskId !== taskId) {
      throw new RuntimeError('INVALID_INPUT', 'Оба прогона должны принадлежать этой задаче.')
    }
    if (!failing.checks.some((check) => check.status === 'FAILED')) {
      throw new RuntimeError(
        'INVALID_INPUT',
        '«Проваленный» прогон не содержит ни одной FAILED-проверки — баг не был воспроизведён.',
        { failingRunId },
      )
    }
    if (
      !passing.checks.some((check) => check.status === 'PASSED') ||
      passing.checks.some((check) => check.status === 'FAILED' || check.status === 'TIMED_OUT')
    ) {
      throw new RuntimeError('INVALID_INPUT', '«Прошедший» прогон обязан быть полностью зелёным.', {
        passingRunId,
      })
    }
    if (Date.parse(failing.startedAt) >= Date.parse(passing.startedAt)) {
      throw new RuntimeError(
        'INVALID_INPUT',
        'Проваленный прогон должен предшествовать прошедшему.',
      )
    }
    return tasks.saveTask({ ...task, regression: { status: 'PROVEN', failingRunId, passingRunId } })
  }

  return { recordRegression }
}
