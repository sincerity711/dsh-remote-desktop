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

test('remote summaries preserve blank state for the official New Session label', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /blank: Boolean\(row\.blank \?\? row\.projections\?\.values\?\.sessionListMetadata\?\.blank\)/)
  assert.match(client, /function sessionTitle\(session\)[\s\S]*session\.blank \? "New Session" : session\.displayTitle/)
  assert.doesNotMatch(client, /blank: false,\n\s*running: Boolean\(row\.running\)/)
})


test('remote workspace and session actions forward through host API', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /async function startRemoteWorkspace\(sourceId, workspaceId\)[\s\S]*remoteRpc\(sourceId, 'session\.create', \{ workspaceId \}\)/)
  assert.match(client, /remoteRpc\(sourceId, 'workspace\.rename', \{ workspaceId, title \}\)/)
  assert.match(client, /remoteRpc\(sourceId, 'workspace\.delete', \{ workspaceId \}\)/)
  assert.match(client, /remoteRpc\(sourceId, 'workspace\.insertBefore'/)
  assert.match(client, /remoteRpc\(sourceId, 'session\.rename', \{ sessionId, title \}\)/)
  assert.match(client, /remoteRpc\(sourceId, 'session\.fork', \{ sessionId \}\)/)
  assert.match(client, /remoteRpc\(sourceId, 'workspace\.archiveSession', \{ sessionId \}\)/)
  assert.match(client, /remoteRpc\(sourceId, 'workspace\.insertSessionBefore'/)
  assert.match(client, /const remoteId = decodeWorkspace\(workspaceId\)[\s\S]*deleteRemoteWorkspace\(remoteId\.sourceId, remoteId\.id\)[\s\S]*props\.deleteLocalWorkspace\?\.\(workspaceId\)/)
  assert.match(client, /const remoteId = decodeSession\(sessionId\)[\s\S]*archiveRemoteSession\(remoteId\.sourceId, remoteId\.id\)[\s\S]*props\.archiveSession\?\.\(sessionId\)/)
})

test('remote overlay resends pending opens when the iframe reports ready', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /const \{ sources, active, pendingOpen, companionReady \} = remote/)
  assert.match(client, /pendingOpen\?\.nonce, source === undefined \? undefined : companionReady\[source\.id\]/)
  assert.match(client, /const REMOTE_OVERLAY_Z_INDEX = 900/)
  assert.doesNotMatch(client, /const REMOTE_OVERLAY_Z_INDEX = 2147483000/)
})


test('remote search forwards to connected hosts with source-qualified results', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /const searchCombinedSessions = async \(query, signal\) =>/)
  assert.match(client, /remote\.sources\.filter\(source => source\.state === 'connected'\)/)
  assert.match(client, /remoteRpc\(source\.id, 'session\.search', \{ query \}, signal\)/)
  assert.match(client, /sessionId: remoteKey\(source\.id, rowSessionId\(item\) \|\| item\.sessionId\)/)
  assert.match(client, /searchSessions: searchCombinedSessions/)
})


test('sidebar derives one Ungrouped bucket per source with per-bucket archive-all', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /const UNGROUPED_SOURCE_KEY_PREFIX = "__ungrouped__::"/)
  assert.match(client, /function ungroupedKeyForSource\(sourceId\)/)
  assert.match(client, /const strayBySource = \/\* @__PURE__ \*\/ new Map\(\)/)
  assert.match(client, /bucket = \{ key, sourceId, sourceKind: sourceId === "local" \? "local" : "remote", remoteMarker: session\.remoteMarker, members: \[\] \}/)
  assert.match(client, /"data-rd-ungrouped-source-id": row\.workspaceId === void 0 \? row\.sourceId : void 0/)
  assert.match(client, /label: t\("menu\.archiveAllSessions"\)/)
  assert.match(client, /row\.workspaceId !== void 0 && \(0, react_jsx_runtime\.jsx\)\("button", \{[\s\S]*actions\.newSession\.aria/)
  assert.match(client, /onUngroupedArchiveAll\(group\.key, group\.sessions\.map\(\(session\) => session\.id\)\)/)
})

test('archive-all Ungrouped uses existing source-aware session archive route', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /onUngroupedArchiveAll: \(groupKey, sessionIds\) => \{[\s\S]*for \(const sessionId of sessionIds\) await archiveSession\(sessionId\)/)
  assert.match(client, /archiveSession: async sessionId => \{[\s\S]*const remoteId = decodeSession\(sessionId\)[\s\S]*archiveRemoteSession\(remoteId\.sourceId, remoteId\.id\)[\s\S]*props\.archiveSession\?\.\(sessionId\)/)
  assert.match(client, /async function archiveRemoteSession\(sourceId, sessionId\)[\s\S]*remoteRpc\(sourceId, 'workspace\.archiveSession', \{ sessionId \}\)[\s\S]*refreshRemoteAfterMutation\(sourceId\)/)
})

test('workspace rename duplicate checks are source-local', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /const renameTargetSourceId = renameTarget === null \? void 0 : workspaces\.find\(\(w\) => w\.workspaceId === renameTarget\.workspaceId\)\?\.sourceId/)
  assert.match(client, /workspaces\.some\(\(w\) => w\.workspaceId !== renameTarget\.workspaceId && w\.sourceId === renameTargetSourceId && w\.title === renameTrimmed\)/)
})
