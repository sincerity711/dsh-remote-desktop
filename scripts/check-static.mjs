#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

const localClient = await readFile('packages/local/lib/client.js', 'utf8')
const companionClient = await readFile('packages/companion/lib/client.js', 'utf8')
const companionHost = await readFile('packages/companion/lib/index.js', 'utf8')
const localHost = await readFile('packages/local/lib/index.js', 'utf8')
const localPatch = await readFile('packages/local/cordis.patch.yml', 'utf8')
const upstreamRecord = await readFile('packages/local/upstream/ui-workspace/UPSTREAM.md', 'utf8')
const upstreamPatch = await readFile('packages/local/upstream/ui-workspace/remote-desktop.patch', 'utf8')
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const containerEnv = await readFile('scripts/acceptance/container-env.mjs', 'utf8')
const containerDockerfile = await readFile('scripts/acceptance/container/Dockerfile.remote', 'utf8')
const containerEntrypoint = await readFile('scripts/acceptance/container/entrypoint.sh', 'utf8')

const requiredClientNeedles = [
  'window.__dshRemoteDesktop',
  'OfficialWorkspace.UiWorkspaceService',
  'ctx.slots.provideRoot',
  'const hostInfo =',
  'openRemoteSession',
  'openLocalSession',
  'const OfficialWorkspace = (() =>',
  '4e84901e6471b79ec0338099867ebb4606d12bb5',
  'OfficialWorkspaceForkBrowser',
  'data-rd-host-marker',
  'var(--dsw-specific-sidebar-fill)',
  'var(--dsw-alias-interactive-bg-hover)',
  "position: 'absolute'",
  "ctx.slots.inject('shell.overlay'",
  'data-rd-local-session-id',
  'data-rd-remote-session-id',
  'data-rd-workspace-source-kind',
  "ctx.slots.inject('settings.section'",
  'data-rd-settings-open-native',
  'data-rd-settings-native-link',
  'nativeRemoteUrl',
  "window.open(nativeUrl, '_blank', 'noopener,noreferrer')",
  'new MessageChannel()',
  'dsh-remote-desktop/state-baseline',
  'BRIDGE_PROTOCOL_VERSION = 1',
  "new EventSource('/remote-desktop/api/events')",
  'WorkspaceAddSplitter',
  'data-rd-add-workspace-splitter',
  'data-rd-remote-workspace-setup',
  'conversation.hero.workspace.directoryFlow',
  'dsh-remote-desktop/add-workspace-remote-request',
  'dsh-remote-desktop/add-workspace-remote-result',
]
for (const needle of requiredClientNeedles) {
  if (!localClient.includes(needle)) throw new Error(`packages/local/lib/client.js missing ${needle}`)
}


const upstreamHash = '4e84901e6471b79ec0338099867ebb4606d12bb5'
if (!upstreamRecord.includes(upstreamHash)) throw new Error('ui-workspace upstream record missing pinned hash')
if (!upstreamPatch.includes('remote host marker')) throw new Error('ui-workspace remote patch summary missing marker delta')
if (/ui-settings-general[\s\S]*disabled: true/.test(localPatch)) throw new Error('ui-settings-general should remain enabled; extend official settings slots instead')

const forbiddenSettingsActionNeedles = [
  "ctx.slots.inject('settings.action'",
  'data-rd-settings-host-switcher',
  'rd-settingsHostButton',
]
for (const needle of forbiddenSettingsActionNeedles) {
  if (localClient.includes(needle)) throw new Error(`settings header host selector remains: ${needle}`)
}

const forbiddenSettingsIframeNeedles = [
  'function withSettingsView',
  "view', 'settings'",
  'data-rd-settings-remote-frame',
  'data-dsh-remote-desktop-view',
  'openSettingsSurface',
]
for (const needle of forbiddenSettingsIframeNeedles) {
  if (localClient.includes(needle) || companionClient.includes(needle)) throw new Error(`settings-only iframe behavior remains: ${needle}`)
}


const splitterStart = localClient.indexOf('function WorkspaceAddSplitter')
const splitterEnd = localClient.indexOf('function RemoteOverlay')
if (splitterStart === -1 || splitterEnd === -1 || splitterEnd <= splitterStart) {
  throw new Error('workspace add splitter implementation is not isolated enough for static checks')
}
const splitterSource = localClient.slice(splitterStart, splitterEnd)
const requiredSplitterNeedles = [
  "require('@deepseek-ai/dsh-client-ui-primitives')",
  'h(Modal',
  'h(Button',
  'data-rd-remote-directory-picker',
  'data-rd-remote-breadcrumbs',
  'data-rd-directory-path',
  'browseRemoteDirectory',
  'h(Menu',
  'props.createLocalWorkspace({ path })',
  "remoteRpc(sourceId, 'workspace/create'",
  "remoteRpc(sourceId, 'session/create'",
  'isRemoteDesktopIframe()',
]
for (const needle of requiredSplitterNeedles) {
  if (!localClient.includes(needle)) throw new Error(`workspace add splitter missing ${needle}`)
}
const forbiddenSplitterNeedles = [
  "h('select'",
  '▣',
  '💻',
  '🌐',
  '#fff',
  'rgba(0,0,0',
]
for (const needle of forbiddenSplitterNeedles) {
  if (splitterSource.includes(needle)) throw new Error(`workspace add splitter uses non-official UI chrome: ${needle}`)
}
if (!localClient.includes("- id: ui-workspace")) {
  // The source file cannot contain the patch, but this branch keeps the check text near the UI assertions.
}

const forbiddenSidebarInline = [
  'styles.row',
  'styles.sourceHeader',
  'styles.activeSource',
  'rgba(57,100,254,.14)',
  'Remote: ${source.label}',
  'rd-sourceHeader',
  'rd-browser',
  'rd-workspaceHeader',
  'rd-sessionRow',
  'data-rd-sidebar\': \'official-style-fork\'',
  'data-rd-host-badge',
]
for (const needle of forbiddenSidebarInline) {
  if (localClient.includes(needle)) throw new Error(`legacy inline sidebar style remains: ${needle}`)
}

const requiredCompanionNeedles = [
  'event.origin !== parent',
  'event.source !== window.parent',
  'data.sourceToken !== token',
  'data.protocolVersion !== BRIDGE_PROTOCOL_VERSION',
  'dsh-remote-desktop/connect',
  'dsh-remote-desktop/request',
  'dsh-remote-desktop/state-baseline',
  'BRIDGE_CAPABILITIES',
  '#root [class*="frame"]:has(> [class*="sidebarCol"]) > [class*="sidebarCol"] { visibility: hidden !important; pointer-events: none !important; overflow: hidden !important; }',
  ':has(> [class*="sidebarCol"])',
]
for (const needle of requiredCompanionNeedles) {
  if (!companionClient.includes(needle)) throw new Error(`packages/companion/lib/client.js missing ${needle}`)
}
if (companionClient.includes('[class*="frame"] { grid-template-columns') || companionClient.includes('[class*="frame"] {')) {
  throw new Error('companion must not rewrite every class containing frame; it breaks remote plugins')
}

for (const needle of ['REMOTE_COMPANION_SNAPSHOT_PATH', 'REMOTE_COMPANION_RPC_PATH', '/remote-desktop-companion/api/snapshot', '/remote-desktop-companion/api/rpc', '/remote-desktop/api/host-api', 'DSH_REMOTE_DESKTOP_COMPANION_TOKEN']) {
  if (localHost.includes(needle) || companionHost.includes(needle)) throw new Error(`obsolete Companion Host business API remains: ${needle}`)
}
for (const needle of ["inject = ['webServer', 'connection']", 'requestRejection(req)']) {
  if (!localHost.includes(needle)) throw new Error(`authenticated local management boundary missing ${needle}`)
}
if (!companionHost.includes('/remote-desktop-companion/api/health')) throw new Error('transitional Companion readiness route missing')
if (localClient.includes('snapshot/get') || companionClient.includes('snapshot/get')) throw new Error('snapshot request fallback remains in Client Bridge')
if (localClient.includes('setInterval(() => { void store.refreshSources() }, 5000)')) throw new Error('remote source snapshot polling remains')
for (const needle of ['ReactDOM.createPortal', "document.addEventListener('pointermove', measure", 'window.setInterval(measure, 250)']) {
  if (localClient.includes(needle)) throw new Error(`legacy overlay polling/portal remains: ${needle}`)
}
for (const source of [localClient, companionClient]) {
  if (source.includes('@deepseek-ai/dsh-client-runtime')) throw new Error('removed dsh-client-runtime dependency remains')
}

if (!localPatch.includes('- id: ui-workspace\n  disabled: true')) {
  throw new Error('remote desktop must own the workspace picker when installing the splitter')
}


const requiredContainerScripts = [
  'acceptance:container:up',
  'acceptance:container:p0',
  'acceptance:container:p1',
  'acceptance:container:canary',
  'acceptance:container:down',
  'acceptance:container:clean',
]
for (const name of requiredContainerScripts) {
  if (typeof packageJson.scripts?.[name] !== 'string') throw new Error(`package.json missing ${name}`)
}
for (const needle of ['remote-a', 'remote-b', 'minicpm-v4.6:1b', 'DSH_RD_OLLAMA_API_KEY', 'ollama-canary-dummy-key', 'apiKeyEnv: ${ollamaApiKeyEnv}', 'DSH_REMOTE_DESKTOP_SSH_CONFIG', 'stateDir', 'containerBin']) {
  if (!containerEnv.includes(needle)) throw new Error(`Apple container acceptance helper missing ${needle}`)
}
for (const needle of ['dsh-rd-debs', 'javascript-node:22-bookworm']) {
  if (!containerDockerfile.includes(needle)) throw new Error(`Apple container remote image file missing ${needle}`)
}
if (!containerEntrypoint.includes('DSH_AUTHORIZED_KEYS')) throw new Error('Apple container entrypoint missing DSH_AUTHORIZED_KEYS')

console.log('static remote desktop checks passed')
