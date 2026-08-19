import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('workspace add splitter keeps local and remote routes separate', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /WorkspaceAddSplitter/)
  assert.match(client, /data-rd-add-workspace-splitter/) 
  assert.match(client, /data-rd-add-local/) 
  assert.match(client, /data-rd-add-remote/) 
  assert.match(client, /conversation\.hero\.workspace\.directoryFlow/) 
  assert.match(client, /props\.createLocalWorkspace\(\{ path \}\)/)
  assert.match(client, /RemoteSetupModal/)
  assert.match(client, /data-rd-remote-workspace-setup/) 
  assert.match(client, /remoteRpc\(sourceId, 'workspace\.create'/)
  assert.match(client, /remoteRpc\(sourceId, 'session\.create'/)
})

test('remote iframe mode keeps only splitter and directory-flow anchor', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /const iframeMode = isRemoteDesktopIframe\(\)/)
  assert.match(client, /if \(iframeMode\) \{[\s\S]*DirectoryFlowAnchor[\s\S]*return\n\s*\}/)
  assert.match(client, /sidebar\.workspaces\.directoryFlow/) 
  assert.match(client, /if \(iframeMode\) \{[\s\S]*return[\s\S]*\}\n      if \(typeof ctx\.provide === 'function'\) ctx\.provide\('remoteDesktop'/)
  assert.doesNotMatch(client, /if \(new URLSearchParams\(window\.location\.search\)\.get\('dshRemoteDesktop'\) === '1'\) return/)
})

test('splitter UI uses primitives instead of temporary browser controls', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const splitter = client.slice(client.indexOf('function WorkspaceAddSplitter'), client.indexOf('function RemoteOverlay'))

  assert.match(client, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/)
  assert.match(splitter, /h\(Modal/)
  assert.match(splitter, /h\(Button/)
  assert.match(splitter, /h\(Input/)
  assert.match(splitter, /h\(Menu/)
  assert.doesNotMatch(splitter, /h\('select'/)
  assert.doesNotMatch(splitter, /▣|⚙|🔌|💻|🌐/u)
  assert.doesNotMatch(splitter, /#fff|rgba\(0,0,0/)
})
