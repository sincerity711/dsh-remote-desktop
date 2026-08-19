import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('conversation workspace picker has local and remote add routes', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /conversation\.hero\.workspace/)
  assert.match(client, /RemoteWorkspacePicker/)
  assert.match(client, /data-rd-workspace-picker': 'remote-aware'/)
  assert.match(client, /AddWorkspaceDialog/)
  assert.match(client, /remoteRpc\(hostId, 'workspace\.create'/)
  assert.match(client, /remoteRpc\(sourceId, 'session\.create'/)
  assert.match(client, /createLocalWorkspace/)
})
