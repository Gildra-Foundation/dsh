import assert from 'node:assert/strict'
import { apply } from './lib/index.js'

const sections = []
let guard
const ctx = {
  systemPrompt: {
    section(value) {
      sections.push(value)
      return () => {}
    },
  },
  tools: {
    guard(value) {
      guard = value
      return () => {}
    },
  },
  effect(callback) {
    callback()
  },
}

apply(ctx)

assert.equal(sections.some((section) => section.name === 'gildra:code-map'), true)
assert.equal(sections.some((section) => section.name === 'gildra:tool-hygiene'), true)
assert.equal(typeof guard, 'function')
assert.match(
  guard({ name: 'canvas_preview', arguments: { mode: 'render', url: 'https://example.com' } }),
  /Remote URL preview is disabled/,
)
assert.equal(guard({ name: 'canvas_preview', arguments: { mode: 'render', file: '/workspace/map.html' } }), undefined)
assert.equal(guard({ name: 'web_fetch', arguments: { url: 'https://example.com' } }), undefined)

console.log('Gildra UI policy tests passed.')
