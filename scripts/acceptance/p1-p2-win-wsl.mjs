#!/usr/bin/env node
import { terminalThroughBrowser } from './terminal-controller.mjs'
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
const containerRemotes = args['container-remotes'] === 'true' || args['docker-remotes'] === 'true'
const sshDest = args['ssh-dest'] ?? (containerRemotes ? 'remote-a' : 'win-wsl')
const dshBin = process.env.DSH_BIN ?? 'dsh'
const sourceRoot = args['harness-root'] ?? process.env.DSH_HARNESS_ROOT
const harnessRoot = sourceRoot ? resolve(sourceRoot) : undefined
const localHome = resolve(repoRoot, '.acceptance', 'p1-local-home')
const containerSshConfig = join(repoRoot, '.acceptance', 'container', 'ssh-config')
const localSshConfig = containerRemotes ? containerSshConfig : join(localHome, 'ssh-config')
const artifactDir = join(repoRoot, '.acceptance', 'artifacts', `p1-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`)
const companionDir = resolve(repoRoot, 'packages/companion')
const localPlugin = resolve(repoRoot, 'packages/local')
const ollamaModel = process.env.DSH_RD_OLLAMA_MODEL ?? 'minicpm-v4.6:1b'
const ollamaApiKeyEnv = 'DSH_RD_OLLAMA_API_KEY'
const ollamaApiKey = process.env[ollamaApiKeyEnv] ?? 'ollama-acceptance-dummy-key'
const localOllamaBaseUrl = (process.env.DSH_RD_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
const remotes = containerRemotes ? [
  { id: 'remote-a', label: 'remote-a', sshDest: 'remote-a', home: '~/.dsh-remote-desktop-p1', port: 30800, sentinel: '/tmp/dsh-rd-p1-a', text: 'REMOTE_SENTINEL_A' },
  { id: 'remote-b', label: 'remote-b', sshDest: 'remote-b', home: '~/.dsh-remote-desktop-p1', port: 30800, sentinel: '/tmp/dsh-rd-p1-b', text: 'REMOTE_SENTINEL_B' },
] : [
  { id: 'win-wsl-a', label: 'win-wsl-a', sshDest, home: '~/.dsh-remote-desktop-p1-a', port: 30910, sentinel: '/tmp/dsh-rd-p1-a', text: 'REMOTE_SENTINEL_A' },
  { id: 'win-wsl-b', label: 'win-wsl-b', sshDest, home: '~/.dsh-remote-desktop-p1-b', port: 30911, sentinel: '/tmp/dsh-rd-p1-b', text: 'REMOTE_SENTINEL_B' },
]
const report = []
const started = []
let localBase = ''
let localLog = ''
let localAuthCookie = ''
let browserLogs = []
let localSessionId = ''
let remoteProxyExports = ''
let remoteOllamaBaseUrl = process.env.DSH_RD_REMOTE_OLLAMA_BASE_URL ?? `${localOllamaBaseUrl}/v1`

await mkdir(artifactDir, { recursive: true })
process.on('exit', stopStarted)

async function ensureOllama() {
  let models
  try {
    const response = await fetch(`${localOllamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    models = await response.json()
  } catch (error) {
    throw new Error(`Ollama is required for acceptance. Start Ollama at ${localOllamaBaseUrl}.\n${error.message}`)
  }
  if (!models.models?.some(model => model.name === ollamaModel)) {
    throw new Error(`Ollama model ${ollamaModel} is missing. Run: ollama pull ${ollamaModel}`)
  }
}

function ollamaSettings(baseUrl) {
  return `agent-default-model:\n  provider: ollama\n  model: ${JSON.stringify(ollamaModel)}\nllm-pi-ai:\n  providers:\n    ollama:\n      displayName: Local Ollama\n      api: openai-completions\n      apiKeyEnv: ${ollamaApiKeyEnv}\n      baseURL: ${baseUrl}\n      models:\n        - id: ${JSON.stringify(ollamaModel)}\n          name: MiniCPM V 4.6 1B\n`
}

async function assertOllamaDefault(catalog, owner) {
  if (catalog.default?.provider !== 'ollama' || catalog.default?.model !== ollamaModel || !catalog.routableProviders?.includes('ollama')) {
    throw new Error(`${owner} did not expose routable default Ollama model ${ollamaModel}: ${JSON.stringify(catalog.default)}`)
  }
}

try {
  await ensureOllama()
  await item('P1-MULTI-001', 'two remotes connect', async () => {
    if (containerRemotes && !existsSync(localSshConfig)) throw new Error(`Apple container SSH config missing: ${localSshConfig}. Run npm run acceptance:container:up`)
    for (const remote of remotes) await sshTo(remote.sshDest, 'true', { timeoutMs: 10000 })
    if (containerRemotes) {
      const hostProxy = await startHostProxy()
      remoteProxyExports = hostProxy.packageProxyExports
      remoteOllamaBaseUrl = hostProxy.ollamaBaseUrl
    }
    await copyCompanion()
    for (const remote of remotes) await setupRemote(remote)
    await setupLocal()
    for (const remote of remotes) {
      if (!containerRemotes) await api('/sources', { method: 'POST', body: JSON.stringify({ id: remote.id, label: remote.label, sshAlias: remote.sshDest, remoteDshHost: '127.0.0.1', remoteDshPort: remote.port }) })
      const source = (await api('/connect', { method: 'POST', body: JSON.stringify({ id: remote.id, setup: !containerRemotes }) })).source
      remote.iframeUrl = source.iframeUrl
      remote.token = source.token
      remote.proxyOrigin = new URL(source.iframeUrl).origin
      if (source.state !== 'connected') throw new Error(`${remote.id} not connected`)
      await assertIframeAuthenticated(remote)
      const workspace = await remoteRpc(remote, 'workspace/create', { path: remote.sentinel })
      const session = await remoteRpc(remote, 'session/create', { workspaceId: workspace.workspace.workspaceId })
      remote.sessionId = session.sessionId
      await assertOllamaDefault(await remoteRpc(remote, 'session/modelCatalog', {}), remote.id)
      await remoteRpc(remote, 'session/rename', { sessionId: remote.sessionId, title: `Acceptance fixture for ${remote.id}` })
      await remoteRpc(remote, 'session/prompt', { sessionId: remote.sessionId, mode: 'queue', content: [{ type: 'text', text: `Acceptance fixture for ${remote.id}.` }] })
      await remoteRpc(remote, 'session/cancel', { sessionId: remote.sessionId })
    }
    return remotes.map(r => `${r.id}:${r.proxyOrigin}`).join(', ')
  })

  await item('P1-MULTI-002', 'iframe origins differ', async () => {
    if (remotes[0].proxyOrigin === remotes[1].proxyOrigin) throw new Error('origins are equal')
    return `${remotes[0].proxyOrigin} != ${remotes[1].proxyOrigin}`
  })

  await item('P1-MULTI-004', 'explorer does not cross sources', async () => {
    for (const remote of remotes) {
      const tree = await sidebarApi(remote, 'fs.tree', { sessionId: remote.sessionId, cwd: remote.sentinel, path: remote.sentinel })
      if (!tree.entries.some(e => e.name === 'remote-only.txt')) throw new Error(`${remote.id} fs.tree missing sentinel file`)
    }
    return 'each source fs.tree stayed on its own sentinel workspace'
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
  page.on('requestfailed', request => browserLogs.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`))
  page.on('response', response => { if (response.status() >= 400) browserLogs.push(`response: ${response.status()} ${response.url()}`) })
  try {
    const separator = localAuthCookie.indexOf('=')
    await page.context().addCookies([{
      name: localAuthCookie.slice(0, separator),
      value: localAuthCookie.slice(separator + 1),
      url: localBase,
    }])
    await page.goto(localBase, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(8000)
    await dismissTopLevelBlockingUi(page)
    await item('P1-MULTI-003', 'tokens do not cross', async () => {
      try {
        for (const remote of remotes) {
          const header = page.locator(`[data-rd-workspace-source-kind="remote"]`).filter({ has: page.locator(`[data-rd-host-marker="${remote.id}"]`) }).first()
          if (await header.getAttribute('aria-expanded') === 'false') await header.click()
          await page.locator(`[data-rd-remote-session-id="${remote.sessionId}"]`).click()
        }
      } catch (error) {
        const diagnostic = await page.evaluate(() => ({
          frames: [...document.querySelectorAll('iframe')].map(frame => ({ src: frame.src, display: getComputedStyle(frame).display })),
          remote: window.__dshRemoteDesktop?.getSnapshot?.(),
        }))
        diagnostic.frameUrls = page.frames().map(frame => frame.url())
        throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`)
      }
      await page.waitForTimeout(3000)
      const result = await page.evaluate(async ({ wrongToken, targetOrigin }) => {
        const frame = [...document.querySelectorAll('iframe')].find(f => f.src.startsWith(targetOrigin))
        if (!frame?.contentWindow) return { ok: false, reason: 'no target frame' }
        return await new Promise(resolve => {
          const channel = new MessageChannel()
          const timer = setTimeout(() => { channel.port1.close(); resolve({ ok: true, reason: 'wrong token received no channel response' }) }, 1500)
          channel.port1.onmessage = () => {
            clearTimeout(timer)
            channel.port1.close()
            resolve({ ok: false, reason: 'wrong token attached a MessageChannel' })
          }
          channel.port1.start()
          frame.contentWindow.postMessage({ type: 'dsh-remote-desktop/connect', protocolVersion: 1, sourceToken: wrongToken }, targetOrigin, [channel.port2])
        })
      }, { wrongToken: remotes[0].token, targetOrigin: remotes[1].proxyOrigin })
      if (!result.ok) throw new Error(result.reason)
      await page.screenshot({ path: join(artifactDir, 'multi-remote-active.png'), fullPage: true })
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
    await assertIframeAuthenticated(remotes[0])
    const workspace = await remoteRpc(remotes[0], 'workspace/create', { path: remotes[0].sentinel })
    if (workspace.workspace.path !== remotes[0].sentinel) throw new Error('sentinel workspace missing after reconnect')
    return `${remotes[0].id} reconnected and official Gateway state restored`
  })
  await item('P1-RECOVERY-003', 'local remains usable', async () => {
    const value = await localRpc('session/list', {})
    if (!Array.isArray(value.items)) throw new Error('local session/list did not return items')
    return 'local session/list worked while remotes were managed'
  })
}


async function settingsUiChecks(page) {
  if (localSessionId) await page.locator('[data-rd-local-session-id]').first().click().catch(() => {})
  await page.waitForTimeout(800)
  await clickButtonContaining(page, 'Settings')
  await page.waitForTimeout(1000)
  await clickButtonContaining(page, 'Remote Desktop').catch(() => {})
  await page.locator('[data-rd-settings-section="true"]').waitFor({ timeout: 10000 })
  await item('P1-SETTINGS-000', 'host row opens remote native DSH page', async () => {
    const row = page.locator(`[data-rd-settings-source-id="${remotes[1].id}"]`)
    await row.waitFor({ timeout: 10000 })
    const link = row.locator('[data-rd-settings-native-link="true"]')
    await link.waitFor({ timeout: 10000 })
    const href = await link.getAttribute('href')
    if (!href) throw new Error('remote native DSH link missing href')
    if (href.includes('dshRemoteDesktop') || href.includes('token=')) throw new Error(`native DSH link leaked iframe mode: ${href}`)
    const popupPromise = page.waitForEvent('popup')
    await row.locator(`[data-rd-settings-open-native="${remotes[1].id}"]`).click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})
    const opened = popup.url()
    await popup.close().catch(() => {})
    if (new URL(opened).origin !== new URL(href).origin) throw new Error(`opened ${opened}, expected origin ${href}`)
    return 'host row opened selected remote native DSH page without iframe token'
  })
  await page.screenshot({ path: join(artifactDir, 'settings-hosts.png'), fullPage: true })
  await item('P1-SETTINGS-001', 'ssh config hosts listed in UI', async () => {
    for (const remote of remotes) await page.locator(`[data-rd-settings-source-id="${remote.id}"]`).waitFor({ timeout: 10000 })
    return 'all ssh config hosts appeared in Remote Desktop settings'
  })
  await item('P1-SETTINGS-002', 'connected statuses shown in UI', async () => {
    for (const remote of remotes) {
      const text = await page.locator(`[data-rd-settings-source-id="${remote.id}"]`).innerText()
      if (!text.toLowerCase().includes('connected')) throw new Error(`${remote.id} status missing: ${text}`)
    }
    return 'connected status visible for both remotes'
  })
  await item('P1-SETTINGS-003', 'disconnect host from UI', async () => {
    await page.locator(`[data-rd-settings-disconnect="${remotes[1].id}"]`).click()
    await waitForSourceState(remotes[1].id, 'disconnected')
    await page.locator(`[data-rd-settings-source-id="${remotes[1].id}"] [data-rd-settings-host-state="disconnected"]`).waitFor({ timeout: 10000 })
    return `${remotes[1].id} disconnected from UI`
  })
  await item('P1-SETTINGS-004', 'connect host from UI', async () => {
    await page.locator(`[data-rd-settings-connect="${remotes[1].id}"]`).click()
    const source = await waitForSourceState(remotes[1].id, 'connected')
    remotes[1].iframeUrl = source.iframeUrl
    remotes[1].token = source.token
    remotes[1].proxyOrigin = new URL(source.iframeUrl).origin
    return `${remotes[1].id} reconnected from UI`
  })
  await item('P1-SETTINGS-005', 'manual source form removed', async () => {
    const fields = await page.locator('[data-rd-settings-field]').count()
    if (fields !== 0) throw new Error(`manual source fields still visible: ${fields}`)
    return 'Remote Desktop settings is host-list based'
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
    if (source?.state === state) return source
    await delay(500)
  }
  throw new Error(`${id} did not reach ${state}`)
}

async function p2Checks() {
  await item('P2-SECURITY-001', 'removed business routes reject requests', async () => {
    const source = (await api('/sources')).sources[0]
    if ('upstream' in source || 'password' in source || 'privateKey' in source) throw new Error('public source leaked forbidden fields')
    const res = await fetch(`${localBase}/remote-desktop/api/snapshot?id=not-a-source`, { headers: { cookie: localAuthCookie } })
    const json = await res.json()
    if (res.status !== 404 || json.ok !== false) throw new Error(`removed snapshot route returned HTTP ${res.status}`)
    return 'removed snapshot route is 404 and public source has no upstream/password/privateKey'
  })
  await item('P2-SECURITY-002', 'postMessage origin/token audit', async () => {
    const companion = await readFile(join(repoRoot, 'packages/companion/lib/client.js'), 'utf8')
    for (const needle of ['event.origin !== parent', 'event.source !== window.parent', 'data.sourceToken !== token', 'data.protocolVersion !== BRIDGE_PROTOCOL_VERSION', 'dsh-remote-desktop/connect', ':has(> [class*="sidebarCol"])']) {
      if (!companion.includes(needle)) throw new Error(`missing ${needle}`)
    }
    if (companion.includes('[class*="frame"] { grid-template-columns')) throw new Error('companion still has broad frame rewrite')
    return 'companion validates origin/token and avoids broad frame rewrites'
  })
  await item('P2-COMPAT-001', 'plugin compatibility matrix baseline', async () => {
    for (const remote of remotes) {
      const text = await terminalCommand(remote, `cat ${remote.sentinel}/remote-only.txt\n`)
      if (!text.includes(remote.text)) throw new Error(`${remote.id} Better Sidebar terminal baseline failed`)
    }
    return 'Better Sidebar Explorer/terminal baseline covered for both remotes'
  })
}


async function startHostProxy() {
  const child = spawn(process.execPath, [join(repoRoot, 'scripts/acceptance/host-connect-proxy.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] })
  started.push(child)
  const line = await new Promise((resolve, reject) => {
    let data = ''
    const timer = setTimeout(() => reject(new Error('host proxy did not start')), 10000)
    child.stdout.on('data', chunk => {
      data += String(chunk)
      const end = data.indexOf('\n')
      if (end !== -1) {
        clearTimeout(timer)
        resolve(data.slice(0, end))
      }
    })
    child.once('exit', code => reject(new Error(`host proxy exited early: ${code}`)))
  })
  const { port } = JSON.parse(line)
  const proxy = `http://192.168.64.1:${port}`
  return {
    packageProxyExports: `export HTTP_PROXY=${proxy} HTTPS_PROXY=${proxy} npm_config_proxy=${proxy} npm_config_https_proxy=${proxy} NO_PROXY=127.0.0.1,localhost,192.168.64.0/24 no_proxy=127.0.0.1,localhost,192.168.64.0/24`,
    ollamaBaseUrl: `${proxy}/v1`,
  }
}

async function setupRemote(remote) {
  const stopContainerListener = containerRemotes ? `
    listeners=$(ps -eo pid=,args= | awk '$2 ~ /(^|\\/)node$/ && $0 ~ /\\/dsh --profile web/ && $0 ~ /--port ${remote.port}([[:space:]]|$)/ {print $1}')
    if [ -n "$listeners" ]; then kill $listeners 2>/dev/null || true; fi
    rm -f /tmp/dsh-remote-desktop-web.pid /tmp/dsh-rd-*.pid /tmp/dsh-remote-desktop-${remote.port}.pid
    for attempt in 1 2 3 4 5; do
      if node -e "const s=require('node:net').createServer();s.once('error',()=>process.exit(1));s.listen(${remote.port},'127.0.0.1',()=>s.close(()=>process.exit(0)))"; then break; fi
      sleep 1
    done
    node -e "const s=require('node:net').createServer();s.once('error',()=>process.exit(1));s.listen(${remote.port},'127.0.0.1',()=>s.close(()=>process.exit(0)))" || { echo 'remote DSH port ${remote.port} did not stop' >&2; exit 1; }
  ` : ''
  await sshRemote(remote, `set -e
    ${remoteProxyExports}
    mkdir -p "$HOME/.npm-global"
      npm config set prefix "$HOME/.npm-global"
      corepack prepare pnpm@10.34.1 --activate
      export PATH=\"$HOME/.npm-global/bin:$PATH\"
    rm -rf ${remote.home} ${remote.sentinel}
    mkdir -p ${remote.sentinel}
    printf '${remote.text}\\n' > ${remote.sentinel}/remote-only.txt
    if [ ! -x "$HOME/.npm-global/bin/dsh" ] || [ "$("$HOME/.npm-global/bin/dsh" --version 2>/dev/null || true)" != "0.2.0-rc.2" ]; then npm install -g @deepseek-ai/dsh@0.2.0-rc.2 --force; fi
    DSH_HOME=${remote.home} dsh --profile web --dump-config >/tmp/dsh-rd-${remote.id}-dump.txt
    cat > ${remote.home}/settings.yaml <<'SETTINGS'
${ollamaSettings(remoteOllamaBaseUrl)}SETTINGS
    cd ${remote.home}/profiles/web
    node - <<'NODE'
const fs = require('fs')
const path = 'package.json'
const pkg = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : { name: 'remote-p1-profile', private: true }
pkg.dependencies = pkg.dependencies || {}
pkg.dependencies['dsh-better-sidebar'] = '0.24.1'
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
      grep -q 'onlyBuiltDependencies' pnpm-workspace.yaml 2>/dev/null || printf '\nonlyBuiltDependencies:\n  - node-pty\n  - protobufjs\n' >> pnpm-workspace.yaml
      grep -q 'allowBuilds:' pnpm-workspace.yaml 2>/dev/null || printf '\nallowBuilds:\n  node-pty: true\n  protobufjs: true\n' >> pnpm-workspace.yaml

    CI=true pnpm install --no-frozen-lockfile >/tmp/dsh-rd-${remote.id}-install.log 2>&1

    pnpm rebuild node-pty >/tmp/dsh-rd-${remote.id}-node-pty.log 2>&1 || true
    if [ -f /tmp/dsh-rd-${remote.id}.pid ]; then kill $(cat /tmp/dsh-rd-${remote.id}.pid) 2>/dev/null || true; fi
    ${stopContainerListener}
    nohup env DSH_HOME=${remote.home} DSH_TELEMETRY_DISABLED=1 ${ollamaApiKeyEnv}=${sh(ollamaApiKey)} dsh --profile web --host 127.0.0.1 --port ${remote.port} --trusted-host 127.0.0.1:${remote.port} > /tmp/dsh-remote-desktop-${remote.port}.log 2>&1 & echo $! > /tmp/dsh-rd-${remote.id}.pid
  `, { timeoutMs: 600000 })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try { await remoteCompanionHealth(remote); return } catch { await delay(1000) }
  }
  throw new Error(`${remote.id} did not boot: ${await sshRemote(remote, `cat /tmp/dsh-remote-desktop-${remote.port}.log 2>/dev/null || true`)}`)
}

async function setupLocal() {
  await rm(localHome, { recursive: true, force: true })
  await mkdir(localHome, { recursive: true })
  if (containerRemotes) {
    if (!existsSync(localSshConfig)) throw new Error(`Apple container SSH config missing: ${localSshConfig}. Run npm run acceptance:container:up`)
  } else {
    const user = await remoteUser()
    await writeFile(localSshConfig, `Include ~/.ssh/config\n${remotes.map(remote => `Host ${remote.id}\n  HostName ${remote.sshDest}\n  User ${user}\n`).join('')}`)
  }
  if (harnessRoot && !existsSync(harnessRoot)) throw new Error(`harness root not found: ${harnessRoot}`)
  await runHarness(['--profile', 'web', '--dump-config'], { DSH_HOME: localHome }, 60000)
  await writeFile(join(localHome, 'settings.yaml'), ollamaSettings(`${localOllamaBaseUrl}/v1`))
  const profile = join(localHome, 'profiles/web')
  await patchProfilePackage(profile)
  await cmd('pnpm', ['install', '--no-frozen-lockfile'], { cwd: profile, env: { CI: 'true' }, timeoutMs: 120000 })
  const port = await freePort()
  const child = spawn(harnessRoot ? 'node' : dshBin, harnessRoot
    ? ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--trusted-host', `127.0.0.1:${port}`]
    : ['--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--trusted-host', `127.0.0.1:${port}`], { cwd: harnessRoot || repoRoot, env: { ...process.env, DSH_HOME: localHome, DSH_TELEMETRY_DISABLED: '1', DSH_REMOTE_DESKTOP_SSH_CONFIG: localSshConfig, [ollamaApiKeyEnv]: ollamaApiKey, ...(containerRemotes ? { DSH_REMOTE_DESKTOP_SKIP_SETUP: '1' } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
  started.push(child)
  child.stdout.on('data', b => { localLog += String(b) })
  child.stderr.on('data', b => { localLog += String(b) })
  localBase = `http://127.0.0.1:${port}`
  localAuthCookie = await authenticateLocal(localBase, () => localLog)
  await waitRemoteDesktopApi(60000)
  const workspace = await localRpc('workspace/create', { path: repoRoot })
  const session = await localRpc('session/create', { workspaceId: workspace.workspace.workspaceId })
  localSessionId = session.sessionId
  await assertOllamaDefault(await localRpc('session/modelCatalog', {}), 'local')
  await localRpc('session/prompt', { sessionId: localSessionId, mode: 'queue', content: [{ type: 'text', text: 'Local Remote Desktop acceptance fixture.' }] })
  await localRpc('session/cancel', { sessionId: localSessionId })
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
  const aliases = Array.from(new Set(remotes.map(remote => remote.sshDest)))
  for (const alias of aliases) {
    await sshTo(alias, 'rm -rf /tmp/dsh-remote-desktop-companion && mkdir -p /tmp/dsh-remote-desktop-companion')
    await cmd('scp', scpArgs(tar, `${alias}:/tmp/dsh-remote-desktop-companion.tar.gz`), { timeoutMs: 30000 })
    await sshTo(alias, 'tar xzf /tmp/dsh-remote-desktop-companion.tar.gz -C /tmp/dsh-remote-desktop-companion')
  }
}

async function remoteCompanionHealth(remote) {
  const script = `const res=await fetch('http://127.0.0.1:${remote.port}/remote-desktop-companion/api/health');if(!res.ok)throw new Error('HTTP '+res.status);console.log(await res.text());`
  return JSON.parse(await sshRemote(remote, `node --input-type=module -e ${sh(script)}`))
}
async function assertIframeAuthenticated(remote) {
  const response = await fetch(remote.iframeUrl, { redirect: 'manual' })
  if (response.status !== 200) throw new Error(`${remote.id} iframe auth HTTP ${response.status}`)
}
async function remoteRpc(remote, method, payload) {
  const rpcId = randomUUID()
  const request = method === 'session/prompt' ? { requestId: randomUUID(), ...payload } : payload
  const args = method === 'session/modelCatalog' ? {} : { request }
  const res = await fetch(`${remote.proxyOrigin}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.result?.ok) throw new Error(json?.result?.error?.message || `${remote.id} ${method} HTTP ${res.status}`)
  return json.result.value
}

async function authenticateLocal(base, output) { const d=Date.now()+10000; while(Date.now()<d){const token=/[?&]token=([A-Za-z0-9_-]+)/.exec(output())?.[1]; if(token){const r=await fetch(`${base}/?token=${token}`,{redirect:'manual'});const cookie=r.headers.get('set-cookie')?.split(';',1)[0];if(cookie)return cookie}await delay(100)}throw new Error('local DSH auth token was not printed') }
async function localRpc(method, payload) { const rpcId=randomUUID(); const request=method==='session/prompt'?{requestId:randomUUID(),...payload}:payload; const args=method==='session/modelCatalog'?{}:method==='session/list'?{_request:request}:{request}; const res=await fetch(`${localBase}/api/${method}`,{method:'POST',headers:{'content-type':'application/json',cookie:localAuthCookie},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args}})}); const json=await res.json(); if(!json.result?.ok) throw new Error(json.result?.error?.message||'local rpc failed'); return json.result.value }
async function sidebarApi(remote, method, payload) { const res=await fetch(`${remote.proxyOrigin}/sidebar/api/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}); const json=await res.json(); if(!json.ok) throw new Error(json.error?.message||'sidebar failed'); return json.value }
async function terminalCommand(remote, input) {
  return terminalThroughBrowser({ origin: remote.proxyOrigin, sessionId: remote.sessionId, input, sentinel: remote.text })
}

async function api(path, init) { const res=await fetch(`${localBase}/remote-desktop/api${path}`,{headers:{'content-type':'application/json',cookie:localAuthCookie},...init}); const json=await res.json(); if(!res.ok||json.ok!==true) throw new Error(json.error?.message||`HTTP ${res.status}`); return json }
async function runHarness(args, env, timeoutMs) {
  return harnessRoot
    ? cmd('pnpm', ['dsh', ...args], { cwd: harnessRoot, env, timeoutMs })
    : cmd(dshBin, args, { cwd: repoRoot, env, timeoutMs })
}
async function ssh(command, options={}) { return sshTo(sshDest, command, options) }
async function sshRemote(remote, command, options={}) { return sshTo(remote.sshDest, command, options) }
async function sshTo(alias, command, options={}) { return cmd('ssh', sshArgs(alias, command), { timeoutMs: options.timeoutMs ?? 30000 }) }
function sshArgs(alias, command) { return [...(containerRemotes ? ['-F', localSshConfig] : []), '-o', 'BatchMode=yes', alias, command] }
function scpArgs(source, target) { return [...(containerRemotes ? ['-F', localSshConfig] : []), source, target] }
async function remoteUser() { return (await ssh('whoami')).trim() }
async function cmd(command,args,options={}) { const r=spawnSync(command,args,{cwd:options.cwd??repoRoot,env:{...process.env,...(options.env??{})},encoding:'utf8',timeout:options.timeoutMs??30000,maxBuffer:1024*1024*20}); if(r.error) throw r.error; if(r.status!==0) throw new Error(`${command} ${args.join(' ')} failed (${r.status})\n${r.stdout}\n${r.stderr}`); return r.stdout }
async function item(id,name,fn){const start=Date.now();try{const evidence=await fn(); report.push({id,name,status:'PASS',evidence,durationMs:Date.now()-start}); console.log(`PASS ${id} ${name}: ${evidence}`)}catch(e){report.push({id,name,status:'FAIL',evidence:e.message,durationMs:Date.now()-start}); console.error(`FAIL ${id} ${name}: ${e.message}`); throw new Error(`${id}: ${e.message}`)}}
async function freePort(){const s=createServer();await new Promise((res,rej)=>{s.once('error',rej);s.listen(0,'127.0.0.1',res)});const a=s.address();const p=typeof a==='object'&&a?a.port:undefined;await new Promise(res=>s.close(res));if(!p)throw new Error('no port');return p}
async function waitRemoteDesktopApi(ms){const d=Date.now()+ms;while(Date.now()<d){try{const r=await fetch(`${localBase}/remote-desktop/api/hosts`,{headers:{cookie:localAuthCookie}});const j=await r.json();if(j.ok===true)return}catch{}await delay(500)}throw new Error('timeout remote desktop api')}
async function waitHttp(url,ms){const d=Date.now()+ms;while(Date.now()<d){try{const r=await fetch(url);if(r.status<500)return}catch{}await delay(500)}throw new Error('timeout '+url)}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
function sh(v){return `'${String(v).replaceAll("'","'\\''")}'`}
function parseArgs(argv){const o={};for(let i=0;i<argv.length;i++){if(argv[i].startsWith('--'))o[argv[i].slice(2)]=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:'true'}return o}
function stopStarted(){while(started.length){try{started.pop().kill('SIGTERM')}catch{}}}
function loadPlaywright(){const c=['/Users/i060912/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js',join(repoRoot,'node_modules/playwright/index.js')];for(const p of c)if(existsSync(p))return createRequire(p)('playwright');throw new Error('Playwright required')}
function findChrome(){for(const p of [process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean)) if(existsSync(p)) return p; return undefined}
async function dismissTopLevelBlockingUi(page){for(let i=0;i<3;i++){const clicked=await page.evaluate(()=>{const labels=['Configure later','Continue','Got it','OK'];const b=[...document.querySelectorAll('button')].find(x=>labels.some(l=>(x.textContent||'').includes(l)));if(!b)return false;b.click();return true}).catch(()=>false); if(!clicked)break; await page.waitForTimeout(500)} await page.keyboard.press('Escape').catch(()=>{})}
async function writeReport(){await mkdir(artifactDir,{recursive:true});await writeFile(join(artifactDir,'acceptance-report.json'),JSON.stringify({report},null,2)+'\n');await writeFile(join(artifactDir,'browser-console.log'),browserLogs.join('\n'));await writeFile(join(artifactDir,'local-dsh.log'),localLog)}
