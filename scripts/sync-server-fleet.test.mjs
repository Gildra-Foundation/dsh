import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, readFleet, remoteInstallScript, validateSshTarget } from './sync-server-fleet.mjs'

assert.deepEqual(
  parseArgs(['--repo-dir', '/repo', '--install-root', '/kit', '--best-effort', '--host', 'Manacost']),
  { 'repo-dir': '/repo', 'install-root': '/kit', bestEffort: true, hosts: ['Manacost'] },
)
assert.equal(validateSshTarget('debian@debian-151'), 'debian@debian-151')
assert.throws(() => validateSshTarget('host; reboot'), /Unsafe SSH target/)
assert.throws(() => validateSshTarget('-oProxyCommand=evil'), /Unsafe SSH target/)
assert.match(remoteInstallScript('/tmp/gildra-dsh-sync.abc123', 3081), /GILDRA_DSH_PORT=3081/)
assert.match(remoteInstallScript('/tmp/gildra-dsh-sync.abc123', 3081), /GILDRA_DSH_SKIP_OLLAMA=1/)

const root = await mkdtemp(join(tmpdir(), 'gildra-fleet-test-'))
try {
  await mkdir(join(root, 'home'), { recursive: true })
  await writeFile(join(root, 'home', 'remotes.json'), JSON.stringify({
    remotes: {
      Manacost: { host: 'debian-151', remotePort: 3080 },
      Duplicate: { host: 'debian-151', remotePort: 3082 },
      Gildra: { host: 'debian-51', user: 'debian', remotePort: 3081 },
    },
  }))
  const fleet = await readFleet(root, [])
  assert.deepEqual(fleet.map(remote => remote.name), ['Manacost', 'Gildra'])
  assert.equal(fleet[1].sshTarget, 'debian@debian-51')
  assert.deepEqual((await readFleet(root, ['debian-51'])).map(remote => remote.name), ['Gildra'])

  await writeFile(join(root, 'home', 'remotes.json'), JSON.stringify({
    remotes: { Unsafe: { host: 'debian-51', remotePort: 22 } },
  }))
  await assert.rejects(() => readFleet(root, []), /Unsafe remote port/)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Gildra server fleet synchronization tests passed.')
