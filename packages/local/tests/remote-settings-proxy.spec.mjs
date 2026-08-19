import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('remote host API remains constrained for remote operations', async () => {
  const server = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

  assert.match(server, /suffix === '\/host-api'/)
  assert.match(server, /host API path must start with \/api\//)
  assert.match(server, /source is not connected/)
})

test('remote desktop settings section opens remote native DSH pages', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /ctx\.slots\.inject\('settings\.section'/)
  assert.doesNotMatch(client, /ctx\.slots\.inject\('settings\.action'/)
  assert.doesNotMatch(client, /data-rd-settings-host-switcher/)
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


test('remote browse API is read-only and separate from host RPC proxy', async () => {
  const server = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

  assert.match(server, /req\.method === 'GET' && suffix === '\/browse'/)
  assert.match(server, /browseRemoteDirectory\(source, \{ path, hidden \}, runtimes\.get\(id\)\)/)
  assert.match(server, /buildRemoteBrowseSshArgs\(source\)/)
  assert.match(server, /proc\.stdin\.end\(JSON\.stringify\(\{ path: input\.path, hidden: Boolean\(input\.hidden\) \}\)\)/)
  assert.doesNotMatch(server, /host-api[\s\S]{0,240}browseRemoteDirectory/)
})


test('remote connection verification accepts companion boot entry', async () => {
  const server = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

  assert.match(server, /function probeRemoteCompanion/)
  assert.match(server, /html\.includes\(REMOTE_COMPANION_PACKAGE\)/)
  assert.match(server, /await rpc\(port, 'host\.describe', \{\}\)/)
  assert.match(server, /await verifyRemoteReady\(tunnelPort\)/)
})
