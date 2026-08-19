import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('remote companion supports settings-only iframe mode', async () => {
  const companion = await readFile(new URL('../../companion/lib/client.js', import.meta.url), 'utf8')

  assert.match(companion, /function settingsView/)
  assert.match(companion, /get\('view'\) === 'settings'/)
  assert.match(companion, /data-dsh-remote-desktop-view/)
  assert.match(companion, /openSettingsSurface/)
  assert.match(companion, /findSettingsTrigger\(\)\?\.click\(\)/)
  assert.match(companion, /sourceToken: token, view/)
  assert.match(companion, /body\[data-dsh-remote-desktop-view="settings"\] \[role="dialog"\]\[aria-modal="true"\]/)
})
