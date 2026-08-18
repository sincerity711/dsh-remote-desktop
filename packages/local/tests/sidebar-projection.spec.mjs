import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('client sidebar is project-first with remote host badges', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /workspaceViews/)
  assert.match(client, /data-rd-host-badge/)
  assert.match(client, /data-rd-workspace-source-kind/)
  assert.doesNotMatch(client, /Remote: \$\{source\.label\}/)
  assert.doesNotMatch(client, /function SourceSection/)
  assert.doesNotMatch(client, /rd-sourceHeader/)
})
