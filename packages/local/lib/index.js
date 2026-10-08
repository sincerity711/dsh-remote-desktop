import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const DEFAULT_REMOTE_DSH_PORT = 30800
export const REMOTE_COMPANION_PACKAGE = 'dsh-ssh-workspace-companion'
export const REMOTE_COMPANION_HEALTH_PATH = '/remote-desktop-companion/api/health'

export const name = 'dsh-remote-desktop'
export const inject = ['webServer', 'connection']

const API_PREFIX = '/remote-desktop/api'
const DEFAULT_REMOTE_HOST = '127.0.0.1'
const DEFAULT_SSH_PORT = 22

function statePath() {
  const root = process.env.DSH_REMOTE_DESKTOP_HOME
    ?? (process.env.DSH_HOME !== undefined ? join(process.env.DSH_HOME, 'remote-desktop') : join(homedir(), '.dsh', 'remote-desktop'))
  return join(root, 'sources.json')
}


function sshConfigPath() {
  return process.env.DSH_REMOTE_DESKTOP_SSH_CONFIG ?? join(homedir(), '.ssh', 'config')
}

export function parseSshConfig(content) {
  const hosts = []
  let current = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'host') {
      current = value.split(/\s+/).filter(Boolean)
      for (const alias of current) {
        if (!isConcreteSshHost(alias)) continue
        hosts.push({ id: alias, label: alias, sshAlias: alias, remoteDshHost: DEFAULT_REMOTE_HOST, remoteDshPort: DEFAULT_REMOTE_DSH_PORT })
      }
      continue
    }
    for (const host of hosts) {
      if (!current.includes(host.sshAlias)) continue
      if (key === 'hostname') host.sshHost = value
      else if (key === 'user') host.sshUser = value
      else if (key === 'port') host.sshPort = Number(value)
    }
  }
  return dedupeHosts(hosts)
}

function isConcreteSshHost(alias) {
  return alias !== '' && !alias.includes('*') && !alias.includes('?') && alias !== '!'
}

function dedupeHosts(hosts) {
  const seen = new Set()
  const result = []
  for (const host of hosts) {
    if (seen.has(host.id)) continue
    seen.add(host.id)
    result.push(host)
  }
  return result
}

async function loadSshHosts() {
  try {
    return parseSshConfig(await readFile(sshConfigPath(), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function mergeSshHosts(sshHosts, savedSources) {
  const byId = new Map()
  for (const host of sshHosts) byId.set(host.id, host)
  for (const source of savedSources) byId.set(source.id, { ...byId.get(source.id), ...source })
  return [...byId.values()]
}

function publicSource(source, runtime) {
  return {
    ...source,
    state: runtime?.state ?? 'disconnected',
    error: runtime?.error ?? null,
    iframeUrl: runtime?.iframeUrl,
    token: runtime?.token,
  }
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('request body too large')
    chunks.push(Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function writeError(res, status, code, message) {
  writeJson(res, status, { ok: false, error: { code, message } })
}

export function normalizeSource(input) {
  const sshAlias = input.sshAlias !== undefined ? String(input.sshAlias).trim() : undefined
  const id = String(input.id ?? sshAlias ?? slug(String(input.label ?? input.sshHost ?? randomUUID()))).trim()
  const label = String(input.label ?? id).trim()
  const sshHost = input.sshHost !== undefined ? String(input.sshHost).trim() : ''
  const sshUser = input.sshUser !== undefined ? String(input.sshUser).trim() : ''
  if (id === '' || label === '') throw new Error('id and label are required')
  if (id.length > 200 || label.length > 200) throw new Error('id and label must not exceed 200 characters')
  if ((sshAlias === undefined || sshAlias === '') && (sshHost === '' || sshUser === '')) {
    throw new Error('sshAlias or sshHost and sshUser are required')
  }
  const sshPort = Number(input.sshPort ?? DEFAULT_SSH_PORT)
  const remoteDshPort = Number(input.remoteDshPort ?? DEFAULT_REMOTE_DSH_PORT)
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new Error('sshPort must be an integer from 1 to 65535')
  if (!Number.isInteger(remoteDshPort) || remoteDshPort < 1 || remoteDshPort > 65535) throw new Error('remoteDshPort must be an integer from 1 to 65535')
  return {
    id,
    label,
    ...(sshAlias !== undefined && sshAlias !== '' ? { sshAlias } : {}),
    ...(sshHost !== '' ? { sshHost } : {}),
    ...(sshUser !== '' ? { sshUser } : {}),
    sshPort,
    remoteDshHost: String(input.remoteDshHost ?? DEFAULT_REMOTE_HOST).trim() || DEFAULT_REMOTE_HOST,
    remoteDshPort,
    autoConnect: input.autoConnect !== false,
  }
}

function slug(value) {
  const base = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return base || `remote-${createHash('sha1').update(value).digest('hex').slice(0, 8)}`
}

async function loadSavedSources() {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8'))
    return Array.isArray(parsed.sources) ? parsed.sources.map(normalizeSource) : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function loadSources() {
  return mergeSshHosts(await loadSshHosts(), await loadSavedSources())
}

async function saveSources(sources) {
  const file = statePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ sources }, null, 2)}\n`, 'utf8')
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : undefined
  await new Promise(resolve => server.close(resolve))
  if (port === undefined) throw new Error('failed to allocate local port')
  return port
}

async function waitTcp(port, signal) {
  const deadline = Date.now() + 30000
  let lastError
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('connection aborted')
    try {
      await new Promise((resolve, reject) => {
        const socket = netConnect({ host: '127.0.0.1', port })
        socket.once('connect', () => { socket.end(); resolve() })
        socket.once('error', reject)
        socket.setTimeout(500, () => { socket.destroy(new Error('timeout')) })
      })
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 150))
    }
  }
  throw lastError ?? new Error('timed out waiting for tunnel')
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function sshDestinationArgs(source) {
  return [
    ...(source.sshAlias && process.env.DSH_REMOTE_DESKTOP_SSH_CONFIG ? ['-F', sshConfigPath()] : []),
    ...(source.sshAlias ? [source.sshAlias] : ['-p', String(source.sshPort), `${source.sshUser}@${source.sshHost}`]),
  ]
}

const REMOTE_BROWSE_SCRIPT = String.raw`
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function isHidden(name) {
  return name.startsWith('.') && name !== '.' && name !== '..'
}

async function main() {
  const input = JSON.parse(await readStdin() || '{}')
  const home = await fs.realpath(os.homedir())
  const requested = typeof input.path === 'string' && input.path !== '' ? input.path : home
  const current = await fs.realpath(requested)
  const stat = await fs.stat(current)
  if (!stat.isDirectory()) throw new Error('path is not a directory')
  const dirents = await fs.readdir(current, { withFileTypes: true })
  const entries = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    if (!input.hidden && isHidden(dirent.name)) continue
    entries.push({
      name: dirent.name,
      path: path.join(current, dirent.name),
      hidden: isHidden(dirent.name),
    })
  }
  entries.sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const parent = path.dirname(current)
  process.stdout.write(JSON.stringify({
    path: current,
    home,
    ...(parent !== current ? { parent } : {}),
    entries,
  }))
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
`

export function buildRemoteBrowseSshArgs(source) {
  return [
    '-o', 'BatchMode=yes',
    ...sshDestinationArgs(source),
    `node -e ${shellQuote(REMOTE_BROWSE_SCRIPT)}`,
  ]
}


function remoteSetupScript(source, options = {}) {
  return `set -e
export DSH_REMOTE_DESKTOP_HOST=${shellQuote(source.remoteDshHost)}
export DSH_REMOTE_DESKTOP_PORT=${shellQuote(String(source.remoteDshPort))}
export DSH_REMOTE_DESKTOP_COMPANION=${shellQuote(REMOTE_COMPANION_PACKAGE)}
export DSH_REMOTE_DESKTOP_HEALTH=${shellQuote(REMOTE_COMPANION_HEALTH_PATH)}
export DSH_REMOTE_DESKTOP_INSTALL=${options.install === true ? '1' : '0'}
export DSH_REMOTE_DESKTOP_LOG="/tmp/dsh-remote-desktop-$DSH_REMOTE_DESKTOP_PORT.log"
remote_desktop_has_dsh() {
  node -e "const url='http://' + process.env.DSH_REMOTE_DESKTOP_HOST + ':' + process.env.DSH_REMOTE_DESKTOP_PORT + '/'; fetch(url).then(()=>process.exit(0),()=>process.exit(1))"
}
remote_desktop_has_companion() {
  node -e "fetch('http://' + process.env.DSH_REMOTE_DESKTOP_HOST + ':' + process.env.DSH_REMOTE_DESKTOP_PORT + process.env.DSH_REMOTE_DESKTOP_HEALTH).then(r=>r.ok?0:1,()=>1).then(code=>process.exit(code))"
}
remote_desktop_print_auth_url() {
  if [ -f "$DSH_REMOTE_DESKTOP_LOG" ]; then
    grep -Eo 'http://[^[:space:]]+[?]token=[^[:space:]]+' "$DSH_REMOTE_DESKTOP_LOG" | tail -n 1 || true
  fi
}
remote_desktop_companion_configured() {
  node -e "const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const root=process.env.DSH_HOME || path.join(os.homedir(), '.dsh'); const pkg=JSON.parse(fs.readFileSync(path.join(root, 'profiles/web/package.json'), 'utf8')); const name=process.env.DSH_REMOTE_DESKTOP_COMPANION; const bundles=pkg?.dsh?.profile?.bundles || []; const deps=pkg?.dependencies || {}; process.exit(bundles.includes(name) || Object.prototype.hasOwnProperty.call(deps, name) ? 0 : 1)"
}
remote_desktop_stop_listener() {
  pidfile="/tmp/dsh-remote-desktop-$DSH_REMOTE_DESKTOP_PORT.pid"
  if [ ! -f "$pidfile" ]; then
    echo "remote DSH port is occupied by a process not owned by remote desktop; stop it explicitly" >&2
    exit 79
  fi
  pid=$(cat "$pidfile")
  case "$pid" in (*[!0-9]*|'') echo "invalid remote desktop pid file" >&2; exit 79;; esac
  kill "$pid" 2>/dev/null || true
  rm -f "$pidfile"
  sleep 1
}
remote_desktop_start_dsh() {
  nohup dsh --profile web --host "$DSH_REMOTE_DESKTOP_HOST" --port "$DSH_REMOTE_DESKTOP_PORT" --trusted-host "$DSH_REMOTE_DESKTOP_HOST:$DSH_REMOTE_DESKTOP_PORT" > "$DSH_REMOTE_DESKTOP_LOG" 2>&1 < /dev/null &
  echo $! > "/tmp/dsh-remote-desktop-$DSH_REMOTE_DESKTOP_PORT.pid"
}
if ! command -v dsh >/dev/null 2>&1; then
  echo "remote dsh is not installed or is not on PATH" >&2
  exit 127
fi
if remote_desktop_has_companion; then
  remote_desktop_print_auth_url
  exit 0
fi
if [ "$DSH_REMOTE_DESKTOP_INSTALL" = "1" ]; then
  dsh plugin --profile web add "$DSH_REMOTE_DESKTOP_COMPANION"
elif ! remote_desktop_companion_configured; then
  echo "remote companion is not installed in the remote web profile" >&2
  exit 78
fi
if remote_desktop_has_companion; then
  exit 0
fi
if remote_desktop_has_dsh; then
  auth_url=$(remote_desktop_print_auth_url)
  pidfile="/tmp/dsh-remote-desktop-$DSH_REMOTE_DESKTOP_PORT.pid"
  if [ -n "$auth_url" ] && [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    case "$pid" in (*[!0-9]*|'') :;; (*) if kill -0 "$pid" 2>/dev/null; then printf '%s\\n' "$auth_url"; exit 0; fi;; esac
  fi
  remote_desktop_stop_listener
fi
remote_desktop_start_dsh
for _ in $(seq 1 100); do
  if remote_desktop_has_dsh; then
    auth_url=$(remote_desktop_print_auth_url)
    if [ -n "$auth_url" ]; then printf '%s\\n' "$auth_url"; exit 0; fi
  fi
  sleep 0.2
done
echo "remote DSH did not become ready" >&2
exit 80
`
}

export function buildRemoteSetupSshArgs(source, options = { install: true }) {
  return [
    '-o', 'BatchMode=yes',
    ...sshDestinationArgs(source),
    `sh -lc ${shellQuote(remoteSetupScript(source, options))}`,
  ]
}

export function parseBrowseHidden(value) {
  return value === '1' || value === 'true'
}

function normalizeBrowseResult(value) {
  if (typeof value?.path !== 'string' || typeof value?.home !== 'string' || !Array.isArray(value.entries)) throw new Error('invalid browse response')
  return {
    path: value.path,
    home: value.home,
    ...(typeof value.parent === 'string' ? { parent: value.parent } : {}),
    entries: value.entries.flatMap((entry) => {
      if (typeof entry?.name !== 'string' || typeof entry?.path !== 'string') return []
      return [{ name: entry.name, path: entry.path, hidden: Boolean(entry.hidden) }]
    }),
  }
}

async function browseRemoteDirectory(source, input, runtime) {
  if (runtime?.state !== 'connected') throw new Error('source is not connected')
  const proc = spawn('ssh', buildRemoteBrowseSshArgs(source), { stdio: ['pipe', 'pipe', 'pipe'] })
  const timer = setTimeout(() => { proc.kill() }, 10000)
  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', chunk => {
    stdout += String(chunk)
    if (stdout.length > 1024 * 1024) proc.kill()
  })
  proc.stderr.on('data', chunk => { stderr = appendCapped(stderr, chunk) })
  proc.stdin.end(JSON.stringify({ path: input.path, hidden: Boolean(input.hidden) }))
  const code = await new Promise((resolve, reject) => {
    proc.once('error', reject)
    proc.once('exit', code => resolve(code))
  }).finally(() => clearTimeout(timer))
  if (code !== 0) throw new Error(stderr.trim() || `remote browse failed (${code})`)
  return normalizeBrowseResult(JSON.parse(stdout))
}

async function exchangeRemoteAuthCookie(targetPort, upstreamAuthority, authToken) {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port: targetPort,
      method: 'GET',
      path: authToken ? `/?token=${encodeURIComponent(authToken)}` : '/',
      headers: { host: upstreamAuthority },
    }, (response) => {
      response.resume()
      const cookies = response.headers['set-cookie'] ?? []
      const cookie = cookies.map(value => value.split(';', 1)[0]).filter(Boolean).join('; ')
      const status = response.statusCode ?? 502
      if (!authToken && status >= 200 && status < 400) resolve(undefined)
      else if (authToken && status >= 300 && status < 400 && cookie !== '') resolve(cookie)
      else if (!authToken && status === 401) reject(new Error('remote DSH requires authentication, but its launch token was not available'))
      else reject(new Error(`remote DSH authentication failed (HTTP ${status})`))
    })
    request.once('error', reject)
    request.end()
  })
}

export async function startProxyServer(targetPort, upstreamAuthority, authToken) {
  const authCookie = await exchangeRemoteAuthCookie(targetPort, upstreamAuthority, authToken)
  const server = createServer((req, res) => {
    proxyHttp(req, res, targetPort, upstreamAuthority, authCookie).catch((error) => {
      if (!res.headersSent) writeError(res, 502, 'proxy_failed', error instanceof Error ? error.message : String(error))
      else res.destroy()
    })
  })
  server.on('upgrade', (req, socket, head) => {
    proxyUpgrade(req, socket, head, targetPort, upstreamAuthority, authCookie).catch(() => { socket.destroy() })
  })
  server.on('clientError', (_error, socket) => { socket.destroy() })
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    // Browser/WebSocket disconnects commonly surface as ECONNRESET. A raw
    // net.Socket without an error listener would otherwise terminate DSH.
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address !== 'object' || address === null) {
        reject(new Error('proxy server has no TCP address'))
        return
      }
      resolve({ server, port: address.port, sockets })
    })
  })
}

export function closeProxy(proxy) {
  if (proxy === undefined) return
  for (const socket of proxy.sockets) socket.destroy()
  proxy.server.close()
}

async function proxyHttp(req, res, targetPort, upstreamAuthority, authCookie) {
  const headers = { ...req.headers }
  headers.host = upstreamAuthority
  if (headers.origin !== undefined) headers.origin = `http://${upstreamAuthority}`
  // Loopback cookies are shared across ports. Never forward a cookie from the
  // local shell or another remote proxy; the proxy-owned upstream session is
  // the only DSH credential valid for this tunnel.
  if (authCookie !== undefined) headers.cookie = authCookie
  else delete headers.cookie
  const upstream = httpRequest({
    host: '127.0.0.1',
    port: targetPort,
    method: req.method,
    path: req.url,
    headers,
  }, (upstreamRes) => {
    const responseHeaders = { ...upstreamRes.headers }
    // The browser must not persist an upstream DSH cookie on 127.0.0.1, where
    // it would be sent to every local and remote proxy port.
    delete responseHeaders['set-cookie']
    res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders)
    upstreamRes.pipe(res)
  })
  upstream.on('error', (error) => {
    if (!res.headersSent) writeError(res, 502, 'proxy_failed', error.message)
    else res.destroy()
  })
  req.on('error', () => { upstream.destroy() })
  req.pipe(upstream)
}

async function proxyUpgrade(req, socket, head, targetPort, upstreamAuthority, authCookie) {
  const upstream = netConnect({ host: '127.0.0.1', port: targetPort })
  socket.on('error', () => { upstream.destroy() })
  upstream.on('error', () => { socket.destroy() })
  upstream.once('connect', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
    const headers = { ...req.headers, host: upstreamAuthority }
    if (headers.origin !== undefined) headers.origin = `http://${upstreamAuthority}`
    if (authCookie !== undefined) headers.cookie = authCookie
    else delete headers.cookie
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`)
      else if (value !== undefined) lines.push(`${key}: ${value}`)
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length > 0) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
}


async function probeRemoteCompanion(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${REMOTE_COMPANION_HEALTH_PATH}`, { signal: AbortSignal.timeout(5000) })
    if (response.ok) {
      const parsed = await response.json().catch(() => null)
      if (parsed?.ok === true && parsed?.name === REMOTE_COMPANION_PACKAGE) return
    }
  } catch {
    // Older companion builds have no health route, so verify their boot marker below.
  }
  const response = await fetch(`http://127.0.0.1:${port}/?dshRemoteDesktop=1`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`remote web HTTP ${response.status}`)
  const html = await response.text()
  if (!html.includes(REMOTE_COMPANION_PACKAGE)) throw new Error('remote companion is not installed or is not enabled in the remote web profile')
}

async function verifyRemoteReady(port, signal) {
  const deadline = Date.now() + 60000
  let lastError
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error('connection aborted')
    try {
      await probeRemoteCompanion(port)
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  throw lastError ?? new Error('timed out waiting for remote dsh')
}

function processOutput(stdout, stderr) {
  return [stderr, stdout].map(value => value.trim()).filter(Boolean).join('\n')
}

function sourceSshLabel(source) {
  return source.sshAlias ?? `${source.sshUser}@${source.sshHost}:${source.sshPort}`
}

function sshFailureMessage(source, phase, code, signal, stdout, stderr) {
  const reason = processOutput(stdout, stderr)
  const status = code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`
  return `${phase} failed for ${sourceSshLabel(source)} (${status})${reason ? `: ${reason}` : ''}`
}

function appendCapped(current, chunk, limit = 4000) {
  return `${current}${String(chunk)}`.slice(-limit)
}

async function runSsh(source, args, phase, signal) {
  const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', chunk => { stdout = appendCapped(stdout, chunk) })
  proc.stderr.on('data', chunk => { stderr = appendCapped(stderr, chunk) })
  const abort = () => { proc.kill() }
  signal?.addEventListener('abort', abort, { once: true })
  const result = await new Promise((resolve, reject) => {
    proc.once('error', error => reject(new Error(`${phase} failed for ${sourceSshLabel(source)}: ${error.message}`)))
    proc.once('exit', (code, signal) => resolve({ code, signal }))
  }).finally(() => signal?.removeEventListener('abort', abort))
  if (signal?.aborted) throw signal.reason ?? new Error(`${phase} aborted`)
  if (result.code !== 0) throw new Error(sshFailureMessage(source, phase, result.code, result.signal, stdout, stderr))
  return stdout
}

async function waitForSshTunnel(source, proc, port, stderrRef, signal) {
  const exited = new Promise((_, reject) => {
    proc.once('exit', (code, exitSignal) => reject(new Error(sshFailureMessage(source, 'SSH tunnel', code, exitSignal, '', stderrRef()))))
  })
  await Promise.race([waitTcp(port, signal), exited])
}

async function setupRemoteCompanion(source, options = { install: true }, signal) {
  return await runSsh(source, buildRemoteSetupSshArgs(source, options), options.install === true ? 'remote setup over SSH' : 'remote auto-start over SSH', signal)
}

function authTokenFromSetupOutput(output) {
  const lines = String(output).trim().split(/\r?\n/)
  for (const line of lines.reverse()) {
    try {
      const token = new URL(line.trim()).searchParams.get('token')
      if (token) return token
    } catch {}
  }
  return undefined
}

export async function apply(ctx) {
  let sources = await loadSources()
  let disposed = false
  const runtimes = new Map()
  const sourceEventClients = new Set()
  const publishSourcesChanged = () => {
    for (const res of [...sourceEventClients]) {
      if (res.destroyed) sourceEventClients.delete(res)
      else res.write(`data: ${Date.now()}\n\n`)
    }
  }

  const scheduleReconnect = (id, runtime) => {
    if (runtime.reconnectTimer !== undefined || runtime.abort.signal.aborted) return
    const configured = sources.find(item => item.id === id)
    if (configured?.autoConnect !== true) return
    const attempt = Math.min(runtime.reconnectAttempt + 1, 6)
    runtime.reconnectTimer = setTimeout(() => {
      if (runtimes.get(id) !== runtime) return
      runtimes.delete(id)
      void connectSource(id, { startPrepared: true, reconnectAttempt: attempt }).catch(() => {})
    }, Math.min(1000 * (2 ** attempt), 30000))
    runtime.reconnectTimer.unref?.()
  }

  async function persist(next) {
    await saveSources(next)
    sources = await loadSources()
  }

  async function connectSource(id, options = {}) {
    if (disposed) throw new Error('remote desktop plugin is disposed')
    sources = await loadSources()
    const source = sources.find(item => item.id === id)
    if (source === undefined) throw new Error(`unknown source ${id}`)
    const existing = runtimes.get(id)
    if (existing?.state === 'connected') return existing
    if (existing?.state === 'connecting') {
      disconnectSource(id)
    }

    const runtime = {
      state: 'connecting', error: null, token: randomUUID(),
      abort: new AbortController(), reconnectAttempt: options.reconnectAttempt ?? 0,
    }
    runtimes.set(id, runtime)
    publishSourcesChanged()
    try {
      let setupOutput = ''
      if (options.setup === true) setupOutput = await setupRemoteCompanion(source, { install: true }, runtime.abort.signal)
      else if (options.startPrepared === true) setupOutput = await setupRemoteCompanion(source, { install: false }, runtime.abort.signal)
      runtime.authToken = authTokenFromSetupOutput(setupOutput)
      if (runtimes.get(id) !== runtime) throw new Error('connection superseded')
      const tunnelPort = await freePort()
      const sshArgs = [
        '-N',
        '-L', `127.0.0.1:${tunnelPort}:${source.remoteDshHost}:${source.remoteDshPort}`,
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
        ...sshDestinationArgs(source),
      ]
      const proc = spawn('ssh', sshArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
      runtime.ssh = proc
      let stderr = ''
      proc.stderr.on('data', chunk => { stderr = appendCapped(stderr, chunk) })
      proc.once('exit', (code, signal) => {
        const current = runtimes.get(id)
        if (current !== runtime) return
        current.state = 'disconnected'
        current.error = stderr.trim() || `ssh exited (${code ?? signal ?? 'unknown'})`
        closeProxy(current.proxy)
        publishSourcesChanged()
        scheduleReconnect(id, current)
      })
      await waitForSshTunnel(source, proc, tunnelPort, () => stderr, runtime.abort.signal)
      await verifyRemoteReady(tunnelPort, runtime.abort.signal)
      if (runtimes.get(id) !== runtime || runtime.abort.signal.aborted) throw new Error('connection superseded')
      const upstreamAuthority = `${source.remoteDshHost}:${source.remoteDshPort}`
      const proxy = await startProxyServer(tunnelPort, upstreamAuthority, runtime.authToken)
      if (runtimes.get(id) !== runtime || runtime.abort.signal.aborted) {
        closeProxy(proxy)
        throw new Error('connection superseded')
      }
      runtime.tunnelPort = tunnelPort
      runtime.proxy = proxy
      runtime.iframeUrl = `http://127.0.0.1:${proxy.port}/?dshRemoteDesktop=1#token=${encodeURIComponent(runtime.token)}`
      runtime.state = 'connected'
      runtime.error = null
      runtime.reconnectAttempt = 0
      publishSourcesChanged()
      return runtime
    } catch (error) {
      runtime.state = 'error'
      runtime.error = error instanceof Error ? error.message : String(error)
      runtime.ssh?.kill()
      closeProxy(runtime.proxy)
      publishSourcesChanged()
      if (runtimes.get(id) === runtime) scheduleReconnect(id, runtime)
      throw error
    }
  }

  function disconnectSource(id) {
    const runtime = runtimes.get(id)
    if (runtime === undefined) return
    runtime.state = 'disconnected'
    runtime.error = null
    runtime.abort?.abort(new Error('source disconnected'))
    if (runtime.reconnectTimer !== undefined) clearTimeout(runtime.reconnectTimer)
    runtime.ssh?.kill()
    closeProxy(runtime.proxy)
    runtimes.delete(id)
    publishSourcesChanged()
  }

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://local').pathname
      const suffix = pathname.slice(API_PREFIX.length) || '/'
      try {
        if (req.method === 'GET' && suffix === '/events') {
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          })
          sourceEventClients.add(res)
          res.write(`data: ${Date.now()}\n\n`)
          const timer = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n') }, 15000)
          req.once('close', () => { clearInterval(timer); sourceEventClients.delete(res) })
          return
        }
        if (req.method === 'GET' && suffix === '/sources') {
          sources = await loadSources()
          writeJson(res, 200, { ok: true, sources: sources.map(source => publicSource(source, runtimes.get(source.id))) })
          return
        }
        if (req.method === 'GET' && suffix === '/hosts') {
          sources = await loadSources()
          writeJson(res, 200, { ok: true, hosts: sources.map(source => publicSource(source, runtimes.get(source.id))) })
          return
        }
        if (req.method === 'POST' && suffix === '/sources') {
          const input = await readJson(req)
          const source = normalizeSource(input)
          const saved = await loadSavedSources()
          const next = [...saved.filter(item => item.id !== source.id), source]
          await persist(next)
          const current = sources.find(item => item.id === source.id) ?? source
          writeJson(res, 200, { ok: true, source: publicSource(current, runtimes.get(source.id)) })
          return
        }
        if (req.method === 'POST' && suffix === '/connect') {
          const { id, setup } = await readJson(req)
          const defaultSetup = process.env.DSH_REMOTE_DESKTOP_SKIP_SETUP !== '1'
          const shouldInstall = setup ?? defaultSetup
          const runtime = await connectSource(String(id), shouldInstall ? { setup: true } : { startPrepared: true })
          const source = sources.find(item => item.id === String(id))
          writeJson(res, 200, { ok: true, source: publicSource(source, runtime) })
          return
        }
        if (req.method === 'POST' && suffix === '/disconnect') {
          const { id } = await readJson(req)
          disconnectSource(String(id))
          writeJson(res, 200, { ok: true })
          return
        }
        if (req.method === 'POST' && suffix === '/delete') {
          const { id } = await readJson(req)
          disconnectSource(String(id))
          await persist((await loadSavedSources()).filter(item => item.id !== String(id)))
          writeJson(res, 200, { ok: true })
          return
        }
        if (req.method === 'GET' && suffix === '/browse') {
          const url = new URL(req.url ?? '/', 'http://local')
          const id = url.searchParams.get('id') ?? ''
          sources = await loadSources()
          const source = sources.find(item => item.id === id)
          if (source === undefined) throw new Error(`unknown source ${id}`)
          const path = url.searchParams.get('path') ?? undefined
          const hidden = parseBrowseHidden(url.searchParams.get('hidden') ?? '')
          writeJson(res, 200, { ok: true, ...(await browseRemoteDirectory(source, { path, hidden }, runtimes.get(id))) })
          return
        }
        writeError(res, 404, 'not_found', `unknown remote-desktop route ${suffix}`)
      } catch (error) {
        writeError(res, 400, 'remote_desktop_error', error instanceof Error ? error.message : String(error))
      }
    },
  })

  ctx.effect(() => disposeRoute, 'dsh-remote-desktop: management routes')
  ctx.effect(() => () => {
    disposed = true
    for (const res of sourceEventClients) res.end()
    sourceEventClients.clear()
    for (const id of [...runtimes.keys()]) disconnectSource(id)
  }, 'dsh-remote-desktop: runtime cleanup')

  void (async () => {
    sources = await loadSources()
    if (disposed) return
    await Promise.allSettled(sources.filter(source => source.autoConnect === true).map(source => connectSource(source.id, { startPrepared: true })))
  })()
}
