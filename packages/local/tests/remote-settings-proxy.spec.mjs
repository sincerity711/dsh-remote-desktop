import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('remote settings proxy is exposed and selected host API calls are routed', async () => {
  const [server, client] = await Promise.all([
    readFile(new URL('../lib/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/client.js', import.meta.url), 'utf8'),
  ])

  assert.match(server, /suffix === '\/host-api'/)
  assert.match(server, /host API path must start with \/api\//)
  assert.match(server, /source is not connected/)
  assert.match(client, /installHostApiFetchPatch/)
  assert.match(client, /settingsHostId === 'local'/)
  assert.match(client, /\/remote-desktop\/api\/host-api/)
  assert.match(client, /isHostScopedSettingsApi/)
  assert.match(client, /\/api\/settings\./)
  assert.doesNotMatch(client, /url\.pathname\.startsWith\('\/api\/'\)/)
})
