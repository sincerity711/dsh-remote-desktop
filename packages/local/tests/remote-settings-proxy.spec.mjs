import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('remote host API remains constrained for remote operations', async () => {
  const server = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

  assert.match(server, /suffix === '\/host-api'/)
  assert.match(server, /host API path must start with \/api\//)
  assert.match(server, /source is not connected/)
})

test('settings host switcher embeds the selected remote settings surface', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /data-rd-settings-host-switcher/)
  assert.match(client, /data-rd-settings-active-host/)
  assert.match(client, /function withSettingsView/)
  assert.match(client, /u\.searchParams\.set\('view', 'settings'\)/)
  assert.match(client, /data-rd-settings-remote-frame/)
  assert.match(client, /Settings for \$\{active\.label\}/)
  assert.match(client, /rd-settingsRemotePanel/)
  assert.doesNotMatch(client, /installHostApiFetchPatch/)
  assert.doesNotMatch(client, /settingsHostId/)
})
