// Собирает plugins/gildra-dsh-ui-compact/lib/client.js из фрагментов
// plugins/gildra-dsh-ui-compact/src/client/*.js.
//
// Сборка — это конкатенация фрагментов в лексикографическом порядке имён,
// без каких-либо преобразований и добавлений: lib/client.js обязан быть
// байт-в-байт воспроизводим из src/client/. Никаких дат, окружения и прочих
// недетерминированных источников здесь быть не должно.
//
//   node scripts/build-ui-client.mjs          — пересобрать lib/client.js
//   node scripts/build-ui-client.mjs --check  — только сравнить (для verify.sh)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoDir = fileURLToPath(new URL('..', import.meta.url))
const sourceDir = join(repoDir, 'plugins', 'gildra-dsh-ui-compact', 'src', 'client')
const targetPath = join(repoDir, 'plugins', 'gildra-dsh-ui-compact', 'lib', 'client.js')
const checkOnly = process.argv.includes('--check')

const fail = (message) => {
  process.stderr.write(`build-ui-client: ${message}\n`)
  process.exit(1)
}

let fragmentNames
try {
  fragmentNames = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.js'))
    .sort()
} catch {
  fail(`не найдена папка фрагментов ${sourceDir}`)
}
if (fragmentNames.length === 0) fail(`в ${sourceDir} нет ни одного *.js фрагмента`)

const built = Buffer.concat(fragmentNames.map((name) => readFileSync(join(sourceDir, name))))

if (!checkOnly) {
  writeFileSync(targetPath, built)
  process.stdout.write(`build-ui-client: собрано ${built.length} байт из ${fragmentNames.length} фрагментов → ${targetPath}\n`)
  process.exit(0)
}

let current
try {
  current = readFileSync(targetPath)
} catch {
  fail(`отсутствует ${targetPath}; соберите его: node scripts/build-ui-client.mjs`)
}
if (!current.equals(built)) {
  let offset = 0
  const shorter = Math.min(current.length, built.length)
  while (offset < shorter && current[offset] === built[offset]) offset += 1
  let line = 1
  for (let i = 0; i < offset; i += 1) {
    if (built[i] === 0x0a) line += 1
  }
  fail(
    `lib/client.js расходится со сборкой из src/client/ (первое отличие: строка ${line}, байт ${offset}; ` +
      `размеры ${current.length} и ${built.length}). ` +
      'Правьте фрагменты в src/client/, затем пересоберите: node scripts/build-ui-client.mjs',
  )
}
process.stdout.write(`build-ui-client: lib/client.js совпадает со сборкой из ${fragmentNames.length} фрагментов\n`)
