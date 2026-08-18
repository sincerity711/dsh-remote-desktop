#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

const localClient = await readFile('packages/local/lib/client.js', 'utf8')
const companionClient = await readFile('packages/companion/lib/client.js', 'utf8')

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
]
for (const needle of requiredClientNeedles) {
  if (!localClient.includes(needle)) throw new Error(`packages/local/lib/client.js missing ${needle}`)
}

const forbiddenSidebarInline = [
  'styles.row',
  'styles.sourceHeader',
  'styles.activeSource',
  'rgba(57,100,254,.14)',
]
for (const needle of forbiddenSidebarInline) {
  if (localClient.includes(needle)) throw new Error(`legacy inline sidebar style remains: ${needle}`)
}

const requiredCompanionNeedles = [
  'event.origin !== parent',
  'data.token !== token',
  'dsh-remote-desktop/open-session',
  '[class*="sidebarCol"] { display: none !important; }',
  ':has(> [class*="sidebarCol"])',
]
for (const needle of requiredCompanionNeedles) {
  if (!companionClient.includes(needle)) throw new Error(`packages/companion/lib/client.js missing ${needle}`)
}
if (companionClient.includes('[class*="frame"] { grid-template-columns')) {
  throw new Error('companion must not rewrite every class containing frame; it breaks remote plugins')
}

console.log('static remote desktop checks passed')
