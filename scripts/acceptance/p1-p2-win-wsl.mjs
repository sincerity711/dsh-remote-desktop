#!/usr/bin/env node
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const args = parseArgs(process.argv.slice(2))
const sshDest = args['ssh-dest'] ?? 'win-wsl'
const harnessRoot = resolve(args['harness-root'] ?? process.env.DSH_HARNESS_ROOT ?? join(repoRoot, '..', 'deepseek-harness'))
const localHome = resolve(repoRoot, '.acceptance', 'p1-local-home')
const artifactDir = join(repoRoot, '.acceptance', 'artifacts', `p1-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`)
const companionDir = resolve(repoRoot, 'packages/companion')
const localPlugin = resolve(repoRoot, 'packages/local')
const remotes = [
  { id: 'win-wsl-a', label: 'win-wsl-a', home: '~/.dsh-remote-desktop-p1-a', port: 30910, sentinel: '/tmp/dsh-rd-p1-a', text: 'REMOTE_SENTINEL_A' },
  { id: 'win-wsl-b', label: 'win-wsl-b', home: '~/.dsh-remote-desktop-p1-b', port: 30911, sentinel: '/tmp/dsh-rd-p1-b', text: 'REMOTE_SENTINEL_B' },
]
const report = []
const started = []
let localBase = ''
let localLog = ''
let browserLogs = []
let localSessionId = ''

await mkdir(artifactDir, { recursive: true })
process.on('exit', stopStarted)

try {
  await item('P1-MULTI-001', 'two remotes connect', async () => {
    await cmd('ssh', ['-o', 'BatchMode=yes', sshDest, 'true'], { timeoutMs: 10000 })
    await copyCompanion()
    for (const remote of remotes) await setupRemote(remote)
    await setupLocal()
    for (const remote of remotes) {
      await api('/sources', { method: 'POST', body: JSON.stringify({ id: remote.id, label: remote.label, sshHost: sshDest, sshUser: await remoteUser(), sshPort: 22, remoteDshHost: '127.0.0.1', remoteDshPort: remote.port }) })
      const source = (await api('/connect', { method: 'POST', body: JSON.stringify({ id: remote.id }) })).source
      remote.iframeUrl = source.iframeUrl
      remote.token = source.token
      remote.proxyOrigin = new URL(source.iframeUrl).origin
      if (source.state !== 'connected') throw new Error(`${remote.id} not connected`)
      const workspace = await remoteRpc(remote, 'workspace.create', { path: remote.sentinel })
      const session = await remoteRpc(remote, 'session.create', { workspaceId: workspace.workspace.workspaceId })
      remote.sessionId = session.sessionId
    }
    return remotes.map(r => `${r.id}:${r.proxyOrigin}`).join(', ')
  })

  await item('P1-MULTI-002', 'iframe origins differ', async () => {
    if (remotes[0].proxyOrigin === remotes[1].proxyOrigin) throw new Error('origins are equal')
    return `${remotes[0].proxyOrigin} != ${remotes[1].proxyOrigin}`
  })

  await item('P1-MULTI-004', 'explorer does not cross source snapshots', async () => {
    for (const remote of remotes) {
      const snapshot = await api(`/snapshot?id=${encodeURIComponent(remote.id)}`)
      const paths = snapshot.snapshot.workspaces.items.map(ws => ws.path)
      if (!paths.includes(remote.sentinel)) throw new Error(`${remote.id} own sentinel missing`)
      const other = remotes.find(r => r !== remote)
      if (paths.includes(other.sentinel)) throw new Error(`${remote.id} snapshot contains ${other.sentinel}`)
      const tree = await sidebarApi(remote, 'fs.tree', { sessionId: remote.sessionId, cwd: remote.sentinel, path: remote.sentinel })
      if (!tree.entries.some(e => e.name === 'remote-only.txt')) throw new Error(`${remote.id} fs.tree missing sentinel file`)
    }
    return 'each source snapshot and fs.tree stayed on its own sentinel workspace'
  })

  await item('P1-MULTI-005', 'terminal does not cross source commands', async () => {
    for (const remote of remotes) {
      const text = await terminalCommand(remote, `cat ${remote.sentinel}/remote-only.txt\n`)
      if (!text.includes(remote.text)) throw new Error(`${remote.id} terminal missing ${remote.text}`)
    }
    return 'A and B terminal outputs returned their own sentinel text'
  })

  await browserMultiChecks()
  await recoveryAndSettingsChecks()
  await p2Checks()
  await writeReport()
  stopStarted()
  console.log(`\nP1/P2 acceptance PASS. Artifacts: ${artifactDir}`)
} catch (error) {
  await writeReport().catch(() => {})
  stopStarted()
  console.error(`\nP1/P2 acceptance FAIL: ${error.message}`)
  console.error(`Artifacts: ${artifactDir}`)
  process.exit(1)
}

async function browserMultiChecks() {
  const { chromium } = loadPlaywright()
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', msg => browserLogs.push(`${msg.type()}: ${msg.text()}`))
  page.on('pageerror', err => browserLogs.push(`pageerror: ${err.message}`))
  try {
    await page.goto(localBase, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(8000)
    await dismissTopLevelBlockingUi(page)
    await item('P1-MULTI-003', 'tokens do not cross', async () => {
      for (const remote of remotes) await page.locator(`[data-rd-remote-session-id="${remote.sessionId}"]`).click()
      await page.waitForTimeout(3000)
      const result = await page.evaluate(async ({ wrongToken, targetSession, targetOrigin }) => {
        const frame = [...document.querySelectorAll('iframe')].find(f => f.src.startsWith(targetOrigin))
        if (!frame?.contentWindow) return { ok: false, reason: 'no target frame' }
        return await new Promise(resolve => {
          const timer = setTimeout(() => { window.removeEventListener('message', onMessage); resolve({ ok: true, reason: 'no opened ack with wrong token' }) }, 1500)
          function onMessage(event) {
            if (event.origin === targetOrigin && event.data?.type === 'dsh-remote-desktop/opened' && event.data.sessionId === targetSession) {
              clearTimeout(timer)
              window.removeEventListener('message', onMessage)
              resolve({ ok: false, reason: 'wrong token opened session' })
            }
          }
          window.addEventListener('message', onMessage)
          frame.contentWindow.postMessage({ type: 'dsh-remote-desktop/open-session', token: wrongToken, sessionId: targetSession }, targetOrigin)
        })
      }, { wrongToken: remotes[0].token, targetSession: remotes[1].sessionId, targetOrigin: remotes[1].proxyOrigin })
      if (!result.ok) throw new Error(result.reason)
      await settingsUiChecks(page)
      return result.reason
    })
    await item('P1-RECOVERY-001', 'disconnect active remote', async () => {
      await page.locator(`[data-rd-remote-session-id="${remotes[0].sessionId}"]`).click()
      await api('/disconnect', { method: 'POST', body: JSON.stringify({ id: remotes[0].id }) })
      await page.waitForTimeout(2000)
      const sources = (await api('/sources')).sources
      const source = sources.find(s => s.id === remotes[0].id)
      if (source.state !== 'disconnected') throw new Error(`state=${source.state}`)
      return `${remotes[0].id} disconnected`
    })
  } finally {
    await browser.close()
  }
}

async function recoveryAndSettingsChecks() {
  await item('P1-RECOVERY-002', 'reconnect preserves source', async () => {
    const source = (await api('/connect', { method: 'POST', body: JSON.stringify({ id: remotes[0].id }) })).source
    if (source.state !== 'connected') throw new Error(`state=${source.state}`)
    remotes[0].iframeUrl = source.iframeUrl
    remotes[0].token = source.token
    remotes[0].proxyOrigin = new URL(source.iframeUrl).origin
    const snapshot = await api(`/snapshot?id=${encodeURIComponent(remotes[0].id)}`)
    if (!snapshot.snapshot.workspaces.items.some(ws => ws.path === remotes[0].sentinel)) throw new Error('sentinel workspace missing after reconnect')
    return `${remotes[0].id} reconnected and snapshot restored`
  })
  await item('P1-RECOVERY-003', 'local remains usable', async () => {
    const value = await localRpc('session.list', {})
    if (!Array.isArray(value.items)) throw new Error('local session.list did not return items')
    return 'local session.list worked while remotes were managed'
  })
}


async function settingsUiChecks(page) {
  if (localSessionId) await page.locator('[data-rd-local-session-id]').first().click().catch(() => {})
  await page.waitForTimeout(800)
  await clickButtonContaining(page, 'Settings')
  await page.waitForTimeout(1000)
  await clickButtonContaining(page, 'Remote Desktop').catch(() => {})
  await page.locator('[data-rd-settings-section="true"]').waitFor({ timeout: 10000 })
  const setField = async (key, value) => {
    const input = page.locator(`[data-rd-settings-field="${key}"]`).first()
    await input.fill(String(value))
  }
  const user = await remoteUser()
  await item('P1-SETTINGS-001', 'create source from UI', async () => {
    await setField('label', 'settings-ui')
    await setField('sshHost', sshDest)
    await setField('sshUser', user)
    await setField('sshPort', '22')
    await setField('remoteDshHost', '127.0.0.1')
    await setField('remoteDshPort', String(remotes[0].port))
    await page.locator('[data-rd-settings-save="true"]').click()
    await page.locator('[data-rd-settings-source-id="settings-ui"]').waitFor({ timeout: 10000 })
    return 'settings-ui source card appeared'
  })
  await item('P1-SETTINGS-002', 'edit source from UI', async () => {
    await setField('label', 'settings-ui')
    await setField('sshHost', sshDest)
    await setField('sshUser', user)
    await setField('sshPort', '22')
    await setField('remoteDshHost', '127.0.0.1')
    await setField('remoteDshPort', String(remotes[1].port))
    await page.locator('[data-rd-settings-save="true"]').click()
    await page.waitForTimeout(1000)
    const source = (await api('/sources')).sources.find(s => s.id === 'settings-ui')
    if (source?.remoteDshPort !== remotes[1].port) throw new Error('remoteDshPort edit did not persist')
    return 'settings-ui remoteDshPort edited'
  })
  await item('P1-SETTINGS-003', 'disconnect source from UI', async () => {
    await page.locator('[data-rd-settings-connect="settings-ui"]').click()
    await waitForSourceState('settings-ui', 'connected')
    await page.locator('[data-rd-settings-disconnect="settings-ui"]').click()
    await waitForSourceState('settings-ui', 'disconnected')
    return 'settings-ui disconnected from UI'
  })
  await item('P1-SETTINGS-004', 'delete source from UI', async () => {
    await page.locator('[data-rd-settings-delete="settings-ui"]').click()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (!(await api('/sources')).sources.some(s => s.id === 'settings-ui')) return 'settings-ui deleted from UI'
      await delay(500)
    }
    throw new Error('settings-ui still present')
  })
  await item('P1-SETTINGS-005', 'validation errors shown', async () => {
    await setField('label', '')
    await setField('sshHost', '')
    await setField('sshUser', '')
    await page.locator('[data-rd-settings-save="true"]').click()
    await page.getByText(/required/).waitFor({ timeout: 5000 })
    return 'required-field validation message visible'
  })
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(500)
}

async function clickButtonContaining(page, text) {
  const clicked = await page.evaluate((text) => {
    const buttons = [...document.querySelectorAll('button')]
    const button = buttons.find(item => (item.textContent || '').includes(text))
    if (button === undefined) return false
    button.click()
    return true
  }, text)
  if (!clicked) throw new Error(`button containing ${text} not found`)
}

async function waitForSourceState(id, state) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const source = (await api('/sources')).sources.find(s => s.id === id)
    if (source?.state === state) return
    await delay(500)
  }
  throw new Error(`${id} did not reach ${state}`)
}

async function p2Checks() {
  await item('P2-SECURITY-001', 'proxy rejects arbitrary upstream', async () => {
    const source = (await api('/sources')).sources[0]
    if ('upstream' in source || 'password' in source || 'privateKey' in source) throw new Error('public source leaked forbidden fields')
    const res = await fetch(`${localBase}/remote-desktop/api/snapshot?id=not-a-source`)
    const json = await res.json()
    if (json.ok !== false) throw new Error('unknown source snapshot succeeded')
    return 'unknown source rejected and public source has no upstream/password/privateKey'
  })
  await item('P2-SECURITY-002', 'postMessage origin/token audit', async () => {
    const companion = await readFile(join(repoRoot, 'packages/companion/lib/client.js'), 'utf8')
    for (const needle of ['event.origin !== parent', 'data.token !== token', 'dsh-remote-desktop/open-session']) {
      if (!companion.includes(needle)) throw new Error(`missing ${needle}`)
    }
    return 'companion validates origin and token before open-session'
  })
  await item('P2-COMPAT-001', 'plugin compatibility matrix baseline', async () => {
    for (const remote of remotes) {
      const text = await terminalCommand(remote, `cat ${remote.sentinel}/remote-only.txt\n`)
      if (!text.includes(remote.text)) throw new Error(`${remote.id} Better Sidebar terminal baseline failed`)
    }
    return 'Better Sidebar Explorer/terminal baseline covered for both remotes'
  })
}

async function setupRemote(remote) {
  await ssh(`set -e
    export PATH=\"$HOME/.npm-global/bin:$PATH\"
    rm -rf ${remote.home} ${remote.sentinel}
    mkdir -p ${remote.sentinel}
    printf '${remote.text}\\n' > ${remote.sentinel}/remote-only.txt
    if ! command -v dsh >/dev/null 2>&1; then npm install -g @deepseek-ai/dsh@0.1.0-rc.7; fi
    DSH_HOME=${remote.home} dsh --profile web --dump-config >/tmp/dsh-rd-${remote.id}-dump.txt
    cd ${remote.home}/profiles/web
    node - <<'NODE'
const fs = require('fs')
const path = 'package.json'
const pkg = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : { name: 'remote-p1-profile', private: true }
pkg.dependencies = pkg.dependencies || {}
pkg.dependencies['dsh-better-sidebar'] = '^0.12.2'
pkg.dependencies['dsh-remote-desktop-companion'] = 'link:/tmp/dsh-remote-desktop-companion'
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
for (const name of ['dsh-better-sidebar', 'dsh-remote-desktop-companion']) if (!pkg.dsh.profile.bundles.includes(name)) pkg.dsh.profile.bundles.push(name)
pkg.pnpm = pkg.pnpm || {}
pkg.pnpm.onlyBuiltDependencies = Array.from(new Set([...(pkg.pnpm.onlyBuiltDependencies || []), 'node-pty', 'protobufjs']))
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\\n')
NODE
    grep -q 'minimumReleaseAgeExclude' pnpm-workspace.yaml 2>/dev/null || printf '\nminimumReleaseAgeExclude:\n  - dsh-better-sidebar\n' >> pnpm-workspace.yaml
    CI=true pnpm install --no-frozen-lockfile >/tmp/dsh-rd-${remote.id}-install.log 2>&1
    pnpm rebuild node-pty >/tmp/dsh-rd-${remote.id}-node-pty.log 2>&1 || true
    if [ -f /tmp/dsh-rd-${remote.id}.pid ]; then kill $(cat /tmp/dsh-rd-${remote.id}.pid) 2>/dev/null || true; fi
    nohup env DSH_HOME=${remote.home} DSH_TELEMETRY_DISABLED=1 dsh --profile web --host 127.0.0.1 --port ${remote.port} --trusted-host 127.0.0.1:${remote.port} > /tmp/dsh-rd-${remote.id}.log 2>&1 & echo $! > /tmp/dsh-rd-${remote.id}.pid
  `, { timeoutMs: 120000 })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try { await remoteRpc(remote, 'host.describe', {}); return } catch { await delay(1000) }
  }
  throw new Error(`${remote.id} did not boot: ${await ssh(`cat /tmp/dsh-rd-${remote.id}.log 2>/dev/null || true`)}`)
}

async function setupLocal() {
  await rm(localHome, { recursive: true, force: true })
  await mkdir(localHome, { recursive: true })
  await runHarness(['--profile', 'web', '--dump-config'], { DSH_HOME: localHome }, 60000)
  const profile = join(localHome, 'profiles/web')
  await patchProfilePackage(profile)
  await cmd('pnpm', ['install', '--no-frozen-lockfile'], { cwd: profile, env: { CI: 'true' }, timeoutMs: 120000 })
  const port = await freePort()
  const child = spawn('node', ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--trusted-host', `127.0.0.1:${port}`], { cwd: harnessRoot, env: { ...process.env, DSH_HOME: localHome, DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  started.push(child)
  child.stdout.on('data', b => { localLog += String(b) })
  child.stderr.on('data', b => { localLog += String(b) })
  localBase = `http://127.0.0.1:${port}`
  await waitHttp(`${localBase}/remote-desktop/api/sources`, 60000)
  const workspace = await localRpc('workspace.create', { path: repoRoot })
  const session = await localRpc('session.create', { workspaceId: workspace.workspace.workspaceId })
  localSessionId = session.sessionId
}

async function patchProfilePackage(profile) {
  const packagePath = join(profile, 'package.json')
  const pkg = existsSync(packagePath) ? JSON.parse(await readFile(packagePath, 'utf8')) : { name: 'dsh-p1-profile', private: true }
  pkg.dependencies = pkg.dependencies || {}
  pkg.dependencies['dsh-remote-desktop'] = `link:${resolve(repoRoot, 'packages/local')}`
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (!pkg.dsh.profile.bundles.includes('dsh-remote-desktop')) pkg.dsh.profile.bundles.push('dsh-remote-desktop')
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function copyCompanion() {
  const tar = join(artifactDir, 'companion.tar.gz')
  await cmd('tar', ['czf', tar, '-C', companionDir, '.'])
  await ssh('rm -rf /tmp/dsh-remote-desktop-companion && mkdir -p /tmp/dsh-remote-desktop-companion')
  await cmd('scp', [tar, `${sshDest}:/tmp/dsh-remote-desktop-companion.tar.gz`], { timeoutMs: 30000 })
  await ssh('tar xzf /tmp/dsh-remote-desktop-companion.tar.gz -C /tmp/dsh-remote-desktop-companion')
}

async function remoteRpc(remote, method, payload) {
  const script = `const method=${JSON.stringify(method)};const payload=${JSON.stringify(payload)};const rpcId=crypto.randomUUID();const res=await fetch('http://127.0.0.1:${remote.port}/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload})});if(!res.ok)throw new Error('HTTP '+res.status);const json=await res.json();if(!json.result?.ok)throw new Error(json.result?.error?.message||'rpc failed');console.log(JSON.stringify(json.result.value));`
  return JSON.parse(await ssh(`node --input-type=module -e ${sh(script)}`))
}
async function localRpc(method, payload) { const rpcId=randomUUID(); const res=await fetch(`${localBase}/api/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload})}); const json=await res.json(); if(!json.result?.ok) throw new Error(json.result?.error?.message||'local rpc failed'); return json.result.value }
async function sidebarApi(remote, method, payload) { const res=await fetch(`${remote.proxyOrigin}/sidebar/api/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}); const json=await res.json(); if(!json.ok) throw new Error(json.error?.message||'sidebar failed'); return json.value }
async function terminalCommand(remote, input) { const url=`${remote.proxyOrigin.replace('http://','ws://')}/sidebar/ws/terminal?sessionId=${encodeURIComponent(remote.sessionId)}&tab=p1-${Date.now()}&cwd=${encodeURIComponent(remote.sentinel)}`; return await new Promise((resolve,reject)=>{const ws=new WebSocket(url);let data='';const timer=setTimeout(()=>{ws.close();reject(new Error('terminal timeout '+data))},8000);ws.onopen=()=>ws.send(input);ws.onmessage=e=>{data+=String(e.data); if(data.includes(remote.text)){clearTimeout(timer);ws.close();resolve(data)}};ws.onerror=()=>{clearTimeout(timer);reject(new Error('terminal websocket error '+data))}}) }
async function api(path, init) { const res=await fetch(`${localBase}/remote-desktop/api${path}`,{headers:{'content-type':'application/json'},...init}); const json=await res.json(); if(!res.ok||json.ok!==true) throw new Error(json.error?.message||`HTTP ${res.status}`); return json }
async function runHarness(args, env, timeoutMs) { return cmd('pnpm', ['dsh', ...args], { cwd: harnessRoot, env, timeoutMs }) }
async function ssh(command, options={}) { return cmd('ssh', ['-o','BatchMode=yes', sshDest, command], { timeoutMs: options.timeoutMs ?? 30000 }) }
async function remoteUser() { return (await ssh('whoami')).trim() }
async function cmd(command,args,options={}) { const r=spawnSync(command,args,{cwd:options.cwd??repoRoot,env:{...process.env,...(options.env??{})},encoding:'utf8',timeout:options.timeoutMs??30000,maxBuffer:1024*1024*20}); if(r.error) throw r.error; if(r.status!==0) throw new Error(`${command} ${args.join(' ')} failed (${r.status})\n${r.stdout}\n${r.stderr}`); return r.stdout }
async function item(id,name,fn){const start=Date.now();try{const evidence=await fn(); report.push({id,name,status:'PASS',evidence,durationMs:Date.now()-start}); console.log(`PASS ${id} ${name}: ${evidence}`)}catch(e){report.push({id,name,status:'FAIL',evidence:e.message,durationMs:Date.now()-start}); console.error(`FAIL ${id} ${name}: ${e.message}`); throw new Error(`${id}: ${e.message}`)}}
async function freePort(){const s=createServer();await new Promise((res,rej)=>{s.once('error',rej);s.listen(0,'127.0.0.1',res)});const a=s.address();const p=typeof a==='object'&&a?a.port:undefined;await new Promise(res=>s.close(res));if(!p)throw new Error('no port');return p}
async function waitHttp(url,ms){const d=Date.now()+ms;while(Date.now()<d){try{const r=await fetch(url);if(r.status<500)return}catch{}await delay(500)}throw new Error('timeout '+url)}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
function sh(v){return `'${String(v).replaceAll("'","'\\''")}'`}
function parseArgs(argv){const o={};for(let i=0;i<argv.length;i++){if(argv[i].startsWith('--'))o[argv[i].slice(2)]=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:'true'}return o}
function stopStarted(){while(started.length){try{started.pop().kill('SIGTERM')}catch{}}}
function loadPlaywright(){const c=['/Users/i060912/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js',join(repoRoot,'node_modules/playwright/index.js')];for(const p of c)if(existsSync(p))return createRequire(p)('playwright');throw new Error('Playwright required')}
function findChrome(){for(const p of [process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean)) if(existsSync(p)) return p; return undefined}
async function dismissTopLevelBlockingUi(page){for(let i=0;i<3;i++){const clicked=await page.evaluate(()=>{const labels=['Configure later','Continue','Got it','OK'];const b=[...document.querySelectorAll('button')].find(x=>labels.some(l=>(x.textContent||'').includes(l)));if(!b)return false;b.click();return true}).catch(()=>false); if(!clicked)break; await page.waitForTimeout(500)} await page.keyboard.press('Escape').catch(()=>{})}
async function writeReport(){await mkdir(artifactDir,{recursive:true});await writeFile(join(artifactDir,'acceptance-report.json'),JSON.stringify({report},null,2)+'\n');await writeFile(join(artifactDir,'browser-console.log'),browserLogs.join('\n'));await writeFile(join(artifactDir,'local-dsh.log'),localLog)}
