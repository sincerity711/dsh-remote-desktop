import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('settings extension uses the official shell slots and design primitives', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  assert.doesNotMatch(patch, /ui-settings-general[\s\S]*disabled: true/)
  assert.doesNotMatch(client, /function SettingsShell/)
  assert.doesNotMatch(client, /name: 'sidebar.settings'/)
  assert.doesNotMatch(client, /rd-settingsOverlay/)
  assert.match(client, /ctx\.slots\.inject\('settings\.action'/)
  assert.match(client, /function SettingsHostAction/)
  assert.match(client, /data-rd-settings-host-switcher/)
  assert.match(client, /className: 'rd-settingsHostButton'/)
  assert.match(client, /h\(Menu, \{[\s\S]*rd-settingsHostButton/)
  assert.match(client, /h\(Button, \{[\s\S]*rd-settingsHostButton/)
})

test('remote desktop settings section lists hosts and opens native remote pages', async () => {
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /SSH hosts/)
  assert.match(client, /Hosts come from this machine\\'s SSH config/)
  assert.match(client, /data-rd-settings-host-state/)
  assert.match(client, /Open \$\{source\.label\} DSH/)
  assert.match(client, /window\.open\(nativeUrl, '_blank', 'noopener,noreferrer'\)/)
  assert.match(client, /data-rd-settings-open-native/)
  assert.match(client, /data-rd-settings-native-link/)
  assert.match(client, /h\(Button, \{ variant: 'primary'/)
  assert.match(client, /h\(Button, \{ variant: 'outline'/)
  assert.doesNotMatch(client, /data-rd-settings-remote-frame/)
  assert.doesNotMatch(client, /Save source/)
  assert.doesNotMatch(client, /data-rd-settings-save/)
})
