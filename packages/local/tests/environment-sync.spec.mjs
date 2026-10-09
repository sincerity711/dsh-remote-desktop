import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { snapshotEnvironment, validateIdentity } from '../lib/environment-sync.js'
import { buildRemoteSetupSshArgs } from '../lib/index.js'
import { syncFixture } from './helpers/sync-fixture.mjs'

test('snapshot uses the running profile anchor, exact plugin versions and activation', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  const dir = join(f.home, 'profiles/custom')
  await mkdir(join(dir, 'node_modules/dsh-ssh-workspace'), { recursive: true })
  await mkdir(join(dir, 'node_modules/example-plugin'), { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-ssh-workspace': '^1.0.0', 'example-plugin': '^2.0.0' }, dsh: { profile: { bundles: ['dsh-ssh-workspace', 'example-plugin'] } } }))
  await writeFile(join(dir, 'cordis.patch.yml'), JSON.stringify([{ id: 'example-row', disabled: true, config: { secret: 'do-not-copy' } }]))
  for (const [name, version] of [['dsh-ssh-workspace', '1.2.3'], ['example-plugin', '2.3.4']]) {
    await writeFile(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version, dsh: { bundle: { patch: 'patch.yml' } } }))
    await writeFile(join(dir, 'node_modules', name, 'patch.yml'), JSON.stringify([{ insert: [{ id: 'example-row', name }] }]))
  }
  const result = await snapshotEnvironment({ dir, home: f.home, installAnchor: f.anchor, patchPath: join(dir, 'cordis.patch.yml'), overlays: [] })
  assert.equal(result.runtimeVersion, '1.2.3')
  assert.deepEqual(result.plugins.map(p => [p.name, p.version, p.enabled]), [['dsh-ssh-workspace-companion', '1.2.3', true], ['example-plugin', '2.3.4', true]])
  assert.deepEqual(result.plugins[1].activation, [{ id: 'example-row', disabled: true }])
  assert.ok(!JSON.stringify(result).includes('do-not-copy'))
})

test('invalid package identities cannot reach npm', () => {
  for (const [name, version] of [['--global', '1.0.0'], ['plugin;echo bad', '1.0.0'], ['plugin', 'latest'], ['plugin', '1.0.0\n--global']]) assert.throws(() => validateIdentity(name, version))
})

test('worker reconciles exact plugins, disables extras, preserves data and repeats without install/restart', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  const dir = join(f.home, 'profiles/web')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'extra-plugin': '9.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'extra-plugin'] } }, custom: 'retain' }))
  await writeFile(join(f.home, 'settings.yaml'), 'sentinel-settings')
  await writeFile(join(f.home, 'session.json'), 'sentinel-session')
  const first = await f.run(); assert.equal(first.code, 0, first.stderr)
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  assert.ok(!manifest.dsh.profile.bundles.includes('extra-plugin'))
  assert.equal(manifest.dependencies['extra-plugin'], '9.0.0')
  assert.equal(manifest.dependencies['example-plugin'], '2.3.4')
  assert.equal(manifest.custom, 'retain')
  assert.equal(await readFile(join(f.home, 'settings.yaml'), 'utf8'), 'sentinel-settings')
  assert.equal(await readFile(join(f.home, 'session.json'), 'utf8'), 'sentinel-session')
  const service = join(f.home, `remote-desktop/managed/service-${f.port}.json`)
  const before = await readFile(service, 'utf8'), calls = await readFile(join(f.home, 'plugin-calls'), 'utf8')
  const second = await f.run(); assert.equal(second.code, 0, second.stderr)
  assert.equal(await readFile(service, 'utf8'), before)
  assert.equal(await readFile(join(f.home, 'plugin-calls'), 'utf8'), calls)
})

test('missing DSH installs an exact user-owned runtime without changing npm prefix', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  await rm(join(f.bin, 'dsh'))
  // Keep system dsh off PATH, while allowing the ownership ps check.
  const path = `${f.bin}:/usr/bin:/bin`
  const result = await f.run(f.target, { PATH: path }); assert.equal(result.code, 0, result.stderr)
  assert.equal((await readFile(join(f.home, 'npm-calls'), 'utf8')).trim(), '@deepseek-ai/dsh@1.2.3')
  const record = JSON.parse(await readFile(join(f.home, `remote-desktop/managed/service-${f.port}.json`), 'utf8'))
  assert.ok(record.executable.startsWith(join(f.home, 'remote-desktop/managed/runtime/1.2.3')))
})

test('unavailable exact runtime fails without activating a partial profile', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  await rm(join(f.bin, 'dsh'))
  const result = await f.run(f.target, { PATH: `${f.bin}:/usr/bin:/bin`, SYNC_FAIL_INSTALL: '1' })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Installing DSH.*exact version unavailable/)
  await assert.rejects(readFile(join(f.home, 'profiles/web/package.json')), { code: 'ENOENT' })
})

test('missing npm reports prerequisite failure without touching the profile', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  await rm(join(f.bin, 'npm'))
  const result = await f.run(f.target, { PATH: f.bin })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Checking environment.*npm/)
  await assert.rejects(readFile(join(f.home, 'profiles/web/package.json')), { code: 'ENOENT' })
})

test('an unrelated HTTP listener is never stopped or modified', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  const server = createServer((_req, res) => res.end('unrelated'))
  await new Promise(resolve => server.listen(f.port, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const result = await f.run(); assert.equal(result.code, 1)
  assert.match(result.stderr, /not owned by SSH Workspace/)
  assert.equal(await (await fetch(`http://127.0.0.1:${f.port}`)).text(), 'unrelated')
  await assert.rejects(readFile(join(f.home, 'profiles/web/package.json')), { code: 'ENOENT' })
})

test('framed SSH input finishes with stdin open and keeps repeat setup idempotent', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  const first = await f.run(f.target, { DSH_REMOTE_DESKTOP_FRAMED: '1' })
  assert.equal(first.code, 0, first.stderr)
  const second = await f.run(f.target, { DSH_REMOTE_DESKTOP_FRAMED: '1' })
  assert.equal(second.code, 0, second.stderr)
  assert.ok(!second.stdout.includes('Starting DSH'))
})

test('closing the SSH input cancels setup and a retry recovers its dead lock', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  const cancelled = await f.run(f.target, { DSH_REMOTE_DESKTOP_FRAMED: '1', SYNC_CLOSE_INPUT: '1' })
  assert.equal(cancelled.code, 130, cancelled.stderr)
  const retry = await f.run(f.target, { DSH_REMOTE_DESKTOP_FRAMED: '1' })
  assert.equal(retry.code, 0, retry.stderr)
})

test('a different PATH runtime gets the exact matching user-owned installation', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  await rm(join(f.bin, 'dsh'))
  await writeFile(join(f.bin, 'dsh'), '#!/bin/sh\necho 0.1.0\n')
  await chmod(join(f.bin, 'dsh'), 0o755)
  const result = await f.run(); assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Installing DSH/)
  assert.equal((await readFile(join(f.home, 'npm-calls'), 'utf8')).trim(), '@deepseek-ai/dsh@1.2.3')
})

test('a live remote setup lock prevents another setup from mutating the profile', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  const lock = join(f.home, 'remote-desktop/managed/setup.lock')
  await mkdir(lock, { recursive: true }); await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }))
  const result = await f.run(); assert.equal(result.code, 1)
  assert.match(result.stderr, /Another remote setup is in progress/)
  await assert.rejects(readFile(join(f.home, 'profiles/web/package.json')), { code: 'ENOENT' })
})

test('automatic prepared startup reuses managed DSH even when dsh is absent on PATH', async t => {
  const f = await syncFixture(); t.after(() => f.close())
  const result = await f.run(); assert.equal(result.code, 0, result.stderr)
  const servicePath = join(f.home, `remote-desktop/managed/service-${f.port}.json`)
  const record = JSON.parse(await readFile(servicePath, 'utf8'))
  process.kill(record.pid, 'SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 200))
  await rm(join(f.bin, 'dsh'))
  const script = buildRemoteSetupSshArgs({ sshAlias: 'test', remoteDshHost: '127.0.0.1', remoteDshPort: f.port }, { install: false }).at(-1).replace(/^sh -lc /, 'sh -c ')
  const started = await promisify(execFile)('/bin/sh', ['-c', script], { env: { ...process.env, DSH_HOME: f.home }, timeout: 15000 })
  assert.match(started.stdout, /token=test-token/)
  const current = JSON.parse(await readFile(servicePath, 'utf8'))
  assert.notEqual(current.pid, record.pid)
  assert.equal(current.executable, record.executable)
})
