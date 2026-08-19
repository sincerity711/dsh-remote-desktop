import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('remote host API remains constrained for remote operations', async () => {
  const server = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

  assert.match(server, /suffix === '\/host-api'/)
  assert.match(server, /host API path must start with \/api\//)
  assert.match(server, /source is not connected/)
})

test('settings host switcher opens the selected remote native DSH page', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /data-rd-settings-host-switcher/)
  assert.match(client, /data-rd-settings-active-host/)
  assert.match(client, /function nativeRemoteUrl/)
  assert.match(client, /u\.search = ''/)
  assert.match(client, /u\.hash = ''/)
  assert.match(client, /window\.open\(nativeUrl, '_blank', 'noopener,noreferrer'\)/)
  assert.match(client, /data-rd-settings-open-native/)
  assert.match(client, /data-rd-settings-native-link/)
  assert.doesNotMatch(client, /function withSettingsView/)
  assert.doesNotMatch(client, /view', 'settings'/)
  assert.doesNotMatch(client, /data-rd-settings-remote-frame/)
  assert.doesNotMatch(client, /installHostApiFetchPatch/)
  assert.doesNotMatch(client, /settingsHostId/)
})
