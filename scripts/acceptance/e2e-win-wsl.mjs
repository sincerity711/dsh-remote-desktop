#!/usr/bin/env node
import { terminalThroughBrowser } from './terminal-controller.mjs'
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
const containerRemotes = args['container-remotes'] === 'true' || args['docker-remotes'] === 'true'
const keepLocalDsh = args['keep-local-dsh'] === 'true'
const sshDest = args['ssh-dest'] ?? (containerRemotes ? 'remote-a' : 'win-wsl')
const dshBin = process.env.DSH_BIN ?? 'dsh'
const sourceRoot = args['harness-root'] ?? process.env.DSH_HARNESS_ROOT
const harnessRoot = sourceRoot ? resolve(sourceRoot) : undefined
const remoteHome = args['remote-home'] ?? '~/.dsh-remote-desktop-test'
const remoteSentinelDir = '/tmp/dsh-remote-desktop-sentinel'
const remotePort = Number(args['remote-port'] ?? 30800)
const remoteLogPath = `/tmp/dsh-remote-desktop-${remotePort}.log`
const artifactsRoot = join(repoRoot, '.acceptance', 'artifacts')
const localHome = resolve(repoRoot, '.acceptance', 'local-home')
const containerSshConfig = join(repoRoot, '.acceptance', 'container', 'ssh-config')
const localSshConfig = containerRemotes ? containerSshConfig : join(localHome, 'ssh-config')
const localPlugin = resolve(repoRoot, 'packages/local')
const companionSource = resolve(repoRoot, 'packages/companion')
const ollamaModel = process.env.DSH_RD_OLLAMA_MODEL ?? 'minicpm-v4.6:1b'
const ollamaApiKeyEnv = 'DSH_RD_OLLAMA_API_KEY'
const ollamaApiKey = process.env[ollamaApiKeyEnv] ?? 'ollama-acceptance-dummy-key'
const localOllamaBaseUrl = (process.env.DSH_RD_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifactDir = join(artifactsRoot, runId)
const report = []
const started = []
let browserLogs = []
let localDshLog = ''
let localAuthCookie = ''
let remoteDshLog = ''
let localPort = 0
let localBase = ''
let remoteProxyOrigin = ''
let remoteSessionId = ''
let localSessionId = ''
let sourceToken = ''
let remoteProxyExports = ''
let remoteOllamaBaseUrl = process.env.DSH_RD_REMOTE_OLLAMA_BASE_URL ?? `${localOllamaBaseUrl}/v1`

await mkdir(artifactDir, { recursive: true })
process.on('exit', stopStarted)

function stopStarted() {
  while (started.length > 0) {
    const child = started.pop()
    try { child.kill('SIGTERM') } catch {}
  }
}

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
  await item('P0-ENV-001', 'local home isolation', async () => {
    await rm(localHome, { recursive: true, force: true })
    await mkdir(localHome, { recursive: true })
    if (containerRemotes) {
      if (!existsSync(localSshConfig)) throw new Error(`Apple container SSH config missing: ${localSshConfig}. Run npm run acceptance:container:up`)
    } else {
      await writeFile(localSshConfig, `Include ~/.ssh/config\nHost ${sshDest}\n  HostName ${sshDest}\n  User ${await remoteUser()}\n`)
    }
    return `local DSH_HOME=${localHome}, ssh config=${localSshConfig}`
  })
  await item('P0-ENV-002', 'remote home isolation', async () => {
    await ssh(`rm -rf ${sh(remoteHome)} ${sh(remoteSentinelDir)} && mkdir -p ${sh(remoteSentinelDir)}`)
    return `remote DSH_HOME=${remoteHome}`
  })
  await item('P0-ENV-003', 'ssh key-only', async () => {
    await cmd('ssh', sshArgs('true'), { timeoutMs: 10000 })
    return `ssh BatchMode ${sshDest} succeeded`
  })

  if (containerRemotes) {
    const hostProxy = await startHostProxy()
    remoteProxyExports = hostProxy.packageProxyExports
    remoteOllamaBaseUrl = hostProxy.ollamaBaseUrl
  }
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
  if (!keepLocalDsh) stopStarted()
  console.log(`\nP0 acceptance PASS. Artifacts: ${artifactDir}`)
  if (keepLocalDsh) console.log(`Local DSH kept running: ${localBase}`)
  printCleanup()
} catch (error) {
  await writeReport().catch(() => {})
  if (!keepLocalDsh) stopStarted()
  else if (localBase) console.error(`Local DSH kept running after failure: ${localBase}`)
  console.error(`\nP0 acceptance FAIL: ${error.message}`)
  console.error(`Artifacts: ${artifactDir}`)
  printCleanup()
  process.exit(1)
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

async function setupRemote() {
  const stopContainerListener = containerRemotes ? `
      listeners=$(ps -eo pid=,args= | awk '$2 ~ /(^|\\/)node$/ && $0 ~ /\\/dsh --profile web/ && $0 ~ /--port ${remotePort}([[:space:]]|$)/ {print $1}')
      if [ -n "$listeners" ]; then kill $listeners 2>/dev/null || true; fi
      rm -f /tmp/dsh-remote-desktop-web.pid /tmp/dsh-rd-*.pid /tmp/dsh-remote-desktop-${remotePort}.pid
      for attempt in 1 2 3 4 5; do
        if node -e "const s=require('node:net').createServer();s.once('error',()=>process.exit(1));s.listen(${remotePort},'127.0.0.1',()=>s.close(()=>process.exit(0)))"; then break; fi
        sleep 1
      done
      node -e "const s=require('node:net').createServer();s.once('error',()=>process.exit(1));s.listen(${remotePort},'127.0.0.1',()=>s.close(()=>process.exit(0)))" || { echo 'remote DSH port ${remotePort} did not stop' >&2; exit 1; }
  ` : ''
  await item('P0-BOOT-001', 'remote dsh boots', async () => {
    const nodeVersion = (await ssh('node --version')).trim()
    const major = Number(/^v(\d+)/.exec(nodeVersion)?.[1] ?? 0)
    if (major < 22) throw new Error(`remote node ${nodeVersion} < 22`)
    await copyCompanionToRemote()
    await ssh(`set -e
      ${remoteProxyExports}
      mkdir -p "$HOME/.npm-global"
      npm config set prefix "$HOME/.npm-global"
      corepack prepare pnpm@10.34.1 --activate
      export PATH=\"$HOME/.npm-global/bin:$PATH\"
      if [ ! -x "$HOME/.npm-global/bin/dsh" ] || [ "$("$HOME/.npm-global/bin/dsh" --version 2>/dev/null || true)" != "0.2.0-rc.2" ]; then npm install -g @deepseek-ai/dsh@0.2.0-rc.2 --force; fi
      DSH_HOME=${remoteHome} dsh --profile web --dump-config >/tmp/dsh-remote-desktop-dump.txt
      cat > ${remoteHome}/settings.yaml <<'SETTINGS'
${ollamaSettings(remoteOllamaBaseUrl)}SETTINGS
      cd ${remoteHome}/profiles/web
      node - <<'NODE'
const fs = require('fs')
const path = 'package.json'
const pkg = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : { name: 'remote-acceptance-profile', private: true }
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

      CI=true pnpm install --no-frozen-lockfile

      pnpm rebuild node-pty >/tmp/dsh-remote-desktop-node-pty.log 2>&1 || true
      printf 'REMOTE_SENTINEL_WIN_WSL\n' > ${remoteSentinelDir}/remote-only.txt
      if [ -f /tmp/dsh-remote-desktop-web.pid ]; then kill $(cat /tmp/dsh-remote-desktop-web.pid) 2>/dev/null || true; fi
      ${stopContainerListener}
      nohup env DSH_HOME=${remoteHome} DSH_TELEMETRY_DISABLED=1 ${ollamaApiKeyEnv}=${sh(ollamaApiKey)} dsh --profile web --host 127.0.0.1 --port ${remotePort} --trusted-host 127.0.0.1:${remotePort} > ${remoteLogPath} 2>&1 & echo $! > /tmp/dsh-remote-desktop-web.pid
    `, { timeoutMs: 600000 })
    await waitForRemoteDsh()
    remoteDshLog = await ssh(`cat ${remoteLogPath} 2>/dev/null || true`)
    return `remote companion health answers on 127.0.0.1:${remotePort}`
  })
  await item('P0-BOOT-004', 'remote companion uses copied local artifact', async () => {
    const profilePackage = await ssh(`cat ${remoteHome}/profiles/web/package.json`)
    const pkg = JSON.parse(profilePackage)
    if (pkg.dependencies?.['dsh-remote-desktop-companion'] !== 'link:/tmp/dsh-remote-desktop-companion') throw new Error('remote companion dependency does not use copied local artifact')
    if (!pkg.dsh?.profile?.bundles?.includes('dsh-remote-desktop-companion')) throw new Error('remote companion bundle missing from remote profile')
    const health = await remoteCompanionHealth()
    if (health.name !== 'dsh-remote-desktop-companion') throw new Error(`unexpected companion health name ${health.name}`)
    return 'remote profile links /tmp/dsh-remote-desktop-companion and companion health answers'
  })
}

async function setupLocal() {
  await item('P0-BOOT-002', 'local dsh boots', async () => {
    if (harnessRoot && !existsSync(harnessRoot)) throw new Error(`harness root not found: ${harnessRoot}`)
    await runHarness(['--profile', 'web', '--dump-config'], { DSH_HOME: localHome }, 60000)
    await writeFile(join(localHome, 'settings.yaml'), ollamaSettings(`${localOllamaBaseUrl}/v1`))
    const profile = join(localHome, 'profiles/web')
    await patchProfilePackage(profile, {
      dependency: ['dsh-remote-desktop', `link:${localPlugin}`],
      bundle: 'dsh-remote-desktop',
    })
    await cmd('pnpm', ['install', '--no-frozen-lockfile'], { cwd: profile, env: { CI: 'true' }, timeoutMs: 120000 })
    localPort = await freePort()
    const logPath = join(artifactDir, 'local-dsh-live.log')
    const child = spawn(harnessRoot ? 'node' : dshBin, harnessRoot
      ? ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--host', '127.0.0.1', '--port', String(localPort), '--trusted-host', `127.0.0.1:${localPort}`]
      : ['--profile', 'web', '--host', '127.0.0.1', '--port', String(localPort), '--trusted-host', `127.0.0.1:${localPort}`], {
      cwd: harnessRoot || repoRoot,
      env: { ...process.env, DSH_HOME: localHome, DSH_TELEMETRY_DISABLED: '1', DSH_REMOTE_DESKTOP_SSH_CONFIG: localSshConfig, [ollamaApiKeyEnv]: ollamaApiKey, ...(containerRemotes ? { DSH_REMOTE_DESKTOP_SKIP_SETUP: '1' } : {}) },
      detached: keepLocalDsh,
      stdio: keepLocalDsh ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    })
    if (keepLocalDsh) child.unref()
    else {
      started.push(child)
      child.stdout.on('data', b => { localDshLog += String(b) })
      child.stderr.on('data', b => { localDshLog += String(b) })
    }
    localBase = `http://127.0.0.1:${localPort}`
    localAuthCookie = await authenticateLocal(localBase, () => localDshLog)
    await waitRemoteDesktopApi(60000)
    await writeFile(logPath, localDshLog)
    return `${localBase} booted and management API answers`
  })
  await item('P0-BOOT-003', 'tunnel connects', async () => {
    const hosts = (await api('/hosts')).hosts
    if (!hosts.some(host => host.id === sshDest)) throw new Error(`${sshDest} missing from ssh config hosts`)
    const source = (await api('/connect', { method: 'POST', body: JSON.stringify({ id: sshDest, setup: !containerRemotes }) })).source
    if (source.state !== 'connected') throw new Error(`state=${source.state}`)
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(source.iframeUrl ?? '')) throw new Error(`bad iframeUrl ${source.iframeUrl}`)
    remoteProxyOrigin = new URL(source.iframeUrl).origin
    sourceToken = source.token
    const bootstrap = await fetch(source.iframeUrl, { redirect: 'manual' })
    if (bootstrap.status !== 200) {
      throw new Error(`iframe authentication bootstrap failed: HTTP ${bootstrap.status}`)
    }
    return `connected iframeUrl=${source.iframeUrl}`
  })
}

async function setupData() {
  await item('P0-SIDEBAR-002', 'remote session visible data', async () => {
    const workspace = await remoteRpc('workspace/create', { path: remoteSentinelDir })
    const session = await remoteRpc('session/create', { workspaceId: workspace.workspace.workspaceId })
    remoteSessionId = session.sessionId
    await assertOllamaDefault(await remoteRpc('session/modelCatalog', {}), 'remote')
    await remoteRpc('session/rename', { sessionId: remoteSessionId, title: 'Remote Desktop acceptance fixture' })
    await remoteRpc('session/prompt', { sessionId: remoteSessionId, mode: 'queue', content: [{ type: 'text', text: 'Remote Desktop acceptance fixture.' }] })
    await remoteRpc('session/cancel', { sessionId: remoteSessionId })
    return `remote workspace ${workspace.workspace.workspaceId}, session ${remoteSessionId}`
  })
  await item('P0-PLUGIN-002', 'Explorer reads remote sentinel', async () => {
    const tree = await sidebarApi('fs.tree', { sessionId: remoteSessionId, cwd: remoteSentinelDir, path: remoteSentinelDir })
    if (!tree.entries.some(entry => entry.name === 'remote-only.txt')) throw new Error('remote-only.txt missing from fs.tree')
    return 'remote /sidebar/api/fs.tree lists remote-only.txt'
  })
  await item('P0-PLUGIN-003', 'terminal runs remotely', async () => {
    const text = await terminalCommand(remoteSessionId, `cat ${remoteSentinelDir}/remote-only.txt\n`)
    if (!text.includes('REMOTE_SENTINEL_WIN_WSL')) throw new Error('terminal output missing sentinel')
    return 'official terminal Controller returned the remote sentinel through the forwarded origin'
  })


  await item('P0-ENV-001', 'local sentinel absence setup', async () => {
    const workspace = await localRpc('workspace/create', { path: repoRoot })
    const session = await localRpc('session/create', { workspaceId: workspace.workspace.workspaceId })
    localSessionId = session.sessionId
    await assertOllamaDefault(await localRpc('session/modelCatalog', {}), 'local')
    await localRpc('session/prompt', { sessionId: localSessionId, mode: 'queue', content: [{ type: 'text', text: 'Local Remote Desktop acceptance fixture.' }] })
    await localRpc('session/cancel', { sessionId: localSessionId })
    return `local session ${localSessionId}`
  }, { duplicateOk: true })
}

async function runBrowserChecks() {
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
    await item('P0-SIDEBAR-001', 'project list visible with host marker', async () => {
      await page.locator('[data-rd-local-session-id]').first().waitFor({ timeout: 10000 })
      try {
        await page.locator(`[data-rd-host-marker="${sshDest}"]`).first().waitFor({ timeout: 10000 })
      } catch (error) {
        const diagnostic = await page.evaluate(() => ({
          frames: [...document.querySelectorAll('iframe')].map(frame => ({ src: frame.src, display: getComputedStyle(frame).display })),
          remote: window.__dshRemoteDesktop?.getSnapshot?.(),
        }))
        diagnostic.frameUrls = page.frames().map(frame => frame.url())
        throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`)
      }
      await page.screenshot({ path: join(artifactDir, '01-local-ready.png'), fullPage: true })
      return `project-first sidebar shows local sessions and ${sshDest} host marker`
    })
    await item('P0-SIDEBAR-005', 'fresh browser context receives remote Controller state', async () => {
      const context = await browser.newContext({ viewport: { width: 1200, height: 800 } })
      try {
        await context.addCookies([{
          name: localAuthCookie.slice(0, separator),
          value: localAuthCookie.slice(separator + 1),
          url: localBase,
        }])
        const fresh = await context.newPage()
        await fresh.goto(localBase, { waitUntil: 'domcontentloaded' })
        await fresh.locator(`[data-rd-host-marker="${sshDest}"]`).first().waitFor({ timeout: 15000 })
        const ready = await fresh.evaluate((sourceId) => window.__dshRemoteDesktop?.getSnapshot?.().companionReady?.[sourceId] === true, sshDest)
        if (!ready) throw new Error('fresh browser did not complete the Companion handshake')
        return 'a second browser context received remote workspaces through the retryable handshake'
      } finally {
        await context.close()
      }
    })
    await item('P0-ARTIFACT-001', 'screenshots initial', async () => {
      if (!existsSync(join(artifactDir, '01-local-ready.png'))) throw new Error('01-local-ready.png missing')
      return '01-local-ready.png saved'
    })
    await item('P0-SIDEBAR-003', 'active local session indication', async () => {
      const rows = await page.locator('[data-rd-local-session-id]').count()
      if (rows < 1) throw new Error('local session row missing')
      return 'local session row visible'
    })
    await item('P0-SIDEBAR-004', 'workspace header does not switch active target', async () => {
      const header = page.locator(`[data-rd-workspace-source-kind="remote"]`).first()
      const before = await header.getAttribute('aria-expanded')
      await header.click()
      await page.waitForTimeout(500)
      const after = await header.getAttribute('aria-expanded')
      const overlayActive = await page.locator('[data-rd-overlay-active="true"]').count()
      const visible = await page.locator('iframe').first().evaluate(frame => getComputedStyle(frame).display !== 'none').catch(() => false)
      if (before === after) throw new Error(`remote workspace did not toggle expansion (${String(before)})`)
      if (overlayActive > 0 || visible) throw new Error('remote workspace header activated iframe')
      return `remote workspace toggled ${String(before)} -> ${String(after)} without activating its iframe`
    })
    await item('P0-SWITCH-001', 'local to remote', async () => {
      await page.locator(`[data-rd-remote-session-id="${remoteSessionId}"]`).click()
      await page.waitForTimeout(6000)
      const frame = await remoteFrame(page)
      if (frame === undefined) throw new Error('remote iframe missing')
      await page.screenshot({ path: join(artifactDir, '02-remote-active.png'), fullPage: true })
      return `remote session row opened iframe ${frame.url()}`
    })
    await item('P0-IFRAME-001', 'remote origin', async () => {
      const frame = await remoteFrame(page)
      if (frame === undefined) throw new Error('remote iframe missing')
      const origin = new URL(frame.url()).origin
      if (origin === localBase) throw new Error(`origin equals local ${origin}`)
      return `${origin} != ${localBase}`
    })
    await item('P0-IFRAME-005', 'remote overlay occupies official shell overlay', async () => {
      const result = await page.evaluate(() => {
        const overlay = document.querySelector('[data-rd-overlay-active="true"]')
        if (!(overlay instanceof HTMLElement)) return { ok: false, reason: 'active overlay missing' }
        const style = getComputedStyle(overlay)
        const rect = overlay.getBoundingClientRect()
        const probe = document.elementFromPoint(window.innerWidth - 24, Math.min(120, window.innerHeight - 24))
        const probeCovered = probe === overlay || overlay.contains(probe)
        if (overlay.parentElement === document.body) return { ok: false, reason: 'overlay bypassed the official shell slot' }
        if (style.position !== 'absolute') return { ok: false, reason: `overlay position is ${style.position}` }
        if (rect.left <= 0 || rect.right < window.innerWidth - 1 || rect.bottom < window.innerHeight - 1) return { ok: false, reason: `bad overlay rect ${JSON.stringify({ left: rect.left, right: rect.right, bottom: rect.bottom })}` }
        if (!probeCovered) return { ok: false, reason: `right-side probe hit ${probe?.tagName ?? 'nothing'} outside overlay` }
        return { ok: true, reason: `${style.position} shell overlay covers right-side probe` }
      })
      if (!result.ok) throw new Error(result.reason)
      return result.reason
    })
    await item('P0-IFRAME-007', 'remote overlay follows sidebar resize', async () => {
      // The official shell overlay intentionally sits above frame drag handles.
      // Resize from the local surface, then reactivate the remote surface and
      // verify its observed edge follows the new shell geometry.
      await page.locator(`[data-rd-local-session-id="${localSessionId}"]`).click()
      await page.waitForTimeout(300)
      const read = async () => page.evaluate(() => {
        const sidebar = document.querySelector('[class*="sidebarCol"]')
        const overlay = document.querySelector('[data-rd-overlay-active]')
        if (!(sidebar instanceof HTMLElement) || !(overlay instanceof HTMLElement)) return { ok: false, reason: 'sidebar or overlay missing' }
        return { ok: true, sidebarRight: sidebar.getBoundingClientRect().right, overlayLeft: overlay.getBoundingClientRect().left }
      })
      const before = await read()
      if (!before.ok) throw new Error(before.reason)
      const handle = await page.locator('[data-side="sidebar"]').first().boundingBox()
      if (handle === null) throw new Error('sidebar resize handle missing')
      await page.mouse.move(handle.x + 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + 44, handle.y + handle.height / 2, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(1000)
      await page.locator(`[data-rd-remote-session-id="${remoteSessionId}"]`).click()
      await page.waitForTimeout(1000)
      const after = await read()
      if (!after.ok) throw new Error(after.reason)
      if (Math.abs(after.sidebarRight - before.sidebarRight) < 12) throw new Error(`sidebar did not resize: before=${before.sidebarRight}, after=${after.sidebarRight}`)
      if (Math.abs(after.overlayLeft - after.sidebarRight) > 5) throw new Error(`overlay left ${after.overlayLeft} did not follow sidebar right ${after.sidebarRight}`)
      return `overlay left followed sidebar right from ${Math.round(before.overlayLeft)} to ${Math.round(after.overlayLeft)}`
    })
    await item('P0-SWITCH-002', 'remote open command', async () => {
      await page.evaluate(({ sourceId, sessionId }) => window.__dshRemoteDesktop.openRemoteSession(sourceId, sessionId), { sourceId: sshDest, sessionId: remoteSessionId })
      await page.waitForFunction(({ sourceId, sessionId }) => {
        const snapshot = window.__dshRemoteDesktop?.getSnapshot?.()
        return snapshot?.companionReady?.[sourceId] === true
          && snapshot.pendingOpen === null
          && snapshot.active?.sourceId === sourceId
          && snapshot.active?.sessionId === sessionId
      }, { sourceId: sshDest, sessionId: remoteSessionId }, { timeout: 7000 })
      return `MessageChannel opened ${remoteSessionId}`
    })
    await item('P0-IFRAME-002', 'companion marker', async () => {
      const frame = await mustRemoteFrame(page)
      const count = await frame.locator('body[data-dsh-remote-desktop-child="true"]').count()
      if (count < 1) throw new Error('companion marker missing')
      return 'body marker present'
    })
    await item('P0-IFRAME-006', 'companion CSS targets only dsh app frame', async () => {
      const frame = await mustRemoteFrame(page)
      const result = await frame.evaluate(() => {
        const css = document.querySelector('style[data-dsh-remote-desktop-companion]')?.textContent || ''
        if (!css.includes(':has(> [class*="sidebarCol"])')) return { ok: false, reason: 'targeted app-frame selector missing' }
        if (css.includes('[class*="frame"] { grid-template-columns')) return { ok: false, reason: 'broad frame selector still present' }
        return { ok: true, reason: 'companion rewrites only the DSH app frame containing sidebarCol' }
      })
      if (!result.ok) throw new Error(result.reason)
      return result.reason
    })
    await item('P0-IFRAME-003', 'remote left sidebar hidden', async () => {
      const frame = await mustRemoteFrame(page)
      const sidebarState = await frame.locator('[class*="sidebarCol"]').evaluateAll(nodes => nodes.map((n) => {
        const style = getComputedStyle(n)
        return { className: n.className, visibility: style.visibility, pointerEvents: style.pointerEvents, width: n.getBoundingClientRect().width, parent: n.parentElement?.className }
      }))
      const visible = sidebarState.some(item => item.visibility !== 'hidden' && item.pointerEvents !== 'none' && item.width > 10)
      if (visible) throw new Error(`iframe sidebarCol still visible: ${JSON.stringify(sidebarState)}`)
      await page.locator('[data-rd-local-session-id]').first().waitFor({ timeout: 10000 })
      return 'iframe sidebar hidden, top-level local sessions still visible'
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
    await item('P0-PLUGIN-005', 'Better Sidebar bottom panel toggles in iframe', async () => {
      const frame = await mustRemoteFrame(page)
      await dismissFrameBlockingUi(frame)
      const result = await frame.evaluate(async () => {
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false
          let cursor = element
          while (cursor instanceof HTMLElement) {
            const style = getComputedStyle(cursor)
            if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false
            cursor = cursor.parentElement
          }
          const rect = element.getBoundingClientRect()
          if (rect.width <= 10 || rect.height <= 10) return false
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return hit === element || element.contains(hit)
        }
        const findButton = (needles) => [...document.querySelectorAll('button')]
          .find(button => !button.disabled && needles.some(needle => `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`.includes(needle)))
        const waitForButton = async (needles) => {
          const deadline = Date.now() + 5000
          while (Date.now() < deadline) {
            const button = findButton(needles)
            if (button) return button
            await new Promise(resolve => setTimeout(resolve, 250))
          }
          return undefined
        }
        const bottomPanel = () => [...document.querySelectorAll('[class*="bottomPanel"]')].find(element => {
          const rect = element.getBoundingClientRect()
          return rect.width > 10 && rect.height > 10 && element.checkVisibility({ checkVisibilityCSS: true })
        })
        const bottomClose = () => [...document.querySelectorAll('[class*="bottomClose"]')].find(visible)
        const collapseBottom = async () => {
          const close = findButton(['Collapse bottom panel', '折叠底部面板']) || bottomClose()
          if (!close) return false
          close.click()
          await new Promise(resolve => setTimeout(resolve, 700))
          return true
        }
        if (bottomPanel()) {
          if (!await collapseBottom()) return { ok: false, reason: 'bottom panel was open but no collapse control worked' }
        }
        if (bottomPanel()) return { ok: false, reason: 'bottom panel stayed visible before reopen' }
        if (bottomClose()) return { ok: false, reason: 'bottom close control visible before opening bottom panel' }
        const open = await waitForButton(['Expand bottom panel', '展开底部面板'])
        if (!open) return { ok: false, reason: 'bottom panel expand button missing or disabled after waiting for remote session scope' }
        open.click()
        await new Promise(resolve => setTimeout(resolve, 700))
        const panel = bottomPanel()
        if (!panel) return { ok: false, reason: 'bottom panel did not become visible after expand click: '+ [...document.querySelectorAll('[class]')].map(el=>el.className).filter(c=>typeof c==='string'&&/dock|panel|bottom/i.test(c)).slice(-35).join(' | ') }
        if (panel.getBoundingClientRect().width < 200) return { ok: false, reason: `bottom panel width too small: ${panel.getBoundingClientRect().width}` }
        if (!await collapseBottom()) return { ok: false, reason: 'bottom panel collapse button missing after open' }
        if (bottomPanel()) return { ok: false, reason: 'bottom panel stayed visible after collapse click' }
        if (bottomClose()) return { ok: false, reason: 'bottom close control stayed visible after collapse' }
        return { ok: true, reason: 'bottom panel opened and closed inside remote iframe' }
      })
      if (!result.ok) throw new Error(result.reason)
      return result.reason
    })
    await item('P0-SWITCH-005', 'new local Session while remote is active', async () => {
      const before = await page.locator('[data-rd-local-session-id]').count()
      const add = page.locator('[data-rd-workspace-source-kind="local"][data-rd-workspace-id] button').last()
      await add.waitFor({ state: 'attached', timeout: 10000 })
      await add.evaluate(button => button.click())
      await page.waitForFunction((minimum) => {
        const snapshot = window.__dshRemoteDesktop?.getSnapshot?.()
        return snapshot?.active?.kind === 'local'
          && document.querySelectorAll('[data-rd-local-session-id]').length > minimum
      }, before, { timeout: 10000 })
      const visible = await page.locator('iframe').first().evaluate(frame => getComputedStyle(frame).display !== 'none').catch(() => false)
      if (visible) throw new Error('remote iframe stayed visible after creating a local Session')
      await page.evaluate(({ sourceId, sessionId }) => window.__dshRemoteDesktop.openRemoteSession(sourceId, sessionId), { sourceId: sshDest, sessionId: remoteSessionId })
      await page.waitForFunction(() => document.querySelector('[data-rd-overlay-active="true"]') !== null, { timeout: 5000 })
      return 'local Session was created and the active surface switched from remote to local'
    })
    await item('P0-SIDEBAR-003', 'active source indication remote', async () => {
      const markers = page.locator(`[data-rd-host-marker="${sshDest}"]`)
      const markerCount = await markers.count()
      if (markerCount < 1) throw new Error('remote host marker missing')
      const markerTitle = await markers.first().getAttribute('title')
      if (markerTitle !== sshDest) throw new Error(`remote host marker title mismatch: ${markerTitle}`)
      return `${sshDest} host marker visible`
    }, { duplicateOk: true })
    await item('P0-SWITCH-003', 'remote to local', async () => {
      await page.locator('[data-rd-local-session-id]').first().click()
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
        await page.locator(`[data-rd-remote-session-id="${remoteSessionId}"]`).click()
        await page.waitForTimeout(600)
        let visible = await page.locator('iframe').first().evaluate(frame => getComputedStyle(frame).display !== 'none')
        if (!visible) throw new Error(`iframe hidden on remote iteration ${i}`)
        await page.locator('[data-rd-local-session-id]').first().click()
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
  await cmd('scp', scpArgs(tar, `${sshDest}:/tmp/dsh-remote-desktop-companion.tar.gz`), { timeoutMs: 30000 })
  await ssh('tar xzf /tmp/dsh-remote-desktop-companion.tar.gz -C /tmp/dsh-remote-desktop-companion')
}

async function waitForRemoteDsh() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      await remoteCompanionHealth()
      return
    } catch {
      await delay(1000)
    }
  }
  remoteDshLog = await ssh(`cat ${remoteLogPath} 2>/dev/null || true`).catch(() => '')
  throw new Error(`remote dsh did not boot. Log:\n${remoteDshLog}`)
}

async function remoteCompanionHealth() {
  const script = `
const res = await fetch('http://127.0.0.1:${remotePort}/remote-desktop-companion/api/health');
if (!res.ok) throw new Error('HTTP ' + res.status);
console.log(JSON.stringify(await res.json()));
`
  return JSON.parse(await ssh(`node --input-type=module -e ${sh(script)}`))
}

async function remoteRpc(method, payload) {
  const rpcId = randomUUID()
  const request = method === 'session/prompt' ? { requestId: randomUUID(), ...payload } : payload
  const args = method === 'session/modelCatalog' ? {} : { request }
  const res = await fetch(`${remoteProxyOrigin}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.result?.ok) throw new Error(json?.result?.error?.message || `remote ${method} HTTP ${res.status}`)
  return json.result.value
}

async function authenticateLocal(base, output) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(output())?.[1]
    if (token) {
      const response = await fetch(`${base}/?token=${token}`, { redirect: 'manual' })
      const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
      if (cookie) return cookie
    }
    await delay(100)
  }
  throw new Error('local DSH auth token was not printed')
}

async function localRpc(method, payload) {
  const rpcId = randomUUID()
  const request = method === 'session/prompt' ? { requestId: randomUUID(), ...payload } : payload
  const args = method === 'session/modelCatalog' ? {} : { request }
  const res = await fetch(`${localBase}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: localAuthCookie }, body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }) })
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
  return terminalThroughBrowser({ origin: remoteProxyOrigin, sessionId, input, sentinel: 'REMOTE_SENTINEL_WIN_WSL' })
}

async function api(path, init) {
  const res = await fetch(`${localBase}/remote-desktop/api${path}`, { headers: { 'content-type': 'application/json', cookie: localAuthCookie }, ...init })
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
  return harnessRoot
    ? await cmd('pnpm', ['dsh', ...args], { cwd: harnessRoot, env, timeoutMs })
    : await cmd(dshBin, args, { cwd: repoRoot, env, timeoutMs })
}

async function ssh(command, options = {}) {
  return await cmd('ssh', sshArgs(command), { timeoutMs: options.timeoutMs ?? 30000 })
}

function sshArgs(command) {
  return [...(containerRemotes ? ['-F', localSshConfig] : []), '-o', 'BatchMode=yes', sshDest, command]
}

function scpArgs(source, target) {
  return [...(containerRemotes ? ['-F', localSshConfig] : []), source, target]
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

async function waitRemoteDesktopApi(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${localBase}/remote-desktop/api/hosts`, { headers: { cookie: localAuthCookie } })
      const json = await res.json()
      if (json.ok === true) return
    } catch {}
    await delay(500)
  }
  throw new Error('timeout remote desktop api')
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


async function dismissFrameBlockingUi(frame) {
  for (let i = 0; i < 3; i += 1) {
    const clicked = await frame.evaluate(() => {
      const labels = ['Configure later', '稍后配置', 'Continue', 'Got it', 'OK']
      const buttons = [...document.querySelectorAll('button')]
      const button = buttons.find(item => labels.some(label => (item.textContent || '').includes(label)))
      if (button === undefined) return false
      button.click()
      return true
    }).catch(() => false)
    if (!clicked) break
    await new Promise(resolve => setTimeout(resolve, 700))
  }
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
  remoteDshLog ||= await ssh(`cat ${remoteLogPath} 2>/dev/null || true`).catch(() => '')
  await writeFile(join(artifactDir, 'remote-dsh.log'), remoteDshLog)
}

function printCleanup() {
  console.log('\nCleanup commands:')
  console.log('rm -rf .acceptance/local-home .acceptance/artifacts')
  if (containerRemotes) {
    console.log('npm run acceptance:container:down')
    console.log('npm run acceptance:container:clean')
  } else {
    console.log(`${`ssh ${sshDest} `}${sh(`rm -rf ${remoteHome} ${remoteSentinelDir}`)}`)
  }
}
