#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

const localClient = await readFile('packages/local/lib/client.js', 'utf8')
const companionClient = await readFile('packages/companion/lib/client.js', 'utf8')
const localPatch = await readFile('packages/local/cordis.patch.yml', 'utf8')

const requiredClientNeedles = [
  'ctx.provide(\'remoteDesktop\'',
  'openRemoteSession',
  'openLocalSession',
  'data-rd-sidebar\': \'official-style-fork\'',
  'var(--dsw-specific-sidebar-fill)',
  'var(--dsw-alias-interactive-bg-hover)',
  "position: 'fixed'",
  '2147483000',
  'ReactDOM.createPortal',
  'data-rd-overlay-host',
  'data-rd-local-session-id',
  'data-rd-remote-session-id',
  'data-rd-host-badge',
  'data-rd-workspace-source-kind',
  'sidebar.settings',
  'data-rd-settings-host-filter',
  'installHostApiFetchPatch',
  '/remote-desktop/api/host-api',
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
  'h(Input',
  'h(Menu',
  'props.createLocalWorkspace({ path })',
  "remoteRpc(sourceId, 'workspace.create'",
  "remoteRpc(sourceId, 'session.create'",
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
]
for (const needle of forbiddenSidebarInline) {
  if (localClient.includes(needle)) throw new Error(`legacy inline sidebar style remains: ${needle}`)
}

const requiredCompanionNeedles = [
  'event.origin !== parent',
  'data.token !== token',
  'dsh-remote-desktop/open-session',
  '[class*="sidebarCol"] { visibility: hidden !important; pointer-events: none !important; overflow: hidden !important; }',
  ':has(> [class*="sidebarCol"])',
]
for (const needle of requiredCompanionNeedles) {
  if (!companionClient.includes(needle)) throw new Error(`packages/companion/lib/client.js missing ${needle}`)
}
if (companionClient.includes('[class*="frame"] { grid-template-columns')) {
  throw new Error('companion must not rewrite every class containing frame; it breaks remote plugins')
}

if (!localPatch.includes('- id: ui-workspace\n  disabled: true')) {
  throw new Error('remote desktop must own the workspace picker when installing the splitter')
}

console.log('static remote desktop checks passed')
