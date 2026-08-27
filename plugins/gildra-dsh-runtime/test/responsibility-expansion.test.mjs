// RESPONSIBILITY_EXPANSION (§17, §24): до/после по side-effect поверхностям.
//
//   1. domain-модуль обзавёлся network+filesystem → сигнал с before/after;
//   2. файл, у которого поверхности были и остались, — не сигнал;
//   3. это REVIEW (gate WARNING), не автоматическая ошибка любого node:fs.

import assert from 'node:assert/strict'

import { analyzeModularity } from '../lib/modularity.js'

function tree(files) {
  return { files: Object.keys(files), read: async path => files[path] }
}

async function run({ before, after, changed, added = {}, removed = {}, architecture, modulePlan }) {
  const beforeTree = tree(before)
  const afterTree = tree(after)
  return analyzeModularity({
    filesBefore: beforeTree.files,
    readBefore: beforeTree.read,
    filesAfter: afterTree.files,
    readAfter: afterTree.read,
    changedFiles: changed,
    addedByFile: new Map(Object.entries(added)),
    removedByFile: new Map(Object.entries(removed)),
    architecture,
    modulePlan,
  })
}
const codesOf = result => result.signals.map(signal => signal.code)
const checkOf = (result, id) => result.checks.find(check => check.id === id)

{
  const before = { 'src/domain/pricing.js': 'export const price = value => value * 2\n' }
  const after = {
    'src/domain/pricing.js': [
      "import { readFileSync } from 'node:fs'",
      "import { request } from 'node:https'",
      'export const price = value => value * 2',
      'export const audit = () => request(readFileSync("prices.json"))',
      '',
    ].join('\n'),
  }
  const result = await run({ before, after, changed: ['src/domain/pricing.js'] })
  const signal = result.signals.find(entry => entry.code === 'RESPONSIBILITY_EXPANSION')
  assert.ok(signal, `расширение ответственности обязано быть видно: ${codesOf(result).join(',')}`)
  assert.deepEqual(signal.detail.before, [])
  assert.deepEqual(signal.detail.gained.sort(), ['fs', 'network'])
  assert.equal(checkOf(result, 'module-scope').status, 'WARNING', 'REVIEW-сигнал')
}

{
  // Поверхности были и остались — не «расширение».
  const io = "import { readFileSync } from 'node:fs'\nexport const load = () => readFileSync('x')\n"
  const result = await run({ before: { 'src/io.js': io }, after: { 'src/io.js': io + 'export const loadTwice = () => load()\n' }, changed: ['src/io.js'] })
  assert.ok(!codesOf(result).includes('RESPONSIBILITY_EXPANSION'),
    'существующая поверхность — не новое расширение ответственности')
}

console.log('Gildra Runtime RESPONSIBILITY_EXPANSION tests passed.')
