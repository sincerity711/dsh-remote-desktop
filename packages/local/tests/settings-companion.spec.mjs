import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('remote companion uses an authenticated parent MessageChannel and has no settings-only hack', async () => {
  const companion = await readFile(new URL('../../companion/lib/client.js', import.meta.url), 'utf8')

  assert.match(companion, /dsh-remote-desktop\/connect/)
  assert.match(companion, /dsh-remote-desktop\/request/)
  assert.match(companion, /dsh-remote-desktop\/state-baseline/)
  assert.match(companion, /BRIDGE_PROTOCOL_VERSION = 1/)
  assert.match(companion, /BRIDGE_CAPABILITIES/)
  assert.match(companion, /dsh-remote-desktop\/bridge-listening/)
  assert.match(companion, /window\.setInterval\(announceListening, 500\)/)
  assert.match(companion, /event\.origin !== parent/)
  assert.match(companion, /event\.source !== window\.parent/)
  assert.match(companion, /data\.sourceToken !== token/)
  assert.doesNotMatch(companion, /snapshot\/get/)
  assert.doesNotMatch(companion, /function settingsView/)
  assert.doesNotMatch(companion, /data-dsh-remote-desktop-view/)
  assert.doesNotMatch(companion, /openSettingsSurface/)
  assert.doesNotMatch(companion, /get\('view'\) === 'settings'/)
})
