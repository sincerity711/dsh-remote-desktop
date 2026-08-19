import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('workspace add splitter keeps local and remote routes separate', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /WorkspaceAddSplitter/)
  assert.match(client, /openWorkspaceAdd: \(anchorRef\) =>/)
  assert.match(client, /if \(openWorkspaceAdd !== void 0\) openWorkspaceAdd\(wsPlusRef\)/)
  assert.doesNotMatch(client, /left: -10000, top: -10000/)
  assert.match(client, /data-rd-add-workspace-splitter/) 
  assert.match(client, /data-rd-add-local/) 
  assert.match(client, /data-rd-add-remote/) 
  assert.match(client, /conversation\.hero\.workspace\.directoryFlow/) 
  assert.match(client, /props\.createLocalWorkspace\(\{ path \}\)/)
  assert.match(client, /RemoteSetupModal/)
  assert.match(client, /data-rd-remote-workspace-setup/) 
  assert.match(client, /remoteRpc\(sourceId, 'workspace\.create'/)
  assert.match(client, /browseRemoteDirectory\(sourceId, path, hidden, signal\)/)
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
  assert.match(splitter, /data-rd-remote-directory-picker/)
  assert.match(splitter, /data-rd-remote-breadcrumbs/)
  assert.match(splitter, /data-rd-directory-path/)
  assert.match(splitter, /h\(Menu/)
  assert.doesNotMatch(splitter, /h\('select'/)
  assert.doesNotMatch(splitter, /▣|⚙|🔌|💻|🌐/u)
  assert.doesNotMatch(splitter, /#fff|rgba\(0,0,0/)
})


test('sidebar header Add workspace opens the Local Remote splitter directly', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /const \[splitterOpenNonce, setSplitterOpenNonce\] = useState\(null\)/)
  assert.match(client, /openSplitterNonce: splitterOpenNonce/)
  assert.match(client, /openWorkspaceAdd: \(anchorRef\) => \{[\s\S]*setPickerOpen\(false\)[\s\S]*setSplitterOpenNonce\(`\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\}`\)/)
  assert.match(client, /useEffect\(\(\) => \{[\s\S]*props\.openSplitterNonce[\s\S]*setSplitterOpen\(true\)[\s\S]*\}, \[props\.openSplitterNonce\]\)/)
})


test('remote workspace setup browses folders from home before create', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /function browseRemoteDirectory\(sourceId, path, hidden, signal\)/)
  assert.match(client, /url\.searchParams\.set\('hidden', hidden \? '1' : '0'\)/)
  assert.match(client, /if \(path\) url\.searchParams\.set\('path', path\)/)
  assert.match(client, /browseRemoteDirectory\(selected\.id, undefined, showHidden, controller\.signal\)/)
  assert.match(client, /onClick: \(\) => browseTo\(entry\.path\)/)
  assert.match(client, /'data-rd-breadcrumb-path': item\.path/)
  assert.match(client, /const selectedPath = browse\.path/)
  assert.match(client, /remoteRpc\(sourceId, 'workspace\.create', \{ path: selectedPath \}\)/)
  assert.doesNotMatch(client.slice(client.indexOf('function RemoteSetupModal'), client.indexOf('function RemoteOverlay')), /Remote absolute path|placeholder: '\/path\/to\/project'|setPath/)
})
