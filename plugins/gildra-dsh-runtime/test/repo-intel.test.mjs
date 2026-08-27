// Repository Intelligence (§3, §4, §31, §35, §38 плана AI-качества).
//
// Доказываемые инварианты:
//   1. glob-семантика едина и предсказуема (матрица);
//   2. профиль JS-проекта находит языки, менеджеры, команды, policy, CI,
//      generated и ADR — из ЗАКОММИЧЕННОГО состояния, а не рабочего дерева;
//   3. Go/Python-фикстура доказывает, что детекторы не прибиты к npm;
//   4. CODEOWNERS: обычные паттерны и «последнее правило побеждает»;
//   5. discovered-команды НЕ исполняемы, пока их явно не одобрили; policy
//      проекта — trusted; одобрение привязано к точному argv;
//   6. кэш профиля привязан к commit: новый коммит → новый профиль.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { globsIntersect, literalPrefix, matchesAny, matchesGlob } from '../lib/globs.js'
import {
  argvEquals,
  assertCommandArgv,
  buildProfileFromTree,
  createRepoIntel,
  ownersForFiles,
  parseCodeowners,
} from '../lib/repo-intel.js'
import { commitAll, git } from '../lib/gitx.js'
import { runtimeRoots } from '../lib/paths.js'
import { JsonStore } from '../lib/store.js'
import { createProjectRegistry } from '../lib/projects.js'

// --- 1. Матрица glob-семантики --------------------------------------------
{
  const cases = [
    ['src/auth/token.js', 'src/auth/**', true],
    ['src/auth', 'src/auth/**', true],
    ['src/authx/token.js', 'src/auth/**', false],
    ['src/auth/token.js', 'src/**', true],
    ['other/file.js', 'src/**', false],
    ['a/b/x.test.mjs', '**/*.test.mjs', true],
    ['x.test.mjs', '**/*.test.mjs', true],
    ['a/b/x.test.mjs.bak', '**/*.test.mjs', false],
    ['docs/adr/0001-store.md', 'docs/adr', true],
    ['docs/adr', 'docs/adr', true],
    ['docs/adrx/0001.md', 'docs/adr', false],
    ['src/a/b/c.js', 'src/*', true], // семантика gitignore: каталог покрывает потомков
    ['deep/path/file.txt', '**', true],
    ['src/x.js', 'src/**/x.js', true], // `**` покрывает и ноль сегментов
    ['src/a/b/x.js', 'src/**/x.js', true],
    ['windows\\style\\path.js', 'windows/style/**', true],
    ['file.js', '', false],
  ]
  for (const [path, pattern, expected] of cases) {
    assert.equal(matchesGlob(path, pattern), expected, `${path} vs ${pattern} → ожидалось ${String(expected)}`)
  }
  assert.equal(matchesAny('a/b.js', ['x/**', 'a/**']), true)
  assert.equal(matchesAny('a/b.js', []), false)

  assert.equal(literalPrefix('src/auth/**'), 'src/auth')
  assert.equal(literalPrefix('**/*.js'), '')
  assert.equal(globsIntersect('src/auth/**', 'src/auth/token.js'), true)
  assert.equal(globsIntersect('src/auth/**', 'src/session/**'), false)
  assert.equal(globsIntersect('**/*.js', 'src/**'), true, 'двойной wildcard консервативно пересекается')
}

// --- 2. CODEOWNERS: обычные паттерны, последний матч побеждает ------------
{
  const rules = parseCodeowners([
    '# комментарий',
    '*       @org/default-team',
    '*.js    @js-guild',
    'docs/** @writers',
    '/install/ @release-eng @alex',
    'docs/security.md @security',
  ].join('\n'))
  assert.equal(rules.length, 5)
  assert.deepEqual(ownersForFiles(rules, ['src/app.js']), ['@js-guild'])
  assert.deepEqual(ownersForFiles(rules, ['docs/guide.md']), ['@writers'])
  // Последнее правило перекрывает более общее docs/**.
  assert.deepEqual(ownersForFiles(rules, ['docs/security.md']), ['@security'])
  assert.deepEqual(ownersForFiles(rules, ['install/setup.sh']), ['@alex', '@release-eng'])
  assert.deepEqual(ownersForFiles(rules, ['README.txt']), ['@org/default-team'])
  assert.deepEqual(ownersForFiles(rules, ['src/app.js', 'docs/guide.md']).sort(), ['@js-guild', '@writers'])
}

// --- 3. Чистая сборка профиля: Go/Python-фикстура без git -----------------
{
  const files = ['go.mod', 'main.go', 'pyproject.toml', 'tool/check.py', 'Makefile']
  const contents = new Map([
    ['Makefile', 'test:\n\tgo test ./...\n\nlint:\n\tgolangci-lint run\n\n.PHONY: test lint\n'],
    ['pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tool"]\n'],
  ])
  const profile = await buildProfileFromTree({ files, read: async path => contents.get(path) })
  assert.deepEqual(profile.languages.slice(0, 2).sort(), ['go', 'python'])
  assert.ok(profile.packageManagers.includes('go'))
  assert.ok(profile.packageManagers.includes('pip'))
  const ids = profile.commands.discovered.map(command => `${command.id}@${command.source}`)
  assert.ok(ids.includes('test@go.mod'), 'go test ./... должен быть обнаружен')
  assert.ok(ids.includes('test@Makefile'), 'make test должен быть обнаружен')
  assert.ok(ids.includes('lint@Makefile'))
  assert.ok(ids.includes('test@pytest'), 'pytest из pyproject должен быть обнаружен')
  const makeTest = profile.commands.discovered.find(command => command.source === 'Makefile' && command.id === 'test')
  assert.deepEqual(makeTest.argv, ['make', 'test'], 'команды — argv-массивы, не shell-строки')
}

// --- Git-фикстура: JS-проект ----------------------------------------------
const base = await mkdtemp(join(tmpdir(), 'gildra repo intel '))
const repo = join(base, 'js project')
await git(['init', '-b', 'main', repo])
await git(['-C', repo, 'config', 'core.autocrlf', 'false'])
await mkdir(join(repo, '.github', 'workflows'), { recursive: true })
await mkdir(join(repo, 'docs', 'adr'), { recursive: true })
await mkdir(join(repo, 'src'), { recursive: true })
await mkdir(join(repo, 'dist'), { recursive: true })
await writeFile(join(repo, 'package.json'), JSON.stringify({
  name: 'fixture', scripts: { test: 'node test.mjs', lint: 'eslint .', build: 'node build.mjs', dev: 'node dev.mjs' },
}, null, 2))
await writeFile(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
await writeFile(join(repo, 'AGENTS.md'), '# Правила агентов\n')
await writeFile(join(repo, 'CONTRIBUTING.md'), '# Как участвовать\n')
await writeFile(join(repo, '.github', 'CODEOWNERS'), 'src/** @backend\ndocs/** @writers\n')
await writeFile(join(repo, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
await writeFile(join(repo, 'docs', 'architecture.md'), '# Архитектура\n')
await writeFile(join(repo, 'docs', 'adr', '0001-json-store.md'), '# ADR-1\n')
await writeFile(join(repo, 'src', 'app.js'), 'export const app = 1\n')
await writeFile(join(repo, 'dist', 'bundle.min.js'), 'generated\n')
await commitAll(repo, 'fixture', { name: 'Seed', email: 'seed@test' })

const roots = runtimeRoots({ GILDRA_DSH_STATE_DIR: join(base, 'state') })
const store = new JsonStore(roots.stateRoot)
await store.ensureRoot()
const projects = createProjectRegistry({ store, roots })
await projects.register({ projectId: 'demo', path: repo })
const intel = createRepoIntel({ store, roots, projects })

// --- 4. Профиль из закоммиченного состояния -------------------------------
{
  // Незакоммиченный файл НЕ должен попасть в профиль — профиль читает tree.
  await writeFile(join(repo, 'uncommitted.py'), 'print(1)\n')
  const profile = await intel.getProfile('demo')
  assert.equal(profile.languages[0], 'javascript')
  assert.ok(!profile.languages.includes('python'), 'незакоммиченный файл не должен влиять на профиль')
  assert.deepEqual(profile.packageManagers, ['pnpm'])
  assert.ok(profile.policyFiles.includes('AGENTS.md'))
  assert.ok(profile.policyFiles.includes('.github/CODEOWNERS'))
  assert.deepEqual(profile.ciWorkflows, ['.github/workflows/ci.yml'])
  assert.deepEqual(profile.architectureDocs, ['docs/architecture.md'])
  assert.deepEqual(profile.adrFiles, ['docs/adr/0001-json-store.md'])
  assert.ok(profile.generatedFiles.includes('dist/bundle.min.js'))
  assert.ok(profile.generatedFiles.includes('pnpm-lock.yaml'))

  const test = profile.commands.discovered.find(command => command.id === 'test')
  assert.deepEqual(test.argv, ['pnpm', 'test'], 'runner выбран по lock-файлу (pnpm)')
  const lint = profile.commands.discovered.find(command => command.id === 'lint')
  assert.deepEqual(lint.argv, ['pnpm', 'run', 'lint'])
  assert.ok(profile.commands.discovered.some(command => command.id === 'script:dev'),
    'неканонические скрипты перечисляются, но не становятся проверками')

  // Кэш по commit: повторный вызов возвращает тот же профиль.
  const again = await intel.getProfile('demo')
  assert.equal(again.builtAt, profile.builtAt, 'профиль должен браться из кэша по commit')

  // Новый коммит инвалидирует кэш.
  await writeFile(join(repo, 'src', 'extra.ts'), 'export {}\n')
  await commitAll(repo, 'add ts', { name: 'Seed', email: 'seed@test' })
  const rebuilt = await intel.getProfile('demo')
  assert.notEqual(rebuilt.commit, profile.commit)
  assert.ok(rebuilt.languages.includes('typescript'))
}

// --- 5. Уровни доверия команд ---------------------------------------------
{
  const project = await projects.get('demo')
  const profile = await intel.getProfile('demo')
  // Discovered ≠ исполняемо: без policy и одобрений trusted-набор пуст.
  assert.deepEqual(intel.trustedCommands(project, profile), [],
    'discovered-команды не должны быть исполняемыми без явного одобрения')

  // §8: без HUMAN_ADMIN одобрение невозможно — writer не делает discovered
  // исполняемым сам.
  await assert.rejects(intel.approveCommands('demo', [{ id: 'test', argv: ['pnpm', 'test'] }]),
    error => error.code === 'CAPABILITY_REQUIRED')
  const asAdmin = { verifiedAdmin: { actorId: 'test-admin' } }
  // Одобрить можно только существующую discovered-команду (§16).
  await assert.rejects(intel.approveCommands('demo', [{ id: 'ghost', argv: ['make', 'ghost'] }], asAdmin),
    /не найдена среди discovered/)

  // Одобрение фиксирует definitionHash источника.
  await intel.approveCommands('demo', [{ id: 'test', argv: ['pnpm', 'test'] }], asAdmin)
  const approvedEntry = (await projects.get('demo')).approvedCommands[0]
  assert.equal(typeof approvedEntry.definitionHash, 'string')
  assert.equal(approvedEntry.sourceFile, 'package.json')
  assert.equal(approvedEntry.sourceCommit, profile.commit)
  assert.equal(approvedEntry.approvedBy, 'test-admin')
  const afterApprove = intel.trustedCommands(await projects.get('demo'), profile)
  assert.equal(afterApprove.length, 1)
  assert.equal(afterApprove[0].trust, 'approved')
  assert.deepEqual(afterApprove[0].argv, ['pnpm', 'test'])

  // §16: подмена СОДЕРЖИМОГО script при том же argv сжигает доверие.
  const pkg = JSON.parse(await (async () => (await import('node:fs/promises')).readFile(join(repo, 'package.json'), 'utf8'))())
  pkg.scripts.test = 'node totally-different.mjs'
  await writeFile(join(repo, 'package.json'), JSON.stringify(pkg, null, 2))
  await commitAll(repo, 'swap test script', { name: 'Seed', email: 'seed@test' })
  const swappedProfile = await intel.getProfile('demo')
  const afterSwap = intel.trustedCommands(await projects.get('demo'), swappedProfile)
  assert.deepEqual(afterSwap, [],
    'изменённое определение команды обязано вернуть её в discovered')
  // Повторное одобрение нового определения восстанавливает доверие.
  await intel.approveCommands('demo', [{ id: 'test', argv: ['pnpm', 'test'] }], asAdmin)
  assert.equal(intel.trustedCommands(await projects.get('demo'), swappedProfile).length, 1)

  // Без профиля approved-команды не считаются исполняемыми (нечем сверить).
  assert.deepEqual(intel.trustedCommands(await projects.get('demo')), [])

  // Policy проекта — trusted и имеет приоритет при совпадении argv.
  const withPolicy = { ...(await projects.get('demo')), qualityPolicy: { checks: { lint: { argv: ['pnpm', 'run', 'lint'] } } } }
  await store.write('projects', 'demo', withPolicy)
  const combined = intel.trustedCommands(await projects.get('demo'), swappedProfile)
  assert.equal(combined.length, 2)
  assert.equal(combined.find(command => command.id === 'lint').trust, 'trusted')

  // Валидация argv: shell-строки и мусор отклоняются.
  assert.throws(() => assertCommandArgv('npm test'), /argv-массивом/)
  assert.throws(() => assertCommandArgv([]), /argv-массивом/)
  assert.throws(() => assertCommandArgv(['ok', '']), /непустая строка/)
  assert.throws(() => assertCommandArgv(['a\0b']), /непустая строка/)
  assert.equal(argvEquals(['a', 'b'], ['a', 'b']), true)
  assert.equal(argvEquals(['a'], ['a', 'b']), false)
}

await rm(base, { recursive: true, force: true })
console.log('Gildra Runtime repository intelligence tests passed.')
