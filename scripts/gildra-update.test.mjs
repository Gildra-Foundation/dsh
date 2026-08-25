import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveNameForPlatform,
  checkForUpdate,
  compareVersions,
  parseVersion,
  releaseStatus,
} from './gildra-update.mjs'

assert.deepEqual(parseVersion('v1.2.3-rc.4'), {
  major: 1,
  minor: 2,
  patch: 3,
  prerelease: ['rc', '4'],
})
assert.equal(compareVersions('0.1.12', '0.1.11'), 1)
assert.equal(compareVersions('0.1.11', '0.1.11'), 0)
assert.equal(compareVersions('0.1.11-rc.2', '0.1.11'), -1)
assert.equal(compareVersions('0.1.11-rc.10', '0.1.11-rc.2'), 1)
assert.equal(compareVersions('invalid', '0.1.11'), null)
assert.equal(archiveNameForPlatform('darwin'), 'Gildra-DSH-macOS.zip')
assert.equal(archiveNameForPlatform('win32'), 'Gildra-DSH-Windows.zip')

const release = {
  tag_name: 'v0.1.12',
  html_url: 'https://github.com/Gildra-Foundation/dsh/releases/tag/v0.1.12',
  published_at: '2026-08-25T00:00:00Z',
  assets: [
    { name: 'Gildra-DSH-macOS.zip', browser_download_url: 'https://example.test/mac.zip' },
    { name: 'Gildra-DSH-Windows.zip', browser_download_url: 'https://example.test/win.zip' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt' },
  ],
}
assert.equal(releaseStatus('0.1.11', release, 'darwin').updateAvailable, true)
assert.equal(releaseStatus('0.1.13', release, 'darwin').updateAvailable, false)

const root = await mkdtemp(join(tmpdir(), 'gildra-update-check-'))
try {
  await mkdir(join(root, 'config'), { recursive: true })
  await writeFile(join(root, '.gildra-kit-version'), '0.1.11\n')
  await writeFile(join(root, 'config', 'kit.json'), JSON.stringify({
    distribution: { repository: 'Gildra-Foundation/dsh' },
  }))
  let requestedUrl
  const status = await checkForUpdate({
    installRoot: root,
    targetPlatform: 'darwin',
    async fetchImpl(url) {
      requestedUrl = url
      return new Response(JSON.stringify(release), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.equal(requestedUrl, 'https://api.github.com/repos/Gildra-Foundation/dsh/releases/latest')
  assert.equal(status.currentVersion, '0.1.11')
  assert.equal(status.latestVersion, '0.1.12')
  assert.equal(status.updateAvailable, true)
  assert.equal(status.assetAvailable, true)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Gildra updater tests passed.')
