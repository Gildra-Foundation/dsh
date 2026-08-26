// Только correctness-правила: репозиторий сознательно не вводит стилевой
// линт задним числом, чтобы не смешивать массовое переформатирование с
// функциональными изменениями (см. CONTRIBUTING.md).
const nodeGlobals = {
  Buffer: 'readonly',
  Response: 'readonly',
  URL: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  fetch: 'readonly',
  globalThis: 'readonly',
  process: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
}

const browserGlobals = {
  CustomEvent: 'readonly',
  Element: 'readonly',
  Event: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLElement: 'readonly',
  SVGElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  MutationObserver: 'readonly',
  Node: 'readonly',
  NodeFilter: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  sessionStorage: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  window: 'readonly',
}

const correctnessRules = {
  'no-const-assign': 'error',
  'no-dupe-args': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-fallthrough': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-unsafe-negation': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'valid-typeof': 'error',
}

export default [
  {
    ignores: [
      'node_modules/**',
      'desktop/macos/build/**',
      'dist/**',
      'plugins/gildra-dsh-ui-compact/src/**',
    ],
  },
  {
    files: [
      'scripts/**/*.mjs',
      'patches/**/*.mjs',
      'plugins/**/*.mjs',
      'plugins/**/lib/**/*.js',
      'patches/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...nodeGlobals, ...browserGlobals },
    },
    rules: correctnessRules,
  },
  {
    files: ['plugins/gildra-dsh-ui-compact/lib/client.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: correctnessRules,
  },
]
