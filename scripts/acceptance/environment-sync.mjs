#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, realpath, symlink } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { snapshotEnvironment } from '../../packages/local/lib/environment-sync.js'
import { synchronizeRemote } from '../../packages/local/lib/remote-sync.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const localHome = join(root, '.acceptance', 'environment-sync', 'local-home')
const remoteHome = '/home/dsh/.dsh-remote-desktop-test-env-sync'
const port = 30802
const sshConfig = join(root, '.acceptance/container/ssh-config')
const artifact = join(root, '.acceptance/artifacts', `sync-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`)
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const events = []
let proxy, proxyPort
let local

async function command(bin, args, options = {}) {
  const child = spawn(bin, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], ...options })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdin.on('error', () => {})
  if (options.framed) child.stdin.write(`${options.input}\n`)
  else child.stdin.end(options.input)
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept) })
  if (code !== 0) throw new Error(`${bin} failed (${code}): ${stderr}`)
  return stdout.trim()
}
const ssh = (script, options) => command('ssh', ['-F', sshConfig, '-o', 'BatchMode=yes', 'remote-b', `sh -lc ${quote(script)}`], options)
const remoteJson = path => ssh(`node -e ${quote(`console.log(require('node:fs').readFileSync(${JSON.stringify(path)},'utf8'))`)}`).then(JSON.parse)

async function sync(snapshot) {
  const script = `export DSH_HOME=${quote(remoteHome)} DSH_TELEMETRY_DISABLED=1 DSH_REMOTE_DESKTOP_HOST=127.0.0.1 DSH_REMOTE_DESKTOP_PORT=${port} DSH_REMOTE_DESKTOP_FRAMED=1
export PATH=${quote(`${remoteHome}/test-bin:/usr/bin:/bin`)}
export HTTP_PROXY=http://192.168.64.1:${proxyPort} HTTPS_PROXY=http://192.168.64.1:${proxyPort} npm_config_proxy=http://192.168.64.1:${proxyPort} npm_config_https_proxy=http://192.168.64.1:${proxyPort} NO_PROXY=127.0.0.1,localhost
exec node --input-type=module -e ${quote(`(${synchronizeRemote.toString()})()`)} `
  const output = await ssh(script, { input: JSON.stringify(snapshot), framed: true })
  const stages = output.split('\n').filter(line => line.startsWith('DSH_SETUP_STAGE:'))
  events.push({ stages })
  console.log(stages.join('\n'))
  return stages
}

async function verifyConnect() {
  const listener = createServer()
  await new Promise(accept => listener.listen(0, '127.0.0.1', accept))
  const localPort = listener.address().port
  await new Promise(accept => listener.close(accept))
  const base = `http://127.0.0.1:${localPort}`
  let output = '', cookie
  local = spawn('dsh', ['--profile', 'web', '--host', '127.0.0.1', '--port', String(localPort), '--trusted-host', `127.0.0.1:${localPort}`], { env: { ...process.env, DSH_HOME: localHome, DSH_TELEMETRY_DISABLED: '1', DSH_REMOTE_DESKTOP_SSH_CONFIG: sshConfig }, stdio: ['ignore', 'pipe', 'pipe'] })
  local.stdout.on('data', bytes => { output = `${output}${bytes}`.slice(-16000) })
  local.stderr.on('data', bytes => { output = `${output}${bytes}`.slice(-16000) })
  for (let attempt = 0; attempt < 300 && !cookie; attempt++) {
    const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(output)?.[1]
    if (token) {
      try { cookie = (await fetch(`${base}/?token=${token}`, { redirect: 'manual' })).headers.get('set-cookie')?.split(';', 1)[0] } catch {}
    }
    if (!cookie) await delay(100)
  }
  assert.ok(cookie, 'local DSH did not become ready')
  const api = async (path, body) => {
    const response = await fetch(`${base}/remote-desktop/api${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    assert.ok(response.ok && value.ok, value.error?.message || `Connect API ${response.status}`)
    return value
  }
  await api('/sources', { id: 'sync-test', sshAlias: 'remote-b', remoteDshPort: port, remoteDshHome: remoteHome, autoConnect: false })
  const observed = new Set()
  let settled = false
  const polling = (async () => {
    while (!settled) {
      const source = (await api('/sources')).sources.find(source => source.id === 'sync-test')
      if (source?.setupStage) observed.add(source.setupStage)
      await delay(50)
    }
  })()
  let results
  try { results = await Promise.all([api('/connect', { id: 'sync-test', setup: true }), api('/connect', { id: 'sync-test', setup: true })]) }
  finally { settled = true; await polling }
  assert.equal(results[0].source.state, 'connected')
  assert.equal(results[0].source.iframeUrl, results[1].source.iframeUrl, 'duplicate Connect must share one connection')
  assert.ok(observed.has('Checking environment'), 'Settings preparation stage must be observable')
  const health = await fetch(new URL('/remote-desktop-companion/api/health', results[0].source.iframeUrl))
  assert.equal((await health.json()).dshVersion, await command('dsh', ['--version']))
  await api('/disconnect', { id: 'sync-test' })
  events.push({ connectApi: 'PASS', duplicateConnect: 'PASS', observedStages: [...observed] })
  console.log('PASS Settings Connect API: exact synchronization, one shared connection, visible preparation stages and working forwarded health')
}

try {
  await mkdir(artifact, { recursive: true })
  proxy = spawn(process.execPath, [join(root, 'scripts/acceptance/host-connect-proxy.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] })
  proxyPort = await new Promise((accept, reject) => {
    let line = ''
    proxy.stdout.on('data', chunk => { line += chunk; if (line.includes('\n')) accept(JSON.parse(line.split('\n')[0]).port) })
    proxy.once('error', reject)
    proxy.once('exit', code => reject(new Error(`Package proxy exited: ${code}`)))
  })
  await command('dsh', ['--profile', 'web', '--dump-config'], { env: { ...process.env, DSH_HOME: localHome, DSH_TELEMETRY_DISABLED: '1' } })
  const profile = join(localHome, 'profiles/web')
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  const pluginDir = join(localHome, 'fixture')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: 'dsh-sync-fixture', version: '1.0.0', private: true, type: 'module', main: 'index.js', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(pluginDir, 'index.js'), "export const name='dsh-sync-fixture'; export function apply() {}\n")
  await writeFile(join(pluginDir, 'cordis.patch.yml'), '- insert:\n    - id: sync-fixture\n      name: dsh-sync-fixture\n')
  await writeFile(join(profile, 'cordis.patch.yml'), '- id: sync-fixture\n  disabled: true\n')
  manifest.dependencies = { ...manifest.dependencies, 'dsh-ssh-workspace': `link:${join(root, 'packages/local')}`, 'dsh-sync-fixture': `link:${pluginDir}` }
  manifest.dsh.profile.bundles = [...new Set([...manifest.dsh.profile.bundles, 'dsh-ssh-workspace', 'dsh-sync-fixture'])]
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest))
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  for (const [name, path] of [['dsh-ssh-workspace', join(root, 'packages/local')], ['dsh-sync-fixture', pluginDir]]) {
    try { await symlink(path, join(profile, 'node_modules', name)) } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  const cli = await realpath(await command('sh', ['-c', 'command -v dsh']))
  const anchor = join(dirname(cli), '..', 'package.json')
  const snapshot = await snapshotEnvironment({ name: 'web', dir: profile, home: localHome, installAnchor: anchor, patchPath: join(profile, 'cordis.patch.yml'), overlays: [] })
  assert.equal(snapshot.runtimeVersion, await command('dsh', ['--version']))
  await ssh(`set -e
mkdir -p ${quote(`${remoteHome}/test-bin`)}
for bin in node npm pnpm; do ln -sf /usr/local/bin/$bin ${quote(`${remoteHome}/test-bin`)}/$bin; done
node -e ${quote(`const fs=require('node:fs');const p=${JSON.stringify(remoteHome)};if(!fs.existsSync(p+'/settings.yaml')&&!fs.existsSync(p+'/settings.yaml.imported'))fs.writeFileSync(p+'/settings.yaml','sync-sentinel: retain\\n');if(!fs.existsSync(p+'/session-sentinel'))fs.writeFileSync(p+'/session-sentinel','retain-session')`)} `)
  await sync(snapshot)
  const servicePath = `${remoteHome}/remote-desktop/managed/service-${port}.json`
  const service = await remoteJson(servicePath)
  assert.equal(service.version, snapshot.runtimeVersion)
  assert.ok(service.executable.startsWith(`${remoteHome}/remote-desktop/managed/runtime/`))
  let remoteManifest = await remoteJson(`${remoteHome}/profiles/web/package.json`)
  for (const plugin of snapshot.plugins) {
    const installed = await remoteJson(`${remoteHome}/profiles/web/node_modules/${plugin.name}/package.json`)
    assert.equal(installed.version, plugin.version)
    assert.equal(remoteManifest.dsh.profile.bundles.includes(plugin.name), plugin.enabled)
  }
  await ssh(`node -e ${quote(`const fs=require('node:fs'),p=${JSON.stringify(remoteHome)};const dir=p+'/extra';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/package.json',JSON.stringify({name:'dsh-sync-extra',version:'1.0.0',type:'module',main:'index.js',dsh:{bundle:{patch:'patch.yml'}}}));fs.writeFileSync(dir+'/index.js','export const name="dsh-sync-extra";export function apply(){}');fs.writeFileSync(dir+'/patch.yml','- insert:\\n    - id: sync-extra\\n      name: dsh-sync-extra\\n');const file=p+'/profiles/web/package.json',m=JSON.parse(fs.readFileSync(file));m.dependencies['dsh-sync-extra']='link:'+dir;if(!m.dsh.profile.bundles.includes('dsh-sync-extra'))m.dsh.profile.bundles.push('dsh-sync-extra');fs.writeFileSync(file,JSON.stringify(m));`)} `)
  await sync(snapshot)
  remoteManifest = await remoteJson(`${remoteHome}/profiles/web/package.json`)
  assert.ok(!remoteManifest.dsh.profile.bundles.includes('dsh-sync-extra'))
  assert.ok(remoteManifest.dependencies['dsh-sync-extra'])
  const beforeRepeat = await remoteJson(servicePath)
  const stages = await sync(snapshot)
  assert.ok(!stages.some(stage => /Installing DSH|Starting DSH|Stopping managed/.test(stage)))
  assert.deepEqual(await remoteJson(servicePath), beforeRepeat)
  const sentinels = await ssh(`node -e ${quote(`const fs=require('node:fs'),p=${JSON.stringify(remoteHome)};console.log(JSON.stringify({settings:fs.readFileSync(p+(fs.existsSync(p+'/settings.yaml')?'/settings.yaml':'/settings.yaml.imported'),'utf8'),session:fs.readFileSync(p+'/session-sentinel','utf8'),patch:fs.readFileSync(p+'/cordis.patch.yml','utf8')}))`)} `)
  const preserved = JSON.parse(sentinels)
  assert.ok(preserved.settings.includes('sync-sentinel: retain'))
  assert.equal(preserved.session, 'retain-session')
  assert.match(preserved.patch, /id: sync-fixture\n\s+disabled: true/)
  await verifyConnect()
  await writeFile(join(artifact, 'acceptance-report.json'), JSON.stringify({ status: 'PASS', runtimeVersion: snapshot.runtimeVersion, plugins: snapshot.plugins.map(({ archive, integrity, ...plugin }) => plugin), events, remoteHome, port }, null, 2))
  console.log(`Environment synchronization PASS. Artifacts: ${artifact}`)
} catch (error) {
  await writeFile(join(artifact, 'acceptance-report.json'), JSON.stringify({ status: 'FAIL', error: error.message, events, remoteHome, port }, null, 2))
  console.error(error.message)
  process.exitCode = 1
} finally {
  proxy?.kill()
  local?.kill()
  console.log(`Cleanup: stop the retained container remotes with npm run acceptance:container:down. Local sync test home: ${localHome}; remote sync test home: ${remoteHome}.`)
}
