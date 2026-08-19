import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('settings page lists ssh hosts and opens remote native DSH pages', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /SSH hosts/)
  assert.match(client, /Hosts come from this machine\\'s SSH config/)
  assert.match(client, /data-rd-settings-host-state/)
  assert.match(client, /sidebar\.settings/)
  assert.match(client, /data-rd-settings-host-switcher/)
  assert.match(client, /className: 'rd-settingsHostButton'/)
  assert.match(client, /h\(Menu, \{[\s\S]*rd-settingsHostButton/)
  assert.match(client, /h\(Button, \{[\s\S]*rd-settingsHostButton/)
  assert.match(client, /Local settings/)
  assert.match(client, /Remote settings: /)
  assert.match(client, /data-rd-settings-remote-state/)
  assert.match(client, /Open \$\{active\.label\} DSH/)
  assert.match(client, /Remote settings for \$\{active\.label\} are configured in that host's native DSH page\./)
  assert.match(client, /Connect \$\{active\.label\} to open that host's native DSH page and configure Settings there\./)
  assert.match(client, /not connected/)
  assert.doesNotMatch(client, /styles\.hostFilter/)
  assert.doesNotMatch(client, /data-rd-settings-remote-frame/)
  assert.doesNotMatch(client, /Save source/)
  assert.doesNotMatch(client, /data-rd-settings-save/)
})
