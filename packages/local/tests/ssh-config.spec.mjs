import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSshConfig } from '../lib/index.js'

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
