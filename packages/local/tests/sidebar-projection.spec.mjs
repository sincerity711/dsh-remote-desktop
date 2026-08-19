import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const upstreamHash = '9f8359451a6f8df17f65bc2c398810ac19bdfc8a'

test('client sidebar records official workspace fork provenance', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const upstream = await readFile(new URL('../upstream/ui-workspace/UPSTREAM.md', import.meta.url), 'utf8')
  const patch = await readFile(new URL('../upstream/ui-workspace/remote-desktop.patch', import.meta.url), 'utf8')

  assert.match(upstream, new RegExp(upstreamHash))
  assert.match(patch, /remote host marker/)
  assert.match(client, new RegExp(upstreamHash))
  assert.match(client, /OfficialWorkspaceForkBrowser/)
})

test('client sidebar is project-first with a compact remote host marker', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /useCombinedWorkspaces/)
  assert.match(client, /useCombinedSessions/)
  assert.match(client, /data-rd-host-marker/)
  assert.match(client, /data-rd-workspace-source-kind/)

  assert.match(client, /IconPersonalizationOutline16/)
  assert.match(client, /IconProjectAddOutline16/)
  assert.match(client, /IconEllipsisOutline16/)
  assert.match(client, /OfficialWorkspace\.WorkspaceBrowser/)
  assert.doesNotMatch(client, /data-rd-host-badge/)
  assert.doesNotMatch(client, /Remote: \$\{source\.label\}/)
  assert.doesNotMatch(client, /function SourceSection/)
  assert.doesNotMatch(client, /rd-sourceHeader/)
  assert.doesNotMatch(client, /rd-browser/)
  assert.doesNotMatch(client, /rd-workspaceHeader/)
  assert.doesNotMatch(client, /rd-sessionRow/)
  assert.doesNotMatch(client, /data-rd-sidebar['"]?: ['"]official-style-fork/)
})
