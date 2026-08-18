import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('settings page lists ssh hosts as connection targets', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /SSH hosts/)
  assert.match(client, /Hosts come from this machine\\'s SSH config/)
  assert.match(client, /data-rd-settings-host-state/)
  assert.match(client, /settings\.hostFilter/)
  assert.match(client, /data-rd-settings-host-filter/)
  assert.match(client, /data-rd-settings-remote-host-placeholder/)
  assert.match(client, /not connected/)
  assert.doesNotMatch(client, /Save source/)
  assert.doesNotMatch(client, /data-rd-settings-save/)
})
