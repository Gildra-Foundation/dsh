// Diff Analyzer: структурный не-LLM разбор изменений задачи (§19–§22, §36–§38).
//
// Анализируются ТОЛЬКО сами изменения (git diff baseSha..HEAD): добавленные
// строки — на опасные паттерны и подавление проверок, изменённые файлы — на
// scope/protected/generated/зависимости, тестовые файлы — на ослабление.
// Это reviewer-сигналы, а не универсальный security-сканер: их назначение —
// потребовать объяснения, а не вынести вердикт. Каждый сигнал либо
// устраняется, либо явно объясняется (tasks.acknowledgeSignal) — молча не
// гаснет ни один (quality.readiness).

import { RuntimeError } from './errors.js'
import { git, revParse } from './gitx.js'
import { matchesAny, normalizePath } from './globs.js'
import { extractImports } from './claims.js'

const MAX_FILES = 500
const MAX_DIFF_BYTES = 4 * 1024 * 1024

// Опасные паттерны (§20) — расширяемый список, применяется к ДОБАВЛЕННЫМ
// строкам. Ложные срабатывания допустимы: это повод объясниться, а не блок.
export const DANGEROUS_PATTERNS = Object.freeze([
  { id: 'shell-true', pattern: /shell:\s*true/, message: 'spawn с shell: true' },
  { id: 'chmod-777', pattern: /chmod\s+(-R\s+)?0?777/, message: 'chmod 777' },
  { id: 'ssh-hostkey-off', pattern: /StrictHostKeyChecking[=\s]+no/i, message: 'отключена проверка SSH host key' },
  { id: 'tls-insecure', pattern: /rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*False|InsecureSkipVerify:\s*true|--insecure\b|-k\s+https/, message: 'ослаблена проверка TLS' },
  { id: 'git-no-verify', pattern: /git\s+[a-z-]*\s*--no-verify/, message: 'git --no-verify обходит hooks' },
  { id: 'curl-pipe-sh', pattern: /curl[^\n|]*\|\s*(ba|z)?sh/, message: 'curl | sh' },
  { id: 'empty-catch', pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/, message: 'пустой catch проглатывает ошибку' },
  { id: 'security-todo', pattern: /TODO[^\n]{0,60}(security|bypass|временно отключ)/i, message: 'временный security-обход по TODO' },
])

// Подавление проверок (§19): добавленные строки, выключающие линт/типы/тесты.
const SUPPRESSION_PATTERNS = Object.freeze([
  { id: 'eslint-disable', pattern: /eslint-disable/ },
  { id: 'ts-ignore', pattern: /@ts-ignore|@ts-nocheck/ },
  { id: 'test-only', pattern: /\.only\s*\(|fdescribe\s*\(|fit\s*\(/ },
  { id: 'test-skip', pattern: /\.skip\s*\(|xdescribe\s*\(|xit\s*\(|t\.skip\b|pytest\.mark\.skip/ },
  { id: 'coverage-off', pattern: /istanbul ignore|c8 ignore|coverage:\s*false/ },
])

// Встроенные high-risk области (§17): категории, где цена дефекта — потеря
// данных или дыра. Проект расширяет список через policy.highRiskAreas.
export const DEFAULT_HIGH_RISK_GLOBS = Object.freeze([
  'install/**', 'installer/**', '.github/workflows/**', 'migrations/**',
  // *auth* ловит и каталог auth/, и файлы вида auth.js / oauth.ts: имя —
  // сильный маркер зоны, где дефект означает дыру, а не баг.
  '**/*auth*', '**/security/**', '**/*lease*', '**/*lock*', '**/gitx*',
  '**/updater*', '**/update*.ps1', 'scripts/*update*',
])

const MANIFEST_FILES = Object.freeze([
  'package.json', 'go.mod', 'Cargo.toml', 'requirements.txt', 'pyproject.toml', 'Gemfile', 'composer.json',
])
const LOCKFILES = Object.freeze([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'go.sum', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'composer.lock',
])

export function isTestPath(path) {
  const normalized = normalizePath(path)
  return /(^|\/)(tests?|__tests__|spec)\//.test(normalized)
    || /\.(test|spec)\.[a-z]+$/.test(normalized)
    || /_test\.[a-z]+$/.test(normalized)
}

// Сравнение секций зависимостей двух package.json.
export function dependencyDelta(beforeRaw, afterRaw) {
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  let before = {}
  let after = {}
  try { before = JSON.parse(beforeRaw ?? '{}') } catch { /* был битый — считаем пустым */ }
  try { after = JSON.parse(afterRaw ?? '{}') } catch { /* стал битым — diff покажет само изменение */ }
  const added = []
  const removed = []
  const changed = []
  for (const section of sections) {
    const olds = before[section] ?? {}
    const news = after[section] ?? {}
    for (const name of Object.keys(news)) {
      if (!(name in olds)) added.push({ name, section, version: String(news[name]) })
      else if (olds[name] !== news[name]) changed.push({ name, section, from: String(olds[name]), to: String(news[name]) })
    }
    for (const name of Object.keys(olds)) {
      if (!(name in news)) removed.push({ name, section })
    }
  }
  return { added, removed, changed }
}

export async function analyzeTaskDiff({ workspacePath, baseSha, task, policy, profile }) {
  const headSha = await revParse(workspacePath, 'HEAD')
  if (!headSha) throw new RuntimeError('GIT_FAILED', 'Не удалось определить HEAD workspace.')
  if (!baseSha) throw new RuntimeError('INVALID_INPUT', 'У задачи нет baseSha — нечем ограничить diff.')

  // Файлы и статистика.
  const nameStatus = await git(['-C', workspacePath, 'diff', '--no-ext-diff', '--name-status', '-M', `${baseSha}..HEAD`])
  const numstat = await git(['-C', workspacePath, 'diff', '--no-ext-diff', '--numstat', `${baseSha}..HEAD`])
  const statByPath = new Map()
  for (const line of numstat.stdout.split('\n').filter(Boolean)) {
    const [ins, del, ...rest] = line.split('\t')
    statByPath.set(normalizePath(rest.join('\t')), {
      insertions: ins === '-' ? 0 : Number(ins),
      deletions: del === '-' ? 0 : Number(del),
    })
  }
  const files = []
  for (const line of nameStatus.stdout.split('\n').filter(Boolean)) {
    const [status, ...rest] = line.split('\t')
    const path = normalizePath(rest.at(-1))
    files.push({ path, status: status[0], ...(statByPath.get(path) ?? { insertions: 0, deletions: 0 }) })
  }
  const truncated = files.length > MAX_FILES
  const kept = truncated ? files.slice(0, MAX_FILES) : files
  const changedPaths = kept.map(file => file.path)

  // Полный текст diff — для построчных сигналов; огромный diff честно
  // помечается усечённым, а не анализируется наполовину молча.
  // --no-ext-diff/--no-textconv: содержимое диффа обязано приходить от самого
  // git, а не от внешнего драйвера из пользовательского или repo-конфига —
  // и ради воспроизводимости анализа, и чтобы не исполнять чужую команду.
  const diffText = await git(['-C', workspacePath, 'diff', '--no-ext-diff', '--no-textconv', '--unified=0', `${baseSha}..HEAD`])
  const diffTruncated = diffText.stdout.length > MAX_DIFF_BYTES
  const scanText = diffTruncated ? diffText.stdout.slice(0, MAX_DIFF_BYTES) : diffText.stdout

  // Построчный проход: собираем добавленные/удалённые строки по файлам.
  const addedByFile = new Map()
  const removedByFile = new Map()
  let currentFile
  for (const line of scanText.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = normalizePath(line.slice(6))
      continue
    }
    if (!currentFile || line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) {
      addedByFile.set(currentFile, [...(addedByFile.get(currentFile) ?? []), line.slice(1)])
    } else if (line.startsWith('-')) {
      removedByFile.set(currentFile, [...(removedByFile.get(currentFile) ?? []), line.slice(1)])
    }
  }

  const signals = []
  const note = (kind, detail) => signals.push({ kind, detail })

  // --- Опасные паттерны и подавление проверок (§19, §20) ------------------
  const dangerous = []
  const suppressions = []
  for (const [file, lines] of addedByFile) {
    for (const line of lines) {
      for (const rule of DANGEROUS_PATTERNS) {
        if (rule.pattern.test(line)) dangerous.push({ id: rule.id, file, message: rule.message })
      }
      for (const rule of SUPPRESSION_PATTERNS) {
        if (rule.pattern.test(line)) suppressions.push({ id: rule.id, file })
      }
    }
  }

  // --- Ослабление тестов (§19) ---------------------------------------------
  const testFiles = kept.filter(file => isTestPath(file.path))
  const removedTestFiles = testFiles.filter(file => file.status === 'D').map(file => file.path)
  const assertPattern = /\bassert\b|\bexpect\s*\(|\.rejects\b|\.throws\b/
  let assertsAdded = 0
  let assertsRemoved = 0
  for (const file of testFiles) {
    for (const line of addedByFile.get(file.path) ?? []) if (assertPattern.test(line)) assertsAdded += 1
    for (const line of removedByFile.get(file.path) ?? []) if (assertPattern.test(line)) assertsRemoved += 1
  }
  const weakening = []
  if (removedTestFiles.length > 0) weakening.push({ id: 'test-file-removed', files: removedTestFiles })
  if (assertsRemoved > assertsAdded) weakening.push({ id: 'assertions-lost', removed: assertsRemoved, added: assertsAdded })
  for (const suppression of suppressions) {
    if (suppression.id === 'test-only' || suppression.id === 'test-skip' || isTestPath(suppression.file)) {
      weakening.push({ id: suppression.id, file: suppression.file })
    }
  }
  if (weakening.length > 0) note('TEST_WEAKENING', { weakening })
  const nonTestSuppressions = suppressions.filter(entry => !isTestPath(entry.file) && entry.id !== 'test-only' && entry.id !== 'test-skip')
  if (nonTestSuppressions.length > 0) note('TEST_WEAKENING', { suppressions: nonTestSuppressions })

  // --- Зависимости (§21) ----------------------------------------------------
  const manifests = changedPaths.filter(path => MANIFEST_FILES.includes(path))
  const lockfiles = changedPaths.filter(path => LOCKFILES.includes(path))
  let dependencyDetails
  if (manifests.includes('package.json')) {
    const before = await git(['-C', workspacePath, 'show', `${baseSha}:package.json`], { allowFailure: true })
    const after = await git(['-C', workspacePath, 'show', 'HEAD:package.json'], { allowFailure: true })
    dependencyDetails = dependencyDelta(before.failed ? '{}' : before.stdout, after.failed ? '{}' : after.stdout)
  }
  const dependencyChanged = manifests.length > 0
    ? (dependencyDetails
      ? dependencyDetails.added.length + dependencyDetails.removed.length + dependencyDetails.changed.length > 0
      : true)
    : lockfiles.length > 0
  if (dependencyChanged) {
    note('DEPENDENCY_CHANGE', { manifests, lockfiles, ...(dependencyDetails ?? {}) })
  }

  // --- Scope (§10, §37) -----------------------------------------------------
  const expectedAreas = task?.expectedAreas ?? []
  const unexpectedFiles = expectedAreas.length > 0
    ? changedPaths.filter(path => !matchesAny(path, expectedAreas))
    : []
  if (unexpectedFiles.length > 0) note('UNEXPECTED_CHANGE', { files: unexpectedFiles.slice(0, 50) })

  // --- Protected / generated / policy (§12, §38) ---------------------------
  const protectedAreas = policy?.protectedAreas ?? []
  const protectedTouched = changedPaths.filter(path => matchesAny(path, protectedAreas))
  if (protectedTouched.length > 0) note('PROTECTED_AREA_CHANGE', { files: protectedTouched })

  const generatedKnown = new Set(profile?.generatedFiles ?? [])
  const generatedGlobs = policy?.generatedFiles ?? []
  const generatedTouched = changedPaths.filter(path => generatedKnown.has(path) || matchesAny(path, generatedGlobs))
  if (generatedTouched.length > 0) note('GENERATED_FILE_EDIT', { files: generatedTouched })

  const policyTouched = changedPaths.filter(path => (profile?.policyFiles ?? []).includes(path))

  // --- Публичная поверхность (MVP для JS, §22) -----------------------------
  const exportTouched = []
  for (const [file, lines] of removedByFile) {
    if (isTestPath(file) || !/\.(mjs|cjs|jsx?|tsx?)$/.test(file)) continue
    if (lines.some(line => /^\s*export\s/.test(line))) exportTouched.push(file)
  }
  if (exportTouched.length > 0) note('BACKWARD_COMPATIBILITY', { files: exportTouched })

  // --- High-risk (§17) ------------------------------------------------------
  const riskGlobs = [...DEFAULT_HIGH_RISK_GLOBS, ...(policy?.highRiskAreas ?? [])]
  const riskFiles = changedPaths.filter(path => matchesAny(path, riskGlobs))
  const highRisk = riskFiles.length > 0 || dangerous.length > 0

  // --- Импорты изменённых JS-файлов (для claims/upstream, §28) -------------
  const importsOfChanged = {}
  for (const file of changedPaths.filter(path => /\.(mjs|cjs|jsx?|tsx?)$/.test(path)).slice(0, 100)) {
    const shown = await git(['-C', workspacePath, 'show', `HEAD:${file}`], { allowFailure: true })
    if (!shown.failed) {
      const imports = extractImports(shown.stdout)
      if (imports.length > 0) importsOfChanged[file] = imports
    }
  }

  return {
    baseSha,
    headSha,
    filesChanged: files.length,
    insertions: kept.reduce((sum, file) => sum + file.insertions, 0),
    deletions: kept.reduce((sum, file) => sum + file.deletions, 0),
    files: kept,
    ...(truncated || diffTruncated ? { truncated: true } : {}),
    newFiles: kept.filter(file => file.status === 'A').map(file => file.path),
    deletedFiles: kept.filter(file => file.status === 'D').map(file => file.path),
    dependencies: { changed: dependencyChanged, manifests, lockfiles, ...(dependencyDetails ? { details: dependencyDetails } : {}) },
    tests: { changedTestFiles: testFiles.map(file => file.path), removedTestFiles, assertsAdded, assertsRemoved, weakening },
    dangerous,
    scope: { expectedAreas, unexpectedFiles },
    protectedTouched,
    generatedTouched,
    policyTouched,
    riskFiles,
    highRisk,
    importsOfChanged,
    signals,
    // Map добавленных/удалённых строк по файлам — сырьё для Modularity
    // Analyzer; в durable-сводку задачи не попадает.
    addedByFile,
    removedByFile,
    analyzedAt: new Date().toISOString(),
  }
}
