#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const args = parseArgs(process.argv.slice(2))
const command = args._[0] ?? 'help'
const harnessRoot = resolve(args['harness-root'] ?? process.env.DSH_HARNESS_ROOT ?? join(repoRoot, '..', 'deepseek-harness'))
const stateDir = join(repoRoot, '.acceptance', 'container')
const sshKey = join(stateDir, 'id_ed25519')
const sshPub = `${sshKey}.pub`
const authorizedKeys = join(stateDir, 'authorized_keys')
const knownHosts = join(stateDir, 'known_hosts')
const sshConfig = join(stateDir, 'ssh-config')
const imageName = 'dsh-remote-desktop-acceptance-remote:latest'
const localPlugin = join(repoRoot, 'packages', 'local')
const companionDir = join(repoRoot, 'packages', 'companion')
const canaryHome = join(repoRoot, '.acceptance', 'canary-local-home')
const canaryWorkspace = join(repoRoot, '.acceptance', 'canary-workspaces', 'local')
const remotePort = 30800
const ollamaModel = process.env.DSH_RD_OLLAMA_MODEL ?? 'minicpm-v4.6:1b'
const ollamaApiKeyEnv = 'DSH_RD_OLLAMA_API_KEY'
const ollamaApiKey = process.env[ollamaApiKeyEnv] ?? 'ollama-canary-dummy-key'
const localOllamaBaseUrl = (process.env.DSH_RD_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
const containerBin = process.env.CONTAINER_CLI ?? 'container'
const remotes = [
  { id: 'remote-a', container: 'dsh-rd-remote-a', sshPort: Number(process.env.DSH_RD_REMOTE_A_SSH_PORT ?? 30221), text: 'REMOTE_SENTINEL_A', title: 'Remote A sentinel walkthrough' },
  { id: 'remote-b', container: 'dsh-rd-remote-b', sshPort: Number(process.env.DSH_RD_REMOTE_B_SSH_PORT ?? 30222), text: 'REMOTE_SENTINEL_B', title: 'Remote B isolation walkthrough' },
]
const started = []
let remoteProxyExports = ''

process.on('exit', stopStarted)
process.on('SIGINT', () => { stopStarted(); process.exit(130) })
process.on('SIGTERM', () => { stopStarted(); process.exit(143) })

switch (command) {
  case 'up':
    await up()
    break
  case 'down':
    for (const remote of remotes) await container(['delete', '--force', remote.container]).catch(() => {})
    console.log('Apple container remotes stopped.')
    break
  case 'clean':
    for (const remote of remotes) await container(['delete', '--force', remote.container]).catch(() => {})
    await rm(stateDir, { recursive: true, force: true })
    await rm(canaryHome, { recursive: true, force: true })
    await rm(join(repoRoot, '.acceptance', 'local-home'), { recursive: true, force: true })
    await rm(join(repoRoot, '.acceptance', 'p1-local-home'), { recursive: true, force: true })
    console.log('Apple container acceptance state removed.')
    break
  case 'manual':
  case 'canary':
    await canary()
    break
  default:
    console.log(`Usage: node scripts/acceptance/container-env.mjs <up|down|clean|manual|canary>\n\nmanual/canary starts a retained local DSH web process and prints the URL.`)
}

async function up() {
  await checkContainer()
  await prepareSshFiles()
  await recreateContainers()
}

async function recreateContainers() {
  await prepareSshDebs()
  await buildImage()
  const pub = (await readFile(sshPub, 'utf8')).trim()
  for (const remote of remotes) {
    await container(['delete', '--force', remote.container]).catch(() => {})
    await container(['run', '-d', '--name', remote.container, '-e', `DSH_AUTHORIZED_KEYS=${pub}`, imageName])
    await waitSsh(remote.id)
  }
  console.log(`Apple container remotes are ready.\n\nSSH config:\n  ${sshConfig}\n\nTry:\n  ssh -F ${sshConfig} remote-a\n  ssh -F ${sshConfig} remote-b`)
}

async function canary() {
  await ensureOllama()
  await ensureContainers()
  const hostProxy = await startHostProxy()
  remoteProxyExports = hostProxy.packageProxyExports
  const seed = await buildSeedText()
  for (const remote of remotes) await setupRemote(remote, seed, hostProxy.ollamaBaseUrl)
  const local = await setupLocal(seed)
  for (const remote of remotes) {
    const source = (await api(local.base, '/connect', { method: 'POST', body: JSON.stringify({ id: remote.id }) })).source
    if (source.state !== 'connected') throw new Error(`${remote.id} did not connect: ${source.state}`)
  }
  console.log(`\nCanary Remote Desktop environment ready.\n\nLocal DSH:\n  ${local.base}\n\nSSH:\n  ssh -F ${sshConfig} remote-a\n  ssh -F ${sshConfig} remote-b\n\nCleanup:\n  npm run acceptance:container:down\n  npm run acceptance:container:clean\n\nPress Ctrl-C to stop only the local DSH process. Remote containers stay running.`)
  await new Promise(() => {})
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

async function setupRemote(remote, seed, ollamaBaseUrl) {
  await copyCompanion(remote.id)
  const body = seed[remote.id] ?? `${remote.title}\n${remote.text}`
  const verifyOllama = `const response=await fetch(${JSON.stringify(`${ollamaBaseUrl}/models`)});if(!response.ok)throw new Error('HTTP '+response.status);const json=await response.json();if(!json.data?.some(model=>model.id===${JSON.stringify(ollamaModel)}))throw new Error('model missing')`
  await ssh(remote.id, `set -e
    ${remoteProxyExports}
    mkdir -p "$HOME/.npm-global"
    npm config set prefix "$HOME/.npm-global"
    export PATH="$HOME/.npm-global/bin:$PATH"
    listeners=$(lsof -tiTCP:${remotePort} -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$listeners" ]; then kill $listeners 2>/dev/null || true; fi
    for attempt in 1 2 3 4 5; do
      if ! lsof -tiTCP:${remotePort} -sTCP:LISTEN >/dev/null 2>&1; then break; fi
      sleep 1
    done
    if lsof -tiTCP:${remotePort} -sTCP:LISTEN >/dev/null 2>&1; then
      echo "remote DSH port ${remotePort} did not stop" >&2
      exit 1
    fi
    rm -rf /tmp/dsh-rd-canary
    mkdir -p /tmp/dsh-rd-canary
    cat > /tmp/dsh-rd-canary/remote-only.txt <<'TEXT'
${remote.text}
TEXT
    cat > /tmp/dsh-rd-canary/README.md <<'TEXT'
${body}
TEXT
    if [ ! -x "$HOME/.npm-global/bin/dsh" ] || [ "$("$HOME/.npm-global/bin/dsh" --version 2>/dev/null || true)" != "0.1.0-rc.7" ]; then npm install -g @deepseek-ai/dsh@0.1.0-rc.7 --force; fi
    if [ ! -f ~/.dsh-remote-desktop-canary/profiles/web/package.json ]; then
      DSH_HOME=~/.dsh-remote-desktop-canary dsh --profile web --dump-config >/tmp/dsh-rd-canary-dump.txt
    fi
    cd ~/.dsh-remote-desktop-canary/profiles/web
    node - <<'NODE'
const fs = require('fs')
const path = 'package.json'
const pkg = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : { name: 'remote-canary-profile', private: true }
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
    cat > ~/.dsh-remote-desktop-canary/settings.yaml <<'SETTINGS'
${ollamaSettings(ollamaBaseUrl)}SETTINGS
    grep -q 'minimumReleaseAgeExclude' pnpm-workspace.yaml 2>/dev/null || printf '\nminimumReleaseAgeExclude:\n  - dsh-better-sidebar\n' >> pnpm-workspace.yaml
    grep -q 'onlyBuiltDependencies' pnpm-workspace.yaml 2>/dev/null || printf '\nonlyBuiltDependencies:\n  - node-pty\n  - protobufjs\n' >> pnpm-workspace.yaml
    grep -q 'allowBuilds:' pnpm-workspace.yaml 2>/dev/null || printf '\nallowBuilds:\n  node-pty: true\n  protobufjs: true\n' >> pnpm-workspace.yaml
    if [ ! -d node_modules/dsh-better-sidebar ] || [ ! -e node_modules/dsh-remote-desktop-companion ]; then
      CI=true pnpm install --no-frozen-lockfile --config.dangerouslyAllowAllBuilds=true >/tmp/dsh-rd-canary-install.log 2>&1
    fi
    pnpm rebuild node-pty >/tmp/dsh-rd-canary-node-pty.log 2>&1 || true
    node --input-type=module -e ${sh(verifyOllama)}
    nohup env DSH_HOME=~/.dsh-remote-desktop-canary DSH_TELEMETRY_DISABLED=1 ${ollamaApiKeyEnv}=${sh(ollamaApiKey)} dsh --profile web --host 127.0.0.1 --port ${remotePort} --trusted-host 127.0.0.1:${remotePort} > /tmp/dsh-rd-canary.log 2>&1 & echo $! > /tmp/dsh-rd-canary.pid
  `, { timeoutMs: 300000 })
  await waitRemoteDsh(remote.id)
  const workspace = await remoteRpc(remote.id, 'workspace.create', { path: '/tmp/dsh-rd-canary' })
  const session = await remoteRpc(remote.id, 'session.create', { workspaceId: workspace.workspace.workspaceId })
  await remoteRpc(remote.id, 'session.rename', { sessionId: session.sessionId, title: remote.title })
  await assertOllamaDefault(await remoteRpc(remote.id, 'session.models', { sessionId: session.sessionId }), remote.id)
}

async function setupLocal(seed) {
  await rm(canaryHome, { recursive: true, force: true })
  await mkdir(canaryWorkspace, { recursive: true })
  await writeFile(join(canaryWorkspace, 'README.md'), seed.local ?? 'Local Apple container acceptance canary workspace.\n')
  await runHarness(['--profile', 'web', '--dump-config'], { DSH_HOME: canaryHome }, 60000)
  const profile = join(canaryHome, 'profiles', 'web')
  await patchLocalProfile(profile)
  await writeFile(join(canaryHome, 'settings.yaml'), ollamaSettings(`${localOllamaBaseUrl}/v1`))
  await cmd('pnpm', ['install', '--no-frozen-lockfile'], { cwd: profile, env: { CI: 'true' }, timeoutMs: 120000 })
  const port = await freePort()
  const child = spawn('node', ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--trusted-host', `127.0.0.1:${port}`], {
    cwd: harnessRoot,
    env: { ...process.env, DSH_HOME: canaryHome, DSH_TELEMETRY_DISABLED: '1', DSH_REMOTE_DESKTOP_SSH_CONFIG: sshConfig, DSH_REMOTE_DESKTOP_SKIP_SETUP: '1', [ollamaApiKeyEnv]: ollamaApiKey },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  started.push(child)
  child.stdout.on('data', b => process.stdout.write(`[local dsh] ${b}`))
  child.stderr.on('data', b => process.stderr.write(`[local dsh] ${b}`))
  const base = `http://127.0.0.1:${port}`
  await waitRemoteDesktopApi(base, 60000)
  const workspace = await rpc(base, 'workspace.create', { path: canaryWorkspace })
  const session = await rpc(base, 'session.create', { workspaceId: workspace.workspace.workspaceId })
  await rpc(base, 'session.rename', { sessionId: session.sessionId, title: 'Local notes - Apple container acceptance overview' })
  await assertOllamaDefault(await rpc(base, 'session.models', { sessionId: session.sessionId }), 'local')
  return { base }
}

async function buildSeedText() {
  const topics = {
    local: 'Write a concise local DSH Remote Desktop canary note for manual testing.',
    'remote-a': 'Write a concise Remote A canary note mentioning sentinel A and terminal checks.',
    'remote-b': 'Write a concise Remote B canary note mentioning isolation from Remote A.',
  }
  const out = {}
  for (const [key, prompt] of Object.entries(topics)) out[key] = await ollamaText(prompt).catch(() => fallbackText(key))
  return out
}

async function ollamaText(prompt) {
  const response = await fetch(`${localOllamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, prompt, stream: false }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`ollama HTTP ${response.status}`)
  const json = await response.json()
  if (typeof json.response !== 'string' || json.response.trim() === '') throw new Error('ollama returned no text')
  return `${json.response.trim()}\n\nGenerated by local Ollama ${ollamaModel}.\n`
}

function fallbackText(key) {
  return `${key} Apple container acceptance canary fixture.\nOllama ${ollamaModel} did not generate seed text, so this static text was used.\n`
}

async function ensureOllama() {
  let models
  try {
    const response = await fetch(`${localOllamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    models = await response.json()
  } catch (error) {
    throw new Error(`Ollama is required for the canary default model. Start Ollama at ${localOllamaBaseUrl}.\n${error.message}`)
  }
  if (!models.models?.some(model => model.name === ollamaModel)) {
    throw new Error(`Ollama model ${ollamaModel} is missing. Run: ollama pull ${ollamaModel}`)
  }
}

async function ensureContainers() {
  await checkContainer()
  await prepareSshFiles()
  try {
    for (const remote of remotes) await ssh(remote.id, 'true', { timeoutMs: 5000 })
    console.log('Reusing running Apple container remotes.')
  } catch (error) {
    console.log(`Apple container remotes are not reusable; recreating them. ${error.message}`)
    await recreateContainers()
  }
}

function ollamaSettings(baseUrl) {
  return `agent-default-model:\n  provider: ollama\n  model: ${JSON.stringify(ollamaModel)}\nllm-pi-ai:\n  providers:\n    ollama:\n      displayName: Local Ollama\n      api: openai-completions\n      apiKeyEnv: ${ollamaApiKeyEnv}\n      baseURL: ${baseUrl}\n      models:\n        - id: ${JSON.stringify(ollamaModel)}\n          name: MiniCPM V 4.6 1B\n`
}

async function assertOllamaDefault(models, owner) {
  if (models.current?.provider !== 'ollama' || models.current?.model !== ollamaModel || models.routable !== true) {
    throw new Error(`${owner} did not expose routable default Ollama model ${ollamaModel}: ${JSON.stringify(models.current)}`)
  }
}

async function checkContainer() {
  try { await cmd(containerBin, ['system', 'start'], { input: 'y\n', timeoutMs: 180000 }) } catch (error) { throw new Error(`Apple container system failed to start.\n${error.message}`) }
  await cmd(containerBin, ['system', 'status'], { timeoutMs: 10000 })
}

async function prepareSshFiles() {
  await mkdir(stateDir, { recursive: true })
  if (!existsSync(sshKey)) await cmd('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', sshKey, '-C', 'dsh-remote-desktop-acceptance'], { timeoutMs: 10000 })
  await cp(sshPub, authorizedKeys)
  await writeFile(knownHosts, '')
  await writeFile(sshConfig, remotes.map(remote => `Host ${remote.id}
  HostName ${remote.id}
  User dsh
  IdentityFile ${sshKey}
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking no
  UserKnownHostsFile ${knownHosts}
  ProxyCommand ${containerBin} exec -i ${remote.container} socat - TCP:127.0.0.1:22
`).join('\n'))
}


async function prepareSshDebs() {
  const debDir = join(stateDir, 'debs')
  await mkdir(debDir, { recursive: true })
  const packages = [
    ['openssh-server_9.2p1-2+deb12u10_arm64.deb', 'https://deb.debian.org/debian/pool/main/o/openssh/openssh-server_9.2p1-2+deb12u10_arm64.deb'],
    ['openssh-sftp-server_9.2p1-2+deb12u10_arm64.deb', 'https://deb.debian.org/debian/pool/main/o/openssh/openssh-sftp-server_9.2p1-2+deb12u10_arm64.deb'],
    ['runit-helper_2.15.2_all.deb', 'https://deb.debian.org/debian/pool/main/d/dh-runit/runit-helper_2.15.2_all.deb'],
  ]
  for (const [name, url] of packages) {
    const target = join(debDir, name)
    if (existsSync(target)) continue
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`failed to download ${url}: HTTP ${response.status}`)
    await writeFile(target, Buffer.from(await response.arrayBuffer()))
  }
}

async function buildImage() {
  await container(['build', '--progress', 'plain', '-t', imageName, '-f', 'scripts/acceptance/container/Dockerfile.remote', '.'], { timeoutMs: 900000 })
}

async function container(argv, options = {}) {
  return await cmd(containerBin, argv, { timeoutMs: options.timeoutMs ?? 120000, input: options.input })
}

async function waitSsh(alias) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try { await ssh(alias, 'true', { timeoutMs: 5000 }); return } catch { await delay(1000) }
  }
  throw new Error(`SSH to ${alias} failed. Try: ssh -F ${sshConfig} ${alias} -vvv`)
}

async function waitRemoteDsh(alias) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try { await remoteRpc(alias, 'host.describe', {}); return } catch { await delay(1000) }
  }
  const log = await ssh(alias, 'cat /tmp/dsh-rd-canary.log 2>/dev/null || true').catch(() => '')
  throw new Error(`${alias} DSH did not boot. Log:\n${log}`)
}

async function copyCompanion(alias) {
  const tar = join(stateDir, `companion-${alias}.tar.gz`)
  await cmd('tar', ['czf', tar, '-C', companionDir, '.'])
  await ssh(alias, 'rm -rf /tmp/dsh-remote-desktop-companion && mkdir -p /tmp/dsh-remote-desktop-companion')
  await cmd('scp', ['-F', sshConfig, tar, `${alias}:/tmp/dsh-remote-desktop-companion.tar.gz`], { timeoutMs: 30000 })
  await ssh(alias, 'tar xzf /tmp/dsh-remote-desktop-companion.tar.gz -C /tmp/dsh-remote-desktop-companion')
}

async function patchLocalProfile(profile) {
  const packagePath = join(profile, 'package.json')
  const pkg = existsSync(packagePath) ? JSON.parse(await readFile(packagePath, 'utf8')) : { name: 'dsh-canary-profile', private: true }
  pkg.dependencies = pkg.dependencies || {}
  pkg.dependencies['dsh-remote-desktop'] = `link:${localPlugin}`
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (!pkg.dsh.profile.bundles.includes('dsh-remote-desktop')) pkg.dsh.profile.bundles.push('dsh-remote-desktop')
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function runHarness(argv, env, timeoutMs) { return await cmd('pnpm', ['dsh', ...argv], { cwd: harnessRoot, env, timeoutMs }) }

async function remoteRpc(alias, method, payload) {
  const script = `const method=${JSON.stringify(method)};const payload=${JSON.stringify(payload)};const rpcId=crypto.randomUUID();const res=await fetch('http://127.0.0.1:${remotePort}/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload})});if(!res.ok)throw new Error('HTTP '+res.status);const json=await res.json();if(!json.result?.ok)throw new Error(json.result?.error?.message||'rpc failed');console.log(JSON.stringify(json.result.value));`
  return JSON.parse(await ssh(alias, `node --input-type=module -e ${sh(script)}`))
}

async function rpc(base, method, payload) {
  const rpcId = randomUUID()
  const res = await fetch(`${base}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method, payload }) })
  const json = await res.json()
  if (!json.result?.ok) throw new Error(json.result?.error?.message || `${method} failed`)
  return json.result.value
}

async function api(base, path, init) {
  const res = await fetch(`${base}/remote-desktop/api${path}`, { headers: { 'content-type': 'application/json' }, ...init })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok !== true) throw new Error(json?.error?.message || `management ${path} HTTP ${res.status}`)
  return json
}

async function waitRemoteDesktopApi(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/remote-desktop/api/hosts`)
      const json = await res.json()
      if (json.ok === true) return
    } catch {}
    await delay(500)
  }
  throw new Error('timeout remote desktop api')
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

async function ssh(alias, command, options = {}) { return await cmd('ssh', ['-F', sshConfig, alias, command], { timeoutMs: options.timeoutMs ?? 30000 }) }

async function cmd(bin, argv, options = {}) {
  const result = spawnSync(bin, argv, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs ?? 30000,
    maxBuffer: 1024 * 1024 * 20,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${bin} ${argv.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

function stopStarted() {
  while (started.length > 0) {
    const child = started.pop()
    try { child.kill('SIGTERM') } catch {}
  }
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function sh(value) { return `'${String(value).replaceAll("'", "'\\''")}'` }
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) out[arg.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
    else out._.push(arg)
  }
  return out
}
