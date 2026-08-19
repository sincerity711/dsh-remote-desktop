import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('remote companion keeps iframe mode session-only and has no settings-only hack', async () => {
  const companion = await readFile(new URL('../../companion/lib/client.js', import.meta.url), 'utf8')

  assert.match(companion, /dsh-remote-desktop\/open-session/)
  assert.match(companion, /event\.origin !== parent/)
  assert.match(companion, /data\.token !== token/)
  assert.doesNotMatch(companion, /function settingsView/)
  assert.doesNotMatch(companion, /data-dsh-remote-desktop-view/)
  assert.doesNotMatch(companion, /openSettingsSurface/)
  assert.doesNotMatch(companion, /get\('view'\) === 'settings'/)
})
