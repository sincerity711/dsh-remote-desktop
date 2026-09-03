import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('parent bridge validates remote iframe add-workspace requests', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /dsh-remote-desktop\/add-workspace-remote-request/)
  assert.match(client, /dsh-remote-desktop\/add-workspace-remote-result/)
  assert.match(client, /isAddWorkspaceBridgeRequest/)
  assert.match(client, /tokenToSource\.get\(data\.token\)/)
  assert.match(client, /event\.origin !== new URL\(source\.iframeUrl\)\.origin/)
  assert.match(client, /event\.source !== frame\?\.contentWindow/)
  assert.match(client, /store\.openRemoteSetup\(\{ requestId: data\.requestId, origin: event\.origin, target: event\.source \}\)/)
  assert.match(client, /request\.target\.postMessage\(\{[\s\S]*requestId: request\.requestId[\s\S]*status/)
})

test('parent uses a versioned per-source MessageChannel for Controller state and commands', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /new MessageChannel\(\)/)
  assert.match(client, /dsh-remote-desktop\/connect/)
  assert.match(client, /BRIDGE_PROTOCOL_VERSION = 1/)
  assert.match(client, /dsh-remote-desktop\/state-baseline/)
  assert.match(client, /dsh-remote-desktop\/bridge-listening/)
  assert.match(client, /attachRemoteBridge\(source, event\.source\)/)
  assert.match(client, /dsh-remote-desktop\/request/)
  assert.match(client, /dsh-remote-desktop\/result/)
  assert.match(client, /bridge\.capabilities\.has\(method\)/)
  assert.doesNotMatch(client, /snapshot\/get/)
  assert.doesNotMatch(client, /setInterval\(\(\) => \{ void store\.refreshSources\(\) \}, 5000\)/)
})
