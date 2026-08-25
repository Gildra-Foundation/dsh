import { createHash, randomUUID } from 'node:crypto'
import { mkdir, lstat, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const name = 'gildra-skill-installer'
export const inject = ['tools', 'userQuestions', 'systemPrompt']

const MAX_FILES = 200
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024
const MAX_DEPTH = 8
const APPROVE_LABEL = 'Установить'

function cleanSegment(value) {
  if (!value || value === '.' || value === '..' || value.includes('\0') || value.includes('\\')) {
    throw new Error(`Недопустимый сегмент пути: ${JSON.stringify(value)}`)
  }
  return value
}

export function validateRelativePath(value) {
  const normalized = String(value || '').replace(/^\/+|\/+$/g, '')
  if (!normalized) return ''
  const segments = normalized.split('/').map(cleanSegment)
  return segments.join('/')
}

export function parseGitHubSource(input) {
  const source = String(input || '').trim()
  if (!source) throw new Error('Укажите GitHub-источник Skill.')

  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source)
    if (url.hostname.toLowerCase() !== 'github.com') {
      throw new Error('Поддерживаются только ссылки github.com.')
    }
    if (url.username || url.password) throw new Error('Ссылка не должна содержать учётные данные.')
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (parts.length < 2) throw new Error('Ссылка GitHub должна содержать owner/repository.')
    const owner = cleanSegment(parts[0])
    const repo = cleanSegment(parts[1].replace(/\.git$/i, ''))
    if (parts[2] === 'tree' || parts[2] === 'blob') {
      if (!parts[3]) throw new Error('В ссылке GitHub отсутствует ref.')
      const ref = cleanSegment(parts[3])
      let path = validateRelativePath(parts.slice(4).join('/'))
      if (parts[2] === 'blob' && basename(path).toLowerCase() === 'skill.md') path = dirname(path) === '.' ? '' : dirname(path)
      return { source, owner, repo, ref, path }
    }
    return { source, owner, repo, ref: '', path: validateRelativePath(parts.slice(2).join('/')) }
  }

  const at = source.lastIndexOf('@')
  const withoutRef = at > source.indexOf('/') ? source.slice(0, at) : source
  const ref = at > source.indexOf('/') ? cleanSegment(source.slice(at + 1)) : ''
  const parts = withoutRef.split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('Используйте owner/repository/path@ref или полную ссылку GitHub.')
  return {
    source,
    owner: cleanSegment(parts[0]),
    repo: cleanSegment(parts[1].replace(/\.git$/i, '')),
    ref,
    path: validateRelativePath(parts.slice(2).join('/')),
  }
}

function githubHeaders() {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'Gildra-DSH-Skill-Installer/0.1',
    'x-github-api-version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN?.trim()
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

async function githubJson(url, signal) {
  const response = await fetch(url, { headers: githubHeaders(), signal })
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const suffix = remaining === '0' ? ' Лимит GitHub API исчерпан; добавьте минимально привилегированный GITHUB_TOKEN.' : ''
    throw new Error(`GitHub API вернул HTTP ${response.status}.${suffix}`)
  }
  return response.json()
}

function apiPath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

async function resolveDefaultBranch(spec, signal) {
  if (spec.ref) return spec
  const repo = await githubJson(`https://api.github.com/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}`, signal)
  if (!repo.default_branch) throw new Error('GitHub не сообщил основную ветку репозитория.')
  return { ...spec, ref: String(repo.default_branch) }
}

async function downloadGitHubDirectory(rawSpec, signal) {
  const spec = await resolveDefaultBranch(rawSpec, signal)
  const files = []
  let totalBytes = 0

  async function visit(remotePath, relativePath, depth) {
    if (depth > MAX_DEPTH) throw new Error(`Skill глубже допустимого предела (${MAX_DEPTH}).`)
    const suffix = remotePath ? `/contents/${apiPath(remotePath)}` : '/contents'
    const url = `https://api.github.com/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}${suffix}?ref=${encodeURIComponent(spec.ref)}`
    const entry = await githubJson(url, signal)

    if (Array.isArray(entry)) {
      for (const child of [...entry].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
        const childRelative = validateRelativePath(relativePath ? `${relativePath}/${child.name}` : child.name)
        if (child.type === 'dir') {
          await visit(child.path, childRelative, depth + 1)
        } else if (child.type === 'file') {
          await visit(child.path, childRelative, depth + 1)
        } else {
          throw new Error(`Skill содержит неподдерживаемый объект GitHub (${child.type}): ${child.path}`)
        }
      }
      return
    }

    if (entry.type !== 'file') throw new Error(`Ожидался файл, получено: ${entry.type || 'unknown'}`)
    if (files.length >= MAX_FILES) throw new Error(`Skill содержит больше ${MAX_FILES} файлов.`)
    if (Number(entry.size || 0) > MAX_FILE_BYTES) throw new Error(`Файл слишком большой: ${entry.path}`)

    let data
    if (entry.encoding === 'base64' && entry.content) {
      data = Buffer.from(String(entry.content).replace(/\s/g, ''), 'base64')
    } else if (entry.download_url) {
      const response = await fetch(entry.download_url, { headers: githubHeaders(), signal })
      if (!response.ok) throw new Error(`Не удалось скачать ${entry.path}: HTTP ${response.status}`)
      data = Buffer.from(await response.arrayBuffer())
    } else {
      throw new Error(`GitHub не предоставил содержимое файла: ${entry.path}`)
    }

    if (data.length > MAX_FILE_BYTES) throw new Error(`Файл слишком большой: ${entry.path}`)
    totalBytes += data.length
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Skill превышает предел ${MAX_TOTAL_BYTES} байт.`)
    files.push({ path: validateRelativePath(relativePath || basename(entry.path)), data })
  }

  await visit(spec.path, '', 0)
  return { spec, files, totalBytes }
}

function unquote(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseSkillMetadata(content) {
  const text = String(content || '').replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') throw new Error('SKILL.md должен начинаться с YAML frontmatter.')
  const end = lines.slice(1).findIndex(line => line.trim() === '---')
  if (end < 0) throw new Error('В SKILL.md не закрыт YAML frontmatter.')
  const frontmatter = lines.slice(1, end + 1)
  const values = {}
  for (const line of frontmatter) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line)
    if (match) values[match[1]] = unquote(match[2])
  }
  const skillName = String(values.name || '').trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    throw new Error(`Недопустимое имя Skill: ${JSON.stringify(skillName)}. Требуется kebab-case.`)
  }
  return {
    name: skillName,
    description: String(values.description || 'Описание не указано.').trim(),
  }
}

export function scanSkillRisk(files) {
  const warnings = new Set()
  const executableExtensions = /\.(?:sh|command|bash|zsh|fish|ps1|bat|cmd|py|rb|pl|js|mjs|cjs|ts)$/i
  const patterns = [
    [/\brm\s+-rf\b/i, 'обнаружена команда rm -rf'],
    [/\bsudo\b/i, 'обнаружено повышение прав sudo'],
    [/(?:curl|wget)[^\n|]{0,300}\|\s*(?:ba)?sh\b/i, 'обнаружен запуск загруженного скрипта через shell'],
    [/\bInvoke-Expression\b|\biex\b/i, 'обнаружен PowerShell Invoke-Expression'],
    [/\bchild_process\b|\bos\.system\s*\(|\bsubprocess\./i, 'обнаружен запуск дочерних процессов'],
    [/\b(?:npm|pnpm|yarn|pip|pip3)\s+install\b/i, 'обнаружена установка зависимостей'],
  ]
  for (const file of files) {
    if (executableExtensions.test(file.path)) warnings.add(`есть исполняемый/скриптовый файл: ${file.path}`)
    if (file.data.length > 128 * 1024) continue
    const text = file.data.toString('utf8')
    for (const [pattern, warning] of patterns) {
      if (pattern.test(text)) warnings.add(`${warning} (${file.path})`)
    }
  }
  return [...warnings]
}

function bundleDigest(files) {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.data)
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function pathExists(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function installBundle(root, metadata, bundle) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const target = join(root, metadata.name)
  const existing = await pathExists(target)
  if (existing?.isSymbolicLink()) throw new Error('Целевой Skill является символической ссылкой; автоматическая замена запрещена.')

  const staging = join(root, `.${metadata.name}.staging-${randomUUID()}`)
  const backup = join(root, `.${metadata.name}.backup-${randomUUID()}`)
  await mkdir(staging, { recursive: false, mode: 0o700 })
  try {
    for (const file of bundle.files) {
      const destination = join(staging, file.path)
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await writeFile(destination, file.data, { mode: 0o600 })
    }
    await writeFile(join(staging, '.gildra-source.json'), `${JSON.stringify({
      source: bundle.spec.source,
      repository: `${bundle.spec.owner}/${bundle.spec.repo}`,
      ref: bundle.spec.ref,
      path: bundle.spec.path,
      digest: bundle.digest,
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 })

    if (existing) await rename(target, backup)
    try {
      await rename(staging, target)
    } catch (error) {
      if (existing) await rename(backup, target)
      throw error
    }
    if (existing) await rm(backup, { recursive: true, force: true })
    return { target, replaced: Boolean(existing) }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

function renderResult(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function registerInstallerTool(ctx) {
  return ctx.tools.register({
    name: 'install_skill_from_github',
    description: 'Find a trusted GitHub Skill source with web search, then use this tool to preview and install it. The tool validates SKILL.md, scans risky content, shows the exact source/ref/SHA-256 to the user, and ALWAYS waits for an in-app human confirmation before writing. Never substitute bash, PowerShell, curl, npm, npx, or git for this tool when installing a Skill.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: {
          type: 'string',
          description: 'GitHub directory containing SKILL.md. Examples: https://github.com/owner/repo/tree/main/skills/name or owner/repo/skills/name@v1.2.3.',
        },
      },
      required: ['source'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string' },
          name: { type: 'string' },
          source: { type: 'string' },
          ref: { type: 'string' },
          digest: { type: 'string' },
          path: { type: 'string' },
          replaced: { type: 'boolean' },
          message: { type: 'string' },
        },
        required: ['status', 'name', 'source', 'ref', 'digest', 'message'],
      },
      render: renderResult,
    },
    async execute(args, exec) {
      const downloaded = await downloadGitHubDirectory(parseGitHubSource(args.source), exec.signal)
      const skillFile = downloaded.files.find(file => file.path.toLowerCase() === 'skill.md')
      if (!skillFile) throw new Error('В выбранной папке нет корневого SKILL.md.')
      const metadata = parseSkillMetadata(skillFile.data.toString('utf8'))
      const warnings = scanSkillRisk(downloaded.files)
      const digest = bundleDigest(downloaded.files)
      const skillsRoot = join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'skills')
      const target = join(skillsRoot, metadata.name)
      const existing = await pathExists(target)
      const details = [
        `Название: ${metadata.name}`,
        `Описание: ${metadata.description}`,
        `Источник: ${downloaded.spec.source}`,
        `Ревизия: ${downloaded.spec.ref}`,
        `SHA-256: ${digest}`,
        `Файлов: ${downloaded.files.length}; размер: ${downloaded.totalBytes} байт`,
        existing ? `Будет заменён существующий Skill: ${target}` : `Будет установлен в: ${target}`,
        warnings.length ? `Предупреждения:\n- ${warnings.join('\n- ')}` : 'Опасные шаблоны базовой проверкой не обнаружены.',
        'Скрипты Skill не будут запущены во время установки.',
      ].join('\n')

      const answer = await ctx.userQuestions.ask({
        questions: [{
          id: 'install-skill',
          header: 'Установка Skill',
          question: `Установить Skill «${metadata.name}»?`,
          detail: details,
          options: [
            { label: APPROVE_LABEL, description: existing ? 'Проверенно заменить существующую версию.' : 'Установить проверенные файлы.' },
            { label: 'Отмена', description: 'Ничего не менять.' },
          ],
        }],
        ...(exec.agent ? { agent: exec.agent } : {}),
        signal: exec.signal,
      })
      const approved = answer.answers.some(item => item.id === 'install-skill' && item.selected.includes(APPROVE_LABEL))
      if (!approved) {
        return {
          status: 'cancelled',
          name: metadata.name,
          source: downloaded.spec.source,
          ref: downloaded.spec.ref,
          digest,
          message: 'Установка отменена пользователем; файлы не изменены.',
        }
      }

      const result = await installBundle(skillsRoot, metadata, { ...downloaded, digest })
      return {
        status: 'installed',
        name: metadata.name,
        source: downloaded.spec.source,
        ref: downloaded.spec.ref,
        digest,
        path: result.target,
        replaced: result.replaced,
        message: 'Skill установлен. Он появится в каталоге автоматически; при уже открытой старой сессии создайте новую сессию.',
      }
    },
  })
}

export function apply(ctx) {
  ctx.effect(() => registerInstallerTool(ctx), 'gildra-skill-installer: model tool')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'gildra:skill-installer',
    order: 114,
    text: 'When the user asks to find or install a Skill, use web search to identify the exact GitHub directory and then call install_skill_from_github. Do not install Skills through shell commands, package managers, or copied curl commands. The installer itself must collect the human confirmation.',
  }), 'gildra-skill-installer: policy')
}
