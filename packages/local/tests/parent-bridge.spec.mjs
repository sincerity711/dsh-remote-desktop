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
  assert.match(client, /store\.openRemoteSetup\(\{ requestId: data\.requestId, origin: event\.origin, target: event\.source \}\)/)
  assert.match(client, /request\.target\.postMessage\(\{[\s\S]*requestId: request\.requestId[\s\S]*status/)
})
