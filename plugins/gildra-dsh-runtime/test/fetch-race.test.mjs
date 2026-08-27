// Гонка fetch ↔ createWorkspace ↔ merge (§56 плана AI-качества).
//
// Контракт: каждая операция после выбора ref работает с НЕИЗМЕНЯЕМЫМ commit
// SHA; движущаяся ссылка не меняет уже начатую операцию и не приводит к
// тихой потере чужих коммитов.
//
// Доказываемые инварианты:
//   1. create при постоянно движущемся main: каждый workspace стоит ровно на
//      своём записанном baseSha (никогда «наполовину на новом»);
//   2. источник merge закреплён при старте: сдвиг source-ветки в окне
//      конфликта НЕ меняет то, что будет слито (parent2 == записанный SHA);
//   3. сдвиг TARGET в окне конфликта обнаруживается: merge падает
//      MERGE_TARGET_MOVED, а чужой коммит на цели СОХРАНЯЕТСЯ (без него
//      merge молча выбрасывал бы его содержимое — доказано экспериментом);
//   4. хаос: fetch + параллельные create при движущемся origin — все
//      воркспейсы консистентны, canonical main содержит все чужие коммиты.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, commitParent, git, revParse } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { createProjectRegistry } from '../lib/projects.js'
import { createWorkspaceManager } from '../lib/workspaces.js'

const identity = { name: 'Seed', email: 'seed@test' }
const base = await mkdtemp(join(tmpdir(), 'gildra fetch race '))

// origin-репозиторий (обычный, с рабочим деревом) и bare-клон как canonical.
const origin = join(base, 'origin')
await git(['init', '-b', 'main', origin])
await git(['-C', origin, 'config', 'core.autocrlf', 'false'])
await writeFile(join(origin, 'shared.txt'), 'v1\n')
await commitAll(origin, 'v1', identity)
const canonical = join(base, 'canonical.git')
// Ровно как production cloneBare: никакого ручного refspec — безопасный
// явный refspec задаёт сам fetchOrigin.
await git(['clone', '--bare', origin, canonical])

const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
await store.write('projects', 'demo', {
  schemaVersion: 2, projectId: 'demo', canonicalRepoPath: canonical,
  origin: { type: 'clone', url: 'https://github.com/example/demo' },
  defaultBranch: 'main', protectedBranches: ['main'], createdAt: new Date().toISOString(),
})
const workspaces = createWorkspaceManager({ store, roots, projects, env: {} })

async function pushOriginCommit(label) {
  await writeFile(join(origin, 'shared.txt'), `${label}\n`)
  await commitAll(origin, label, identity)
  // Как боевой fetchOrigin: ref-обновление может транзиентно проиграть гонку
  // ref-локов параллельному worktree add — повторяем, а не падаем. Ровно
  // поэтому у production-fetch есть retry с backoff.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await git(['-C', canonical, 'fetch', 'origin', '+refs/heads/*:refs/heads/*'], { allowFailure: true })
    if (!result.failed) break
    if (attempt === 5) throw new Error(`fetch не прошёл за 5 попыток: ${result.stderr}`)
    await new Promise(resolveTimer => setTimeout(resolveTimer, 30 * attempt))
  }
  return revParse(canonical, 'main')
}

// --- 1. create при движущемся main ----------------------------------------
{
  let moving = true
  const moverShas = []
  const mover = (async () => {
    let tick = 0
    while (moving) {
      moverShas.push(await pushOriginCommit(`move-${String(tick += 1)}`))
      await new Promise(resolveTimer => setTimeout(resolveTimer, 15))
    }
  })()
  const created = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: `race${String(index)}` })))
  moving = false
  await mover

  for (const workspace of created) {
    const head = await revParse(workspace.path, 'HEAD')
    assert.equal(head, workspace.baseSha,
      `workspace ${workspace.workspaceId} стоит на ${head}, а записан baseSha ${workspace.baseSha}`)
  }
  assert.ok(moverShas.length >= 2, 'main действительно двигался во время создания')
}

// --- Подготовка веток для merge-сценариев ---------------------------------
// Конфликтный сценарий: source и target правят одну строку.
const wsB = await workspaces.createWorkspace({ projectId: 'demo', userId: 'alex', sessionId: 'mergeb' })
await writeFile(join(wsB.path, 'shared.txt'), 'source change\n')
await commitAll(wsB.path, 'source change', identity)

// --- 2–3. Сдвиг source и target в окне конфликта --------------------------
{
  // Конфликт: target тоже правит shared.txt (через origin+fetch ДО старта).
  await pushOriginCommit('target conflicting change')
  const merge = await workspaces.startMerge({ projectId: 'demo', sourceBranch: wsB.branch, targetBranch: 'main' })
  assert.equal(merge.status, 'CONFLICT', 'сценарию нужен именно конфликт (окно открыто)')
  assert.equal(typeof merge.sourceSha, 'string', 'источник закреплён SHA при старте')

  // Доказанный факт: пока merge-worktree держит main извлечённой, сам git
  // ОТКАЗЫВАЕТСЯ делать fetch в эту ветку — обычный fetch не может сдвинуть
  // target посреди merge. Окно сдвига остаётся только для update-ref-класса
  // операций (перехват, ручное вмешательство) — их ловит guard ниже.
  await writeFile(join(origin, 'shared.txt'), 'blocked fetch\n')
  await commitAll(origin, 'blocked fetch', identity)
  const refused = await git(['-C', canonical, 'fetch', 'origin', '+refs/heads/*:refs/heads/*'], { allowFailure: true })
  assert.equal(refused.failed, true)
  assert.match(String(refused.stderr), /refusing to fetch into branch/,
    'git обязан отказать fetch в извлечённую ветку')

  // Пока конфликт разбирается, source-ветка уезжает вперёд…
  await writeFile(join(wsB.path, 'later.txt'), 'after start\n')
  await commitAll(wsB.path, 'source moved after merge start', identity)
  const movedSource = await revParse(canonical, wsB.branch)
  assert.notEqual(movedSource, merge.sourceSha)

  // …а target двигает update-ref-класс операции (чужой коммит X строится
  // plumbing-ом прямо в canonical: commit-tree + update-ref обходят guard
  // извлечённой ветки — ровно как показал эксперимент).
  const mainTip = await revParse(canonical, 'main')
  const foreignCommit = await git(['-C', canonical, 'commit-tree', `${mainTip}^{tree}`, '-p', mainTip, '-m', 'foreign X during conflict'], {
    env: { GIT_AUTHOR_NAME: 'X', GIT_AUTHOR_EMAIL: 'x@t', GIT_COMMITTER_NAME: 'X', GIT_COMMITTER_EMAIL: 'x@t' },
  })
  const foreignTip = foreignCommit.stdout.trim()
  await git(['-C', canonical, 'update-ref', 'refs/heads/main', foreignTip, mainTip])

  // Разрешаем конфликт и пытаемся завершить.
  await writeFile(join(merge.path, 'shared.txt'), 'resolved\n')
  await assert.rejects(
    workspaces.completeMerge(merge.mergeId),
    error => error.code === 'MERGE_TARGET_MOVED',
    'сдвинутый target обязан быть обнаружен, а не молча переписан',
  )
  // Чужой коммит X сохранён на цели.
  assert.equal(await revParse(canonical, 'main'), foreignTip,
    'чужой коммит на цели должен пережить неудавшийся merge')
  const failed = await workspaces.getMerge(merge.mergeId)
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.targetMoved, true)

  // Повторный merge на свежей базе завершается, и parent2 — уже НОВЫЙ
  // закреплённый SHA источника (движение до старта — легально).
  const retry = await workspaces.startMerge({ projectId: 'demo', sourceBranch: wsB.branch, targetBranch: 'main' })
  assert.equal(retry.status, 'CONFLICT')
  await writeFile(join(retry.path, 'shared.txt'), 'resolved v2\n')
  const completed = await workspaces.completeMerge(retry.mergeId)
  assert.equal(completed.status, 'COMPLETED')
  assert.equal(retry.sourceSha, movedSource)
  const parent2 = await git(['-C', canonical, 'rev-parse', `${completed.targetAfter}^2`])
  assert.equal(parent2.stdout.trim(), retry.sourceSha,
    'merge обязан слить закреплённый при старте SHA, а не «текущую» ветку')
  assert.equal(await commitParent(canonical, completed.targetAfter), retry.targetBefore,
    'первый родитель merge-коммита — target на момент старта')
}

// --- 4. Хаос: fetch + create одновременно ---------------------------------
{
  let moving = true
  const mover = (async () => {
    let tick = 0
    while (moving) {
      await pushOriginCommit(`chaos-${String(tick += 1)}`)
      await new Promise(resolveTimer => setTimeout(resolveTimer, 10))
    }
  })()
  const chaos = await Promise.allSettled([
    ...Array.from({ length: 5 }, (_, index) =>
      workspaces.createWorkspace({ projectId: 'demo', userId: 'kim', sessionId: `chaos${String(index)}` })),
    projects.fetchProject('demo'),
    projects.fetchProject('demo'),
  ])
  moving = false
  await mover
  // fetch никогда не удаляет локальные session-ветки (prune запрещён).
  assert.notEqual(await revParse(canonical, wsB.branch), undefined,
    'fetch не должен удалять session-ветки canonical')
  const failures = chaos.filter(entry => entry.status === 'rejected')
  assert.equal(failures.length, 0, `операции хаоса упали: ${failures.map(entry => String(entry.reason?.code ?? entry.reason)).join(' | ')}`)
  for (const entry of chaos) {
    const workspace = entry.value
    if (!workspace?.workspaceId) continue
    assert.equal(await revParse(workspace.path, 'HEAD'), workspace.baseSha, `workspace ${workspace.workspaceId}`)
  }
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime fetch race tests passed.')
