#!/usr/bin/env node
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, readFile, writeFile, cp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const args = parseArgs(process.argv.slice(2))
const sshDest = args['ssh-dest'] ?? 'win-wsl'
const harnessRoot = resolve(args['harness-root'] ?? process.env.DSH_HARNESS_ROOT ?? join(repoRoot, '..', 'deepseek-harness'))
const remoteHome = args['remote-home'] ?? '~/.dsh-remote-desktop-test'
const remoteSentinelDir = '/tmp/dsh-remote-desktop-sentinel'
const remotePort = Number(args['remote-port'] ?? 30800)
const artifactsRoot = join(repoRoot, '.acceptance', 'artifacts')
const localHome = resolve(repoRoot, '.acceptance', 'local-home')
const localPlugin = resolve(repoRoot, 'packages/local')
const companionSource = resolve(repoRoot, 'packages/companion')
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifactDir = join(artifactsRoot, runId)
const report = []
const started = []
let browserLogs = []
let localDshLog = ''
let remoteDshLog = ''
let localPort = 0
let localBase = ''
let remoteProxyOrigin = ''
let remoteSessionId = ''
let localSessionId = ''
let sourceToken = ''

await mkdir(artifactDir, { recursive: true })
process.on('exit', stopStarted)

function stopStarted() {
  while (started.length > 0) {
    const child = started.pop()
    try { child.kill('SIGTERM') } catch {}
  }
}

try {
  await item('P0-ENV-001', 'local home isolation', async () => {
    await rm(localHome, { recursive: true, force: true })
    await mkdir(localHome, { recursive: true })
    return `local DSH_HOME=${localHome}`
  })
  await item('P0-ENV-002', 'remote home isolation', async () => {
    await ssh(`rm -rf ${sh(remoteHome)} ${sh(remoteSentinelDir)} && mkdir -p ${sh(remoteSentinelDir)}`)
    return `remote DSH_HOME=${remoteHome}`
  })
  await item('P0-ENV-003', 'ssh key-only', async () => {
    await cmd('ssh', ['-o', 'BatchMode=yes', sshDest, 'true'], { timeoutMs: 10000 })
    return `ssh BatchMode ${sshDest} succeeded`
  })

  await setupRemote()
  await setupLocal()
  await setupData()
  await runBrowserChecks()

  await item('P0-ARTIFACT-002', 'logs saved', async () => {
    await writeFile(join(artifactDir, 'local-dsh.log'), localDshLog)
    await writeFile(join(artifactDir, 'remote-dsh.log'), remoteDshLog)
    await writeFile(join(artifactDir, 'browser-console.log'), browserLogs.join('\n'))
    return 'local-dsh.log, remote-dsh.log, browser-console.log saved'
  })
  await item('P0-ARTIFACT-003', 'structured report', async () => {
    await writeFile(join(artifactDir, 'acceptance-report.json'), `${JSON.stringify({ runId, report }, null, 2)}\n`)
    return 'acceptance-report.json saved'
  })
  await writeReport()
  stopStarted()
  console.log(`\nP0 acceptance PASS. Artifacts: ${artifactDir}`)
  printCleanup()
} catch (error) {
  await writeReport().catch(() => {})
  stopStarted()
  console.error(`\nP0 acceptance FAIL: ${error.message}`)
  console.error(`Artifacts: ${artifactDir}`)
  printCleanup()
  process.exit(1)
}

async function setupRemote() {
  await item('P0-BOOT-001', 'remote dsh boots', async () => {
    const nodeVersion = (await ssh('node --version')).trim()
    const major = Number(/^v(\d+)/.exec(nodeVersion)?.[1] ?? 0)
    if (major < 22) throw new Error(`remote node ${nodeVersion} < 22`)
    await copyCompanionToRemote()
    await ssh(`set -e
      export PATH=\"$HOME/.npm-global/bin:$PATH\"
      if ! command -v dsh >/dev/null 2>&1; then npm install -g @deepseek-ai/dsh@0.1.0-rc.7; fi
      DSH_HOME=${remoteHome} dsh --profile web --dump-config >/tmp/dsh-remote-desktop-dump.txt
      cd ${remoteHome}/profiles/web
      node - <<'NODE'
const fs = require('fs')
const path = 'package.json'
const pkg = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : { name: 'remote-acceptance-profile', private: true }
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
      CI=true pnpm install --no-frozen-lockfile
      pnpm rebuild node-pty >/tmp/dsh-remote-desktop-node-pty.log 2>&1 || true
      printf 'REMOTE_SENTINEL_WIN_WSL\n' > ${remoteSentinelDir}/remote-only.txt
      if [ -f /tmp/dsh-remote-desktop-web.pid ]; then kill $(cat /tmp/dsh-remote-desktop-web.pid) 2>/dev/null || true; fi
      nohup env DSH_HOME=${remoteHome} DSH_TELEMETRY_DISABLED=1 dsh --profile web --host 127.0.0.1 --port ${remotePort} --trusted-host 127.0.0.1:${remotePort} > /tmp/dsh-remote-desktop-web.log 2>&1 & echo $! > /tmp/dsh-remote-desktop-web.pid
    `, { timeoutMs: 120000 })
    await waitForRemoteDsh()
    remoteDshLog = await ssh('cat /tmp/dsh-remote-desktop-web.log 2>/dev/null || true')
    return `remote dsh answers host.describe on 127.0.0.1:${remotePort}`
  })
}

async function setupLocal() {
  await item('P0-BOOT-002', 'local dsh boots', async () => {
    if (!existsSync(harnessRoot)) throw new Error(`harness root not found: ${harnessRoot}`)
    await runHarness(['--profile', 'web', '--dump-config'], { DSH_HOME: localHome }, 60000)
    const profile = join(localHome, 'profiles/web')
    await patchProfilePackage(profile, {
      dependency: ['dsh-remote-desktop', `link:${localPlugin}`],
      bundle: 'dsh-remote-desktop',
    })
    await cmd('pnpm', ['install', '--no-frozen-lockfile'], { cwd: profile, env: { CI: 'true' }, timeoutMs: 120000 })
    localPort = await freePort()
    const logPath = join(artifactDir, 'local-dsh-live.log')
    const child = spawn('node', ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--host', '127.0.0.1', '--port', String(localPort), '--trusted-host', `127.0.0.1:${localPort}`], {
      cwd: harnessRoot,
      env: { ...process.env, DSH_HOME: localHome, DSH_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    started.push(child)
    child.stdout.on('data', b => { localDshLog += String(b) })
    child.stderr.on('data', b => { localDshLog += String(b) })
    localBase = `http://127.0.0.1:${localPort}`
    await waitHttp(`${localBase}/remote-desktop/api/sources`, 60000)
    await writeFile(logPath, localDshLog)
    return `${localBase} booted and management API answers`
  })
  await item('P0-BOOT-003', 'tunnel connects', async () => {
    await api('/sources', { method: 'POST', body: JSON.stringify({ id: 'win-wsl', label: 'win-wsl', sshHost: sshDest, sshUser: (await remoteUser()), sshPort: 22, remoteDshHost: '127.0.0.1', remoteDshPort: remotePort }) })
    const source = (await api('/connect', { method: 'POST', body: JSON.stringify({ id: 'win-wsl' }) })).source
    if (source.state !== 'connected') throw new Error(`state=${source.state}`)
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(source.iframeUrl ?? '')) throw new Error(`bad iframeUrl ${source.iframeUrl}`)
    remoteProxyOrigin = new URL(source.iframeUrl).origin
    sourceToken = source.token
    return `connected iframeUrl=${source.iframeUrl}`
  })
}

async function setupData() {
  await item('P0-SIDEBAR-002', 'remote session visible data', async () => {
    const workspace = await remoteRpc('workspace.create', { path: remoteSentinelDir })
    const session = await remoteRpc('session.create', { workspaceId: workspace.workspace.workspaceId })
    remoteSessionId = session.sessionId
    const snapshot = await api(`/snapshot?id=win-wsl`)
    const listed = snapshot.snapshot.workspaces.items.some(ws => ws.sessionIds.includes(remoteSessionId))
    if (!listed) throw new Error(`remote session ${remoteSessionId} not in snapshot`)
    return `remote workspace ${workspace.workspace.workspaceId}, session ${remoteSessionId}`
  })
  await item('P0-PLUGIN-002', 'Explorer reads remote sentinel', async () => {
    const tree = await sidebarApi('fs.tree', { sessionId: remoteSessionId, cwd: remoteSentinelDir, path: remoteSentinelDir })
    if (!tree.entries.some(entry => entry.name === 'remote-only.txt')) throw new Error('remote-only.txt missing from fs.tree')
    return 'remote /sidebar/api/fs.tree lists remote-only.txt'
  })
  await item('P0-PLUGIN-003', 'terminal runs remotely', async () => {
    const text = await terminalCommand(remoteSessionId, `cat ${remoteSentinelDir}/remote-only.txt\n`)
    if (!text.includes('REMOTE_SENTINEL_WIN_WSL')) throw new Error(`terminal output missing sentinel: ${text}`)
    return 'terminal returned REMOTE_SENTINEL_WIN_WSL'
  })
  await item('P0-ENV-001', 'local sentinel absence setup', async () => {
    const workspace = await localRpc('workspace.create', { path: repoRoot })
    const session = await localRpc('session.create', { workspaceId: workspace.workspace.workspaceId })
    localSessionId = session.sessionId
    return `local session ${localSessionId}`
  }, { duplicateOk: true })
}

async function runBrowserChecks() {
  const { chromium } = loadPlaywright()
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', msg => browserLogs.push(`${msg.type()}: ${msg.text()}`))
  page.on('pageerror', err => browserLogs.push(`pageerror: ${err.message}`))
  try {
    await page.goto(localBase, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(8000)
    await dismissTopLevelBlockingUi(page)
    await item('P0-SIDEBAR-001', 'source list visible', async () => {
      await expectText(page, 'Local')
      await expectText(page, 'Remote: win-wsl')
      await page.screenshot({ path: join(artifactDir, '01-local-ready.png'), fullPage: true })
      return 'Local and Remote: win-wsl visible'
    })
    await item('P0-ARTIFACT-001', 'screenshots initial', async () => {
      if (!existsSync(join(artifactDir, '01-local-ready.png'))) throw new Error('01-local-ready.png missing')
      return '01-local-ready.png saved'
    })
    await item('P0-SIDEBAR-003', 'active source indication local', async () => {
      const body = await page.locator('body').innerText()
      if (!body.includes('Local') || !body.includes('active')) throw new Error('Local active indication missing')
      return 'Local active indication visible'
    })
    await item('P0-SWITCH-001', 'local to remote', async () => {
      await clickText(page, /tmp|remote-only|\(blank\)|win-wsl/)
      await page.getByText('Remote: win-wsl').first().click().catch(() => {})
      const row = page.getByText(/tmp|remote-only|\(blank\)/).first()
      if (await row.count()) await row.click()
      await page.waitForTimeout(6000)
      const frame = await remoteFrame(page)
      if (frame === undefined) throw new Error('remote iframe missing')
      await page.screenshot({ path: join(artifactDir, '02-remote-active.png'), fullPage: true })
      return `remote iframe ${frame.url()} visible`
    })
    await item('P0-IFRAME-001', 'remote origin', async () => {
      const frame = await remoteFrame(page)
      if (frame === undefined) throw new Error('remote iframe missing')
      const origin = new URL(frame.url()).origin
      if (origin === localBase) throw new Error(`origin equals local ${origin}`)
      return `${origin} != ${localBase}`
    })
    await item('P0-SWITCH-002', 'remote open command', async () => {
      const result = await page.evaluate(async ({ token, sessionId, origin }) => {
        const frame = [...document.querySelectorAll('iframe')].find(f => f.src.includes('dshRemoteDesktop=1'))
        if (!frame?.contentWindow) return { ok: false, reason: 'no iframe' }
        return await new Promise(resolve => {
          const timer = setTimeout(() => { window.removeEventListener('message', onMessage); resolve({ ok: false, reason: 'timeout' }) }, 5000)
          function onMessage(event) {
            if (event.origin !== origin) return
            if (event.data?.type === 'dsh-remote-desktop/opened' && event.data.sessionId === sessionId) {
              clearTimeout(timer)
              window.removeEventListener('message', onMessage)
              resolve({ ok: true })
            }
          }
          window.addEventListener('message', onMessage)
          frame.contentWindow.postMessage({ type: 'dsh-remote-desktop/open-session', token, sessionId }, origin)
        })
      }, { token: sourceToken, sessionId: remoteSessionId, origin: remoteProxyOrigin })
      if (!result.ok) throw new Error(result.reason ?? 'no opened ack')
      return `opened ${remoteSessionId}`
    })
    await item('P0-IFRAME-002', 'companion marker', async () => {
      const frame = await mustRemoteFrame(page)
      const count = await frame.locator('body[data-dsh-remote-desktop-child="true"]').count()
      if (count < 1) throw new Error('companion marker missing')
      return 'body marker present'
    })
    await item('P0-IFRAME-003', 'remote left sidebar hidden', async () => {
      const frame = await mustRemoteFrame(page)
      const visible = await frame.locator('[class*="sidebarCol"]').evaluateAll(nodes => nodes.some(n => getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 10))
      if (visible) throw new Error('iframe sidebarCol still visible')
      await expectText(page, 'Local')
      return 'iframe sidebar hidden, top-level Local still visible'
    })
    await item('P0-IFRAME-004', 'remote main area visible', async () => {
      const frame = await mustRemoteFrame(page)
      const text = await frame.locator('body').innerText()
      if (!/DeepSeek Harness|Describe what|Continue|Standard mode|Code mode/.test(text)) throw new Error(`remote main text not found: ${text.slice(0, 200)}`)
      return 'remote main area text visible'
    })
    await item('P0-PLUGIN-001', 'Better Sidebar mounted in iframe', async () => {
      const frame = await mustRemoteFrame(page)
      const count = await frame.locator('[data-dsh-better-sidebar]').count()
      if (count < 1) throw new Error('Better Sidebar host missing')
      return 'data-dsh-better-sidebar present'
    })
    await item('P0-SIDEBAR-003', 'active source indication remote', async () => {
      const body = await page.locator('body').innerText()
      if (!body.includes('Remote: win-wsl') || !body.includes('connected')) throw new Error('remote status missing')
      return 'Remote: win-wsl connected visible'
    }, { duplicateOk: true })
    await item('P0-SWITCH-003', 'remote to local', async () => {
      await page.getByText('Local').first().click()
      await page.waitForTimeout(1000)
      const visible = await page.locator('iframe').first().evaluate(frame => getComputedStyle(frame).display !== 'none').catch(() => false)
      if (visible) throw new Error('remote iframe still visible after Local click')
      await page.screenshot({ path: join(artifactDir, '03-local-restored.png'), fullPage: true })
      return 'iframe hidden after Local click'
    })
    await item('P0-PLUGIN-004', 'local explorer not polluted', async () => {
      const body = await page.locator('body').innerText()
      if (body.includes('REMOTE_SENTINEL_WIN_WSL') || body.includes('remote-only.txt')) throw new Error('remote sentinel visible in local state')
      return 'remote sentinel absent after Local click'
    })
    await item('P0-SWITCH-004', 'repeated switching', async () => {
      for (let i = 0; i < 2; i += 1) {
        await page.getByText('Remote: win-wsl').first().click()
        await page.waitForTimeout(600)
        let visible = await page.locator('iframe').first().evaluate(frame => getComputedStyle(frame).display !== 'none')
        if (!visible) throw new Error(`iframe hidden on remote iteration ${i}`)
        await page.getByText('Local').first().click()
        await page.waitForTimeout(600)
        visible = await page.locator('iframe').first().evaluate(frame => getComputedStyle(frame).display !== 'none')
        if (visible) throw new Error(`iframe still visible on local iteration ${i}`)
      }
      return 'two local/remote cycles completed'
    })
    await item('P0-ARTIFACT-001', 'screenshots saved', async () => {
      for (const file of ['01-local-ready.png', '02-remote-active.png', '03-local-restored.png']) {
        if (!existsSync(join(artifactDir, file))) throw new Error(`${file} missing`)
      }
      return 'required screenshots saved'
    }, { duplicateOk: true })
  } catch (error) {
    await page.screenshot({ path: join(artifactDir, 'failure-current.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await browser.close()
  }
}

async function patchProfilePackage(profile, { dependency, bundle }) {
  const packagePath = join(profile, 'package.json')
  let pkg = existsSync(packagePath) ? JSON.parse(await readFile(packagePath, 'utf8')) : { name: 'dsh-acceptance-profile', private: true }
  pkg.dependencies = pkg.dependencies || {}
  pkg.dependencies[dependency[0]] = dependency[1]
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (!pkg.dsh.profile.bundles.includes(bundle)) pkg.dsh.profile.bundles.push(bundle)
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function copyCompanionToRemote() {
  const tar = join(artifactDir, 'companion.tar.gz')
  await cmd('tar', ['czf', tar, '-C', companionSource, '.'])
  await ssh('rm -rf /tmp/dsh-remote-desktop-companion && mkdir -p /tmp/dsh-remote-desktop-companion')
  await cmd('scp', [tar, `${sshDest}:/tmp/dsh-remote-desktop-companion.tar.gz`], { timeoutMs: 30000 })
  await ssh('tar xzf /tmp/dsh-remote-desktop-companion.tar.gz -C /tmp/dsh-remote-desktop-companion')
}

async function waitForRemoteDsh() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      await remoteRpc('host.describe', {})
      return
    } catch {
      await delay(1000)
    }
  }
  remoteDshLog = await ssh('cat /tmp/dsh-remote-desktop-web.log 2>/dev/null || true').catch(() => '')
  throw new Error(`remote dsh did not boot. Log:\n${remoteDshLog}`)
}

async function remoteRpc(method, payload) {
  const script = `
const method = ${JSON.stringify(method)};
const payload = ${JSON.stringify(payload)};
const rpcId = crypto.randomUUID();
const res = await fetch('http://127.0.0.1:${remotePort}/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method, payload }) });
if (!res.ok) throw new Error('HTTP ' + res.status);
const json = await res.json();
if (!json.result?.ok) throw new Error(json.result?.error?.message || 'rpc failed');
console.log(JSON.stringify(json.result.value));
`
  return JSON.parse(await ssh(`node --input-type=module -e ${sh(script)}`))
}

async function localRpc(method, payload) {
  const rpcId = randomUUID()
  const res = await fetch(`${localBase}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method, payload }) })
  if (!res.ok) throw new Error(`local ${method} HTTP ${res.status}`)
  const json = await res.json()
  if (!json.result?.ok) throw new Error(json.result?.error?.message || `local ${method} failed`)
  return json.result.value
}

async function sidebarApi(method, payload) {
  const res = await fetch(`${remoteProxyOrigin}/sidebar/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok !== true) throw new Error(json?.error?.message || `sidebar ${method} HTTP ${res.status}`)
  return json.value
}

async function terminalCommand(sessionId, input) {
  const url = `${remoteProxyOrigin.replace('http://', 'ws://')}/sidebar/ws/terminal?sessionId=${encodeURIComponent(sessionId)}&tab=acceptance-terminal-${Date.now()}&cwd=${encodeURIComponent(remoteSentinelDir)}`
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let data = ''
    const timer = setTimeout(() => { ws.close(); reject(new Error(`terminal timeout: ${data}`)) }, 8000)
    ws.onopen = () => { ws.send(input) }
    ws.onmessage = event => {
      data += String(event.data)
      if (data.includes('REMOTE_SENTINEL_WIN_WSL')) {
        clearTimeout(timer)
        ws.close()
        resolve(data)
      }
    }
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`terminal websocket error: ${data}`)) }
  })
}

async function api(path, init) {
  const res = await fetch(`${localBase}/remote-desktop/api${path}`, { headers: { 'content-type': 'application/json' }, ...init })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok !== true) throw new Error(json?.error?.message || `management ${path} HTTP ${res.status}`)
  return json
}

async function item(id, name, fn, options = {}) {
  if (!options.duplicateOk && report.some(row => row.id === id)) throw new Error(`duplicate acceptance item ${id}`)
  const start = Date.now()
  try {
    const evidence = await fn()
    report.push({ id, name, status: 'PASS', evidence, durationMs: Date.now() - start })
    console.log(`PASS ${id} ${name}: ${evidence}`)
  } catch (error) {
    report.push({ id, name, status: 'FAIL', evidence: error.message, durationMs: Date.now() - start })
    console.error(`FAIL ${id} ${name}: ${error.message}`)
    throw new Error(`${id}: ${error.message}`)
  }
}

async function runHarness(args, env, timeoutMs) {
  return await cmd('pnpm', ['dsh', ...args], { cwd: harnessRoot, env, timeoutMs })
}

async function ssh(command, options = {}) {
  return await cmd('ssh', ['-o', 'BatchMode=yes', sshDest, command], { timeoutMs: options.timeoutMs ?? 30000 })
}

async function remoteUser() {
  return (await ssh('whoami')).trim()
}

async function cmd(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    maxBuffer: 1024 * 1024 * 20,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

function sh(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) out[arg.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
  }
  return out
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : undefined
  await new Promise(resolve => server.close(resolve))
  if (port === undefined) throw new Error('no free port')
  return port
}

async function waitHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {}
    await delay(500)
  }
  throw new Error(`timed out waiting for ${url}`)
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function loadPlaywright() {
  const candidates = [
    join(repoRoot, 'node_modules/playwright/index.js'),
    '/Users/i060912/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return createRequire(candidate)('playwright')
  }
  throw new Error('Playwright is required for acceptance. Install playwright or run inside the Codex desktop runtime.')
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean)
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return undefined
}

async function dismissTopLevelBlockingUi(page) {
  for (let i = 0; i < 3; i += 1) {
    const clicked = await page.evaluate(() => {
      const labels = ['Configure later', 'Continue', 'Got it', 'OK']
      const buttons = [...document.querySelectorAll('button')]
      const button = buttons.find(item => labels.some(label => (item.textContent || '').includes(label)))
      if (button === undefined) return false
      button.click()
      return true
    }).catch(() => false)
    if (!clicked) break
    await page.waitForTimeout(700)
  }
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(300)
}

async function expectText(page, text) {
  const count = await page.getByText(text).count()
  if (count < 1) throw new Error(`text not found: ${text}`)
}

async function clickText(page, pattern) {
  const locator = page.getByText(pattern).first()
  if (await locator.count()) await locator.click()
}

async function remoteFrame(page) {
  return page.frames().find(frame => frame.url().includes('dshRemoteDesktop=1'))
}

async function mustRemoteFrame(page) {
  const frame = await remoteFrame(page)
  if (frame === undefined) throw new Error('remote frame missing')
  return frame
}

async function writeReport() {
  await mkdir(artifactDir, { recursive: true })
  await writeFile(join(artifactDir, 'acceptance-report.json'), `${JSON.stringify({ runId, report }, null, 2)}\n`)
  await writeFile(join(artifactDir, 'browser-console.log'), browserLogs.join('\n'))
  await writeFile(join(artifactDir, 'local-dsh.log'), localDshLog)
  remoteDshLog ||= await ssh('cat /tmp/dsh-remote-desktop-web.log 2>/dev/null || true').catch(() => '')
  await writeFile(join(artifactDir, 'remote-dsh.log'), remoteDshLog)
}

function printCleanup() {
  console.log('\nCleanup commands:')
  console.log('rm -rf .acceptance/local-home .acceptance/artifacts')
  console.log(`${`ssh ${sshDest} `}${sh(`rm -rf ${remoteHome} ${remoteSentinelDir}`)}`)
}
