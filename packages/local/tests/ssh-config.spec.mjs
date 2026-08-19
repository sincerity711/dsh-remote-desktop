import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRemoteSetupSshArgs, parseSshConfig } from '../lib/index.js'

test('parseSshConfig keeps concrete host aliases and display details', () => {
  const hosts = parseSshConfig(`
Host *
  User ignored

Host win-wsl
  HostName 192.0.2.10
  User ubuntu
  Port 2222

Host dev-* xsn ?bad
  User wildcard

Host xsn
  HostName xsn.local
`)

  assert.deepEqual(hosts.map(host => host.id), ['win-wsl', 'xsn'])
  assert.equal(hosts[0].label, 'win-wsl')
  assert.equal(hosts[0].sshAlias, 'win-wsl')
  assert.equal(hosts[0].sshHost, '192.0.2.10')
  assert.equal(hosts[0].sshUser, 'ubuntu')
  assert.equal(hosts[0].sshPort, 2222)
  assert.equal(hosts[0].remoteDshHost, '127.0.0.1')
  assert.equal(hosts[0].remoteDshPort, 30800)
  assert.equal(hosts[1].sshHost, 'xsn.local')
})

test('parseSshConfig dedupes aliases without reconstructing ssh options', () => {
  const hosts = parseSshConfig(`
Host win-wsl win-wsl
  ProxyJump bastion
  IdentityFile ~/.ssh/id_ed25519
`)

  assert.equal(hosts.length, 1)
  assert.equal(hosts[0].id, 'win-wsl')
  assert.equal(hosts[0].sshAlias, 'win-wsl')
  assert.equal(hosts[0].proxyJump, undefined)
  assert.equal(hosts[0].identityFile, undefined)
})


test('remote setup SSH command installs companion before connecting', () => {
  const args = buildRemoteSetupSshArgs({ sshAlias: 'win-wsl', remoteDshHost: '127.0.0.1', remoteDshPort: 30800 })
  assert.deepEqual(args.slice(0, 3), ['-o', 'BatchMode=yes', 'win-wsl'])
  const command = args.at(-1)
  assert.match(command, /dsh plugin --profile web add/)
  assert.match(command, /dsh-remote-desktop-companion/)
  assert.match(command, /remote_desktop_has_companion/)
  assert.match(command, /DSH_REMOTE_DESKTOP_INSTALL=1/)
  assert.match(command, /dsh --profile web --host/)
})


test('remote setup SSH command can start only prepared profiles for auto-connect', () => {
  const command = buildRemoteSetupSshArgs({ sshAlias: 'win-wsl', remoteDshHost: '127.0.0.1', remoteDshPort: 30800 }, { install: false }).at(-1)
  assert.match(command, /DSH_REMOTE_DESKTOP_INSTALL=0/)
  assert.match(command, /remote_desktop_companion_configured/)
  assert.match(command, /if \[ "\$DSH_REMOTE_DESKTOP_INSTALL" = "1" \]; then/)
  assert.match(command, /elif ! remote_desktop_companion_configured; then/)
})
