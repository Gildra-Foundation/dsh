#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const result = { bestEffort: false, hosts: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--best-effort') {
      result.bestEffort = true
      continue
    }
    if (value === '--host') {
      const host = argv[++index]
      if (!host) throw new Error('Missing value for --host')
      result.hosts.push(host)
      continue
    }
    if (['--repo-dir', '--install-root'].includes(value)) {
      const next = argv[++index]
      if (!next) throw new Error(`Missing value for ${value}`)
      result[value.slice(2)] = next
      continue
    }
    throw new Error(`Unknown argument: ${value}`)
  }
  for (const required of ['repo-dir', 'install-root']) {
    if (!result[required]) throw new Error(`Missing --${required}`)
  }
  return result
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr })
        return
      }
      const detail = stderr.trim() || stdout.trim() || `exit ${String(code)}`
      reject(new Error(`${command} failed: ${detail}`))
    })
    if (options.input) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

function validateSshTarget(value) {
  if (typeof value !== 'string' || value.startsWith('-') || !/^[A-Za-z0-9._@:-]+$/.test(value)) {
    throw new Error(`Unsafe SSH target: ${JSON.stringify(value)}`)
  }
  return value
}

async function readFleet(installRoot, selectedHosts) {
  const configPath = join(installRoot, 'home', 'remotes.json')
  let root
  try {
    root = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const selected = new Set(selectedHosts)
  const seen = new Set()
  const fleet = []
  for (const [name, remote] of Object.entries(root.remotes ?? {})) {
    if (!remote || typeof remote !== 'object') continue
    const sshTarget = validateSshTarget(remote.user ? `${remote.user}@${remote.host}` : remote.host)
    if (selected.size > 0 && !selected.has(name) && !selected.has(remote.host) && !selected.has(sshTarget)) continue
    if (seen.has(sshTarget)) continue
    seen.add(sshTarget)
    const remotePort = Number.isInteger(remote.remotePort) ? remote.remotePort : 3080
    if (remotePort < 1024 || remotePort > 65535) {
      throw new Error(`Unsafe remote port for ${name}: ${JSON.stringify(remote.remotePort)}`)
    }
    fleet.push({
      name,
      host: remote.host,
      sshTarget,
      remotePort,
    })
  }
  return fleet
}

async function buildPayload(repoDir, stage) {
  const payload = join(stage, 'payload')
  await mkdir(payload, { recursive: true })
  for (const directory of ['config', 'install', 'patches', 'plugins', 'scripts']) {
    await cp(join(repoDir, directory), join(payload, directory), {
      recursive: true,
      filter(source) {
        const name = basename(source)
        return !name.startsWith('._') && !['node_modules', 'build', 'dist', 'artifacts'].includes(name)
      },
    })
  }
  const archive = join(stage, 'gildra-server-kit.tgz')
  await run('tar', ['-czf', archive, '-C', payload, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  return archive
}

function remoteInstallScript(remoteStage, remotePort) {
  return `set -euo pipefail
stage=${remoteStage}
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
mkdir -p "$stage/payload"
tar -xzf "$stage/gildra-server-kit.tgz" -C "$stage/payload"
GILDRA_DSH_SKIP_OLLAMA=1 \
GILDRA_DSH_PORT=${String(remotePort)} \
GILDRA_DSH_INSTALL_ROOT="$HOME/.gildra-dsh" \
bash "$stage/payload/install/linux-server-install.sh"
pids="$(pgrep -f "$HOME/.gildra-dsh/source/apps/cli/lib/bin.js web" || true)"
if [[ -n "$pids" ]]; then
  kill $pids || true
  for _ in {1..30}; do
    pgrep -f "$HOME/.gildra-dsh/source/apps/cli/lib/bin.js web" >/dev/null || break
    sleep 0.2
  done
fi
nohup "$HOME/.gildra-dsh/bin/Start-GildraDSH.server.sh" \
  >"$HOME/.gildra-dsh/server.log" 2>&1 </dev/null &
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:${String(remotePort)}/manifest.webmanifest" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done
echo "Remote Harness did not become ready on port ${String(remotePort)}" >&2
exit 1
`
}

async function syncRemote(remote, archive) {
  const created = await run('ssh', ['-o', 'BatchMode=yes', remote.sshTarget, 'mktemp -d /tmp/gildra-dsh-sync.XXXXXX'])
  const remoteStage = created.stdout.trim()
  if (!/^\/tmp\/gildra-dsh-sync\.[A-Za-z0-9]+$/.test(remoteStage)) {
    throw new Error(`Unexpected remote staging path from ${remote.name}: ${JSON.stringify(remoteStage)}`)
  }
  try {
    await run('scp', ['-q', archive, `${remote.sshTarget}:${remoteStage}/gildra-server-kit.tgz`])
    await run('ssh', ['-o', 'BatchMode=yes', remote.sshTarget, 'bash', '-s'], {
      input: remoteInstallScript(remoteStage, remote.remotePort),
    })
  } catch (error) {
    await run('ssh', ['-o', 'BatchMode=yes', remote.sshTarget, 'rm', '-rf', remoteStage]).catch(() => {})
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoDir = resolve(args['repo-dir'])
  const installRoot = resolve(args['install-root'])
  const fleet = await readFleet(installRoot, args.hosts)
  if (fleet.length === 0) {
    process.stdout.write('No configured Gildra servers to synchronize.\n')
    return
  }
  const stage = await mkdtemp(join(tmpdir(), 'gildra-server-fleet-'))
  const failures = []
  try {
    const archive = await buildPayload(repoDir, stage)
    for (const remote of fleet) {
      process.stdout.write(`Synchronizing ${remote.name} (${remote.host})…\n`)
      try {
        await syncRemote(remote, archive)
        process.stdout.write(`Synchronized ${remote.name}.\n`)
      } catch (error) {
        failures.push({ remote, error })
        process.stderr.write(`Could not synchronize ${remote.name}: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
  if (failures.length > 0 && !args.bestEffort) {
    throw new Error(`Synchronization failed for ${failures.map(({ remote }) => remote.name).join(', ')}`)
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`Gildra server synchronization failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

export { buildPayload, parseArgs, readFleet, remoteInstallScript, validateSshTarget }
