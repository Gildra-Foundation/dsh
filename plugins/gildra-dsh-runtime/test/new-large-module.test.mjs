// NEW_LARGE_MODULE (§16, §24): композит метрик, а не количество строк.
//
//   1. новый файл-комбайн (много функций, exports, side-effects, fan-out) —
//      сигнал REVIEW (gate WARNING, не FAILED);
//   2. новый 700-строчный декларативный словарь — НЕ сигнал;
//   3. большой файл с функциями, но без exports/side-effects/fan-out —
//      не дотягивает до композита и не шумит.

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

function combineFile() {
  const functions = Array.from({ length: 24 }, (_, index) => [
    `export function handler${String(index)}(input) {`,
    ...Array.from({ length: 14 }, (_, line) => `  step${String(line)}(input)`),
    '}',
  ].join('\n')).join('\n')
  return [
    "import { readFileSync } from 'node:fs'",
    "import { request } from 'node:https'",
    "import { helperA } from './deps/a.js'",
    "import { helperB } from './deps/b.js'",
    functions,
    'export const registry = [helperA, helperB, readFileSync, request]',
    '',
  ].join('\n')
}

// --- 1. Новый God-файл ------------------------------------------------------
{
  const after = {
    'src/combine.js': combineFile(),
    'src/deps/a.js': 'export const helperA = 1\n',
    'src/deps/b.js': 'export const helperB = 2\n',
  }
  const result = await run({ before: {}, after, changed: ['src/combine.js'] })
  const signal = result.signals.find(entry => entry.code === 'NEW_LARGE_MODULE')
  assert.ok(signal, `новый комбайн обязан дать сигнал: ${codesOf(result).join(',')}`)
  assert.ok(signal.detail.functions >= 20)
  assert.ok(signal.detail.exports >= 10)
  assert.ok(signal.detail.sideEffectSurfaces.length >= 2)
  assert.equal(checkOf(result, 'module-scope').status, 'WARNING', 'REVIEW, не автоматический BLOCK')
}

// --- 2. Большой словарь — не God-файл --------------------------------------
{
  const dictionary = `export const dictionary = {\n${'  "ключ": "значение",\n'.repeat(700)}}\n`
  const result = await run({ before: {}, after: { 'src/dict.js': dictionary }, changed: ['src/dict.js'] })
  assert.ok(!codesOf(result).includes('NEW_LARGE_MODULE'),
    '700-строчный декларативный словарь не должен считаться God-файлом')
}

// --- 3. Функции есть, но композит не собрался -------------------------------
{
  const plain = Array.from({ length: 12 }, (_, index) => [
    `function local${String(index)}() {`,
    ...Array.from({ length: 30 }, () => '  work()'),
    '}',
  ].join('\n')).join('\n') + '\nexport const run = local0\n'
  const result = await run({ before: {}, after: { 'src/plain.js': plain }, changed: ['src/plain.js'] })
  assert.ok(!codesOf(result).includes('NEW_LARGE_MODULE'),
    'один export и ноль side-effects — композит не собирается')
}

console.log('Gildra Runtime NEW_LARGE_MODULE tests passed.')
