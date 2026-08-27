// Repository Intelligence: нормализованный Repository Profile проекта.
//
// Профиль строится из ЗАКОММИЧЕННОГО состояния (`git ls-tree` + `git show`
// по SHA), а не из рабочего дерева: он одинаков для всех сессий и не зависит
// от чьих-то незакоммиченных правок. Кэшируется по commit — пока ветка не
// сдвинулась, повторные запросы бесплатны.
//
// ГРАНИЦА ДОВЕРИЯ (docs/ai-quality.md): всё, что детекторы нашли в файлах
// репозитория, — ДАННЫЕ, не команды. Discovered-команда не выполняется, пока
// пользователь явно не одобрит её (approved) или не задаст свою в Quality
// Policy проекта (trusted). Команды существуют только как argv-массивы —
// shell-интерпретации нет нигде.

import { RuntimeError } from './errors.js'
import { CURRENT_SCHEMA_VERSION } from './migrations.js'
import { assertSegment } from './ids.js'
import { git, revParse } from './gitx.js'
import { appendAudit } from './audit.js'
import { matchesAny, normalizePath } from './globs.js'
import { stableHash } from './provenance.js'

const PROFILES = 'repo-profiles'
// Разумные потолки: профиль — карта, а не полная копия репозитория.
const MAX_TREE_FILES = 30_000
const MAX_POLICY_BYTES = 256 * 1024
const MAX_COMMAND_ARGV = 16
const MAX_COMMAND_LENGTH = 200

const LANGUAGE_BY_EXTENSION = new Map(Object.entries({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  py: 'python', go: 'go', rs: 'rust', swift: 'swift', rb: 'ruby',
  java: 'java', kt: 'kotlin', cs: 'csharp', php: 'php',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  sh: 'shell', bash: 'shell', zsh: 'shell',
}))

// Канонические id проверок, к которым слой качества умеет привязывать
// discovered-команды. Остальные скрипты профиль перечисляет как есть.
const CHECK_IDS = new Set(['test', 'lint', 'typecheck', 'build', 'format'])
const SCRIPT_TO_CHECK = new Map(Object.entries({
  test: 'test', lint: 'lint', typecheck: 'typecheck', 'type-check': 'typecheck',
  build: 'build', format: 'format', 'format:check': 'format', check: 'lint',
}))

export const DEFAULT_GENERATED_GLOBS = Object.freeze([
  'dist/**', 'generated/**', '**/*.generated.*', '**/*.min.js', '**/*.min.css',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'go.sum',
])

// --- CODEOWNERS -----------------------------------------------------------
// Минимальный парсер обычных паттернов (§31): комментарии, якоря `/`,
// basename-паттерны без слэша. Семантика GitHub: ПОСЛЕДНЕЕ совпавшее правило
// решает. Отрицаний в CODEOWNERS нет по спецификации.
export function parseCodeowners(text) {
  const rules = []
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const [rawPattern, ...owners] = line.split(/\s+/)
    if (!rawPattern || owners.length === 0) continue
    let pattern = rawPattern.replace(/^\//, '')
    // Паттерн без '/' в CODEOWNERS матчит basename на любой глубине.
    if (!pattern.includes('/')) pattern = `**/${pattern}`
    if (pattern.endsWith('/')) pattern = pattern.slice(0, -1)
    rules.push({ pattern, owners: owners.filter(owner => owner.length <= 100).slice(0, 20) })
  }
  return rules
}

export function ownersForFiles(rules, files) {
  const owners = new Set()
  for (const file of files) {
    // Последнее совпавшее правило побеждает — как в GitHub.
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      if (matchesAny(normalizePath(file), [rules[index].pattern])) {
        for (const owner of rules[index].owners) owners.add(owner)
        break
      }
    }
  }
  return [...owners].sort()
}

// --- Детекторы ------------------------------------------------------------
// Каждый детектор — чистая функция ({files, read}) → фрагмент профиля.
// files: массив путей дерева; read(path): содержимое файла или undefined.
// Новый стек = новый детектор в этом списке, ядро не меняется.

async function detectLanguages({ files }) {
  const counts = new Map()
  for (const file of files) {
    const extension = file.split('.').at(-1)?.toLowerCase()
    const language = extension ? LANGUAGE_BY_EXTENSION.get(extension) : undefined
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1)
  }
  return { languages: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name) }
}

async function detectPackageManagers({ files }) {
  const present = new Set(files)
  const managers = []
  if (present.has('pnpm-lock.yaml')) managers.push('pnpm')
  if (present.has('package-lock.json')) managers.push('npm')
  if (present.has('yarn.lock')) managers.push('yarn')
  if (present.has('package.json') && managers.length === 0) managers.push('npm')
  if (present.has('go.mod')) managers.push('go')
  if (present.has('Cargo.toml')) managers.push('cargo')
  if (present.has('pyproject.toml') || present.has('requirements.txt')) managers.push('pip')
  if (present.has('Gemfile')) managers.push('bundler')
  return { packageManagers: managers }
}

// definition — фактическое содержимое источника команды (§16): для script —
// его строка, для Makefile — тело таргета. Хэш определения делает одобрение
// привязанным к содержимому: подменили script — доверие сгорело.
function commandEntry(id, argv, source, definition) {
  return { id, argv, source, definitionHash: stableHash(definition ?? argv) }
}

async function detectCommands({ files, read }) {
  const present = new Set(files)
  const discovered = []
  if (present.has('package.json')) {
    const raw = await read('package.json')
    let scripts = {}
    try {
      scripts = JSON.parse(raw ?? '{}').scripts ?? {}
    } catch {
      // Битый package.json — не повод ронять профиль: просто без скриптов.
    }
    const runner = present.has('pnpm-lock.yaml') ? 'pnpm' : 'npm'
    for (const name of Object.keys(scripts)) {
      if (typeof scripts[name] !== 'string' || name.length > 60) continue
      const checkId = SCRIPT_TO_CHECK.get(name)
      // `npm test` — каноническая форма; остальное через `run`.
      const argv = name === 'test' ? [runner, 'test'] : [runner, 'run', name]
      discovered.push(commandEntry(checkId ?? `script:${name}`, argv, 'package.json', scripts[name]))
    }
  }
  if (present.has('Makefile')) {
    const makefile = String(await read('Makefile') ?? '')
    const targetMatches = [...makefile.matchAll(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/gm)]
    for (let index = 0; index < targetMatches.length; index += 1) {
      const match = targetMatches[index]
      const target = match[1]
      if (target === 'PHONY' || target.length > 60) continue
      const checkId = SCRIPT_TO_CHECK.get(target)
      // Тело таргета — до следующего таргета: его хэш и есть определение.
      const bodyEnd = index + 1 < targetMatches.length ? targetMatches[index + 1].index : makefile.length
      const definition = makefile.slice(match.index, bodyEnd).trim()
      discovered.push(commandEntry(checkId ?? `make:${target}`, ['make', target], 'Makefile', definition))
    }
  }
  if (present.has('go.mod')) discovered.push(commandEntry('test', ['go', 'test', './...'], 'go.mod'))
  if (present.has('Cargo.toml')) discovered.push(commandEntry('test', ['cargo', 'test'], 'Cargo.toml'))
  if (present.has('pytest.ini') || present.has('setup.cfg') || present.has('pyproject.toml')) {
    const pyproject = present.has('pyproject.toml') ? await read('pyproject.toml') : ''
    if (present.has('pytest.ini') || /\[tool\.pytest/.test(String(pyproject))) {
      discovered.push(commandEntry('test', ['pytest'], 'pytest'))
    }
  }
  // Один id может встретиться из нескольких источников — оставляем все,
  // одобрение идёт по точному argv, а не по id.
  return { commands: { discovered } }
}

async function detectPolicyAndDocs({ files }) {
  const wanted = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'README.md', 'SECURITY.md']
  const policyFiles = files.filter(file => wanted.includes(file))
  const codeownersPath = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'].find(path => files.includes(path))
  if (codeownersPath) policyFiles.push(codeownersPath)
  const architectureDocs = files.filter(file => /^(docs\/architecture[^/]*|ARCHITECTURE\.md)$/i.test(file))
  const adrDirs = [...new Set(files
    .map(file => /^((?:docs\/)?(?:adr|decisions)|architecture\/decisions|docs\/architecture\/decisions)\//i.exec(file)?.[1])
    .filter(Boolean))]
  const adrFiles = files.filter(file => adrDirs.some(dir => file.startsWith(`${dir}/`)) && /\.md$/i.test(file))
  return { policyFiles, codeownersPath, architectureDocs, adrDirs, adrFiles }
}

async function detectCi({ files }) {
  return { ciWorkflows: files.filter(file => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) }
}

async function detectGenerated({ files }) {
  return { generatedFiles: files.filter(file => matchesAny(file, DEFAULT_GENERATED_GLOBS)) }
}

async function detectOwners({ files, read }) {
  const path = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'].find(candidate => files.includes(candidate))
  if (!path) return { owners: { rules: [] } }
  return { owners: { rules: parseCodeowners((await read(path)) ?? '') } }
}

export const PROFILE_DETECTORS = [
  detectLanguages,
  detectPackageManagers,
  detectCommands,
  detectPolicyAndDocs,
  detectCi,
  detectGenerated,
  detectOwners,
]

// Чистая сборка профиля из списка файлов и функции чтения — тестируется без
// git вообще; git-обвязка ниже лишь поставляет files/read по commit.
export async function buildProfileFromTree({ files, read, detectors = PROFILE_DETECTORS }) {
  const profile = {}
  for (const detector of detectors) {
    Object.assign(profile, await detector({ files, read }))
  }
  return profile
}

// --- Команды: валидация и уровни доверия ----------------------------------

export function assertCommandArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > MAX_COMMAND_ARGV) {
    throw new RuntimeError('INVALID_INPUT', 'Команда должна быть argv-массивом из 1–16 элементов.')
  }
  for (const part of argv) {
    if (typeof part !== 'string' || part === '' || part.length > MAX_COMMAND_LENGTH || part.includes('\0')) {
      throw new RuntimeError('INVALID_INPUT', 'Каждый элемент argv — непустая строка до 200 символов.')
    }
  }
  return argv.map(String)
}

export function argvEquals(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((part, index) => part === b[index])
}

export function createRepoIntel({ store, roots, projects }) {
  async function readTree(repoPath, sha) {
    const { stdout } = await git(['-C', repoPath, 'ls-tree', '-r', '--name-only', sha])
    const files = stdout.split('\n').filter(Boolean).map(normalizePath)
    const truncated = files.length > MAX_TREE_FILES
    return { files: truncated ? files.slice(0, MAX_TREE_FILES) : files, truncated }
  }

  function makeRead(repoPath, sha) {
    return async path => {
      const result = await git(['-C', repoPath, 'show', `${sha}:${path}`], { allowFailure: true })
      if (result.failed) return undefined
      const text = String(result.stdout ?? '')
      return text.length > MAX_POLICY_BYTES ? text.slice(0, MAX_POLICY_BYTES) : text
    }
  }

  // Профиль по commit ветки по умолчанию; refresh пересобирает принудительно.
  async function getProfile(projectId, { ref, refresh = false } = {}) {
    const project = await projects.get(assertSegment(projectId, 'projectId'))
    const target = typeof ref === 'string' && ref !== '' ? ref : project.defaultBranch
    const sha = await revParse(project.canonicalRepoPath, target)
    if (!sha) throw new RuntimeError('INVALID_INPUT', `Ветка «${target}» не найдена в проекте.`, { ref: target })
    const cached = await store.read(PROFILES, projectId)
    if (cached && cached.commit === sha && !refresh) return cached
    const { files, truncated } = await readTree(project.canonicalRepoPath, sha)
    const profile = await buildProfileFromTree({ files, read: makeRead(project.canonicalRepoPath, sha) })
    const record = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectId,
      commit: sha,
      ref: target,
      builtAt: new Date().toISOString(),
      fileCount: files.length,
      ...(truncated ? { truncated: true } : {}),
      ...profile,
    }
    await store.write(PROFILES, projectId, record)
    await appendAudit(roots.stateRoot, 'repo.profile.built', { projectId, commit: sha, files: files.length })
    return record
  }

  // Явное одобрение discovered-команды пользователем. Одобряется ТОЧНЫЙ argv:
  // смена команды в репозитории сбрасывает доверие сама собой.
  async function approveCommands(projectId, commands) {
    const project = await projects.get(projectId)
    if (!Array.isArray(commands) || commands.length === 0) {
      throw new RuntimeError('INVALID_INPUT', 'Ожидался непустой список команд для одобрения.')
    }
    // Одобряется КОНКРЕТНОЕ определение (§16): argv должен существовать в
    // текущем профиле, и вместе с ним фиксируется definitionHash источника.
    const profile = await getProfile(projectId)
    const approved = [...(project.approvedCommands ?? [])]
    for (const command of commands) {
      const id = typeof command?.id === 'string' && command.id !== '' ? command.id.slice(0, 60) : 'command'
      const argv = assertCommandArgv(command?.argv)
      const discovered = (profile.commands?.discovered ?? []).find(entry => argvEquals(entry.argv, argv))
      if (!discovered) {
        throw new RuntimeError('INVALID_INPUT', `Команда «${argv.join(' ')}» не найдена среди discovered текущего профиля — одобрять нечего.`, { argv })
      }
      if (!approved.some(entry => argvEquals(entry.argv, argv) && entry.definitionHash === discovered.definitionHash)) {
        approved.push({ id, argv, definitionHash: discovered.definitionHash, sourceFile: discovered.source, sourceCommit: profile.commit })
      }
    }
    if (approved.length > 50) {
      throw new RuntimeError('LIMIT_EXCEEDED', 'Слишком много одобренных команд (максимум 50).')
    }
    const updated = { ...project, approvedCommands: approved }
    await store.write('projects', projectId, updated)
    await appendAudit(roots.stateRoot, 'repo.commands.approved', { projectId, count: approved.length })
    return approved
  }

  // Итоговый набор исполняемых команд: trusted-policy проекта + одобренные.
  // Discovered БЕЗ одобрения сюда не попадает никогда, а одобрение живо
  // только пока СОДЕРЖИМОЕ определения не изменилось (§16): без профиля или
  // при несовпадении definitionHash approved-команда снова лишь discovered.
  function trustedCommands(project, profile) {
    const commands = []
    const policyChecks = project.qualityPolicy?.checks ?? {}
    for (const [id, check] of Object.entries(policyChecks)) {
      if (Array.isArray(check?.argv)) commands.push({ id, argv: check.argv, trust: 'trusted' })
    }
    const discoveredNow = profile?.commands?.discovered ?? []
    for (const entry of project.approvedCommands ?? []) {
      const stillMatches = discoveredNow.some(candidate =>
        argvEquals(candidate.argv, entry.argv) && candidate.definitionHash === entry.definitionHash)
      if (stillMatches && !commands.some(command => argvEquals(command.argv, entry.argv))) {
        commands.push({ id: entry.id, argv: entry.argv, trust: 'approved' })
      }
    }
    return commands
  }

  return { getProfile, approveCommands, trustedCommands, checkIds: CHECK_IDS }
}
