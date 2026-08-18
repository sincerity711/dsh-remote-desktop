import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const DEFAULT_REMOTE_DSH_PORT = 30800

export const name = 'dsh-remote-desktop'
export const inject = ['webServer']

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
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
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

function normalizeSource(input) {
  const sshAlias = input.sshAlias !== undefined ? String(input.sshAlias).trim() : undefined
  const id = String(input.id ?? sshAlias ?? slug(String(input.label ?? input.sshHost ?? randomUUID()))).trim()
  const label = String(input.label ?? id).trim()
  const sshHost = input.sshHost !== undefined ? String(input.sshHost).trim() : ''
  const sshUser = input.sshUser !== undefined ? String(input.sshUser).trim() : ''
  if (id === '' || label === '') throw new Error('id and label are required')
  if ((sshAlias === undefined || sshAlias === '') && (sshHost === '' || sshUser === '')) {
    throw new Error('sshAlias or sshHost and sshUser are required')
  }
  return {
    id,
    label,
    ...(sshAlias !== undefined && sshAlias !== '' ? { sshAlias } : {}),
    ...(sshHost !== '' ? { sshHost } : {}),
    ...(sshUser !== '' ? { sshUser } : {}),
    sshPort: Number(input.sshPort ?? DEFAULT_SSH_PORT),
    remoteDshHost: String(input.remoteDshHost ?? DEFAULT_REMOTE_HOST).trim() || DEFAULT_REMOTE_HOST,
    remoteDshPort: Number(input.remoteDshPort ?? DEFAULT_REMOTE_DSH_PORT),
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
  const deadline = Date.now() + 8000
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

function startProxyServer(targetPort) {
  const server = createServer((req, res) => {
    proxyHttp(req, res, targetPort).catch((error) => {
      if (!res.headersSent) writeError(res, 502, 'proxy_failed', error instanceof Error ? error.message : String(error))
      else res.destroy()
    })
  })
  server.on('upgrade', (req, socket, head) => {
    proxyUpgrade(req, socket, head, targetPort).catch(() => { socket.destroy() })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address !== 'object' || address === null) {
        reject(new Error('proxy server has no TCP address'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

async function proxyHttp(req, res, targetPort) {
  const headers = { ...req.headers }
  headers.host = `127.0.0.1:${targetPort}`
  if (headers.origin !== undefined) headers.origin = `http://127.0.0.1:${targetPort}`
  const upstream = httpRequest({
    host: '127.0.0.1',
    port: targetPort,
    method: req.method,
    path: req.url,
    headers,
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  })
  upstream.on('error', (error) => {
    if (!res.headersSent) writeError(res, 502, 'proxy_failed', error.message)
    else res.destroy(error)
  })
  req.pipe(upstream)
}

async function proxyUpgrade(req, socket, head, targetPort) {
  const upstream = netConnect({ host: '127.0.0.1', port: targetPort })
  upstream.on('error', () => { socket.destroy() })
  upstream.once('connect', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
    const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` }
    if (headers.origin !== undefined) headers.origin = `http://127.0.0.1:${targetPort}`
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


async function proxyHostApi(req, res, source) {
  const runtime = runtimesForProxy.get(source.id)
  if (runtime?.state !== 'connected' || runtime.tunnelPort === undefined) throw new Error('source is not connected')
  const url = new URL(req.url ?? '/', 'http://local')
  const path = url.searchParams.get('path') ?? '/'
  if (!path.startsWith('/api/')) throw new Error('host API path must start with /api/')
  const headers = { ...req.headers }
  delete headers.host
  if (headers.origin !== undefined) headers.origin = `http://127.0.0.1:${runtime.tunnelPort}`
  const upstream = httpRequest({
    host: '127.0.0.1',
    port: runtime.tunnelPort,
    method: req.method,
    path,
    headers: { ...headers, host: `127.0.0.1:${runtime.tunnelPort}` },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  })
  upstream.on('error', (error) => {
    if (!res.headersSent) writeError(res, 502, 'proxy_failed', error.message)
    else res.destroy(error)
  })
  req.pipe(upstream)
}

let runtimesForProxy

async function rpc(port, method, payload = {}) {
  const rpcId = randomUUID()
  const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`remote ${method} HTTP ${response.status}`)
  const parsed = await response.json()
  if (parsed.rpcId !== rpcId) throw new Error(`remote ${method} rpcId mismatch`)
  if (!parsed.result?.ok) throw new Error(parsed.result?.error?.message ?? `remote ${method} failed`)
  return parsed.result.value
}

export async function apply(ctx) {
  let sources = await loadSources()
  const runtimes = new Map()
  runtimesForProxy = runtimes

  async function persist(next) {
    await saveSources(next)
    sources = await loadSources()
  }

  async function connectSource(id) {
    sources = await loadSources()
    const source = sources.find(item => item.id === id)
    if (source === undefined) throw new Error(`unknown source ${id}`)
    const existing = runtimes.get(id)
    if (existing?.state === 'connected' || existing?.state === 'connecting') return existing

    const runtime = { state: 'connecting', error: null, token: randomUUID() }
    runtimes.set(id, runtime)
    try {
      const tunnelPort = await freePort()
      const sshArgs = [
        '-N',
        '-L', `127.0.0.1:${tunnelPort}:${source.remoteDshHost}:${source.remoteDshPort}`,
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
        ...(source.sshAlias && process.env.DSH_REMOTE_DESKTOP_SSH_CONFIG ? ['-F', sshConfigPath()] : []),
        ...(source.sshAlias ? [source.sshAlias] : ['-p', String(source.sshPort), `${source.sshUser}@${source.sshHost}`]),
      ]
      const proc = spawn('ssh', sshArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
      runtime.ssh = proc
      let stderr = ''
      proc.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 4000) })
      proc.once('exit', (code, signal) => {
        const current = runtimes.get(id)
        if (current !== runtime) return
        current.state = 'disconnected'
        current.error = stderr.trim() || `ssh exited (${code ?? signal ?? 'unknown'})`
        current.proxy?.server.close()
      })
      const abort = new AbortController()
      await waitTcp(tunnelPort, abort.signal)
      const proxy = await startProxyServer(tunnelPort)
      runtime.tunnelPort = tunnelPort
      runtime.proxy = proxy
      runtime.iframeUrl = `http://127.0.0.1:${proxy.port}/?dshRemoteDesktop=1#token=${encodeURIComponent(runtime.token)}`
      runtime.state = 'connected'
      runtime.error = null
      return runtime
    } catch (error) {
      runtime.state = 'error'
      runtime.error = error instanceof Error ? error.message : String(error)
      runtime.ssh?.kill()
      runtime.proxy?.server.close()
      throw error
    }
  }

  function disconnectSource(id) {
    const runtime = runtimes.get(id)
    if (runtime === undefined) return
    runtime.state = 'disconnected'
    runtime.error = null
    runtime.ssh?.kill()
    runtime.proxy?.server.close()
    runtimes.delete(id)
  }

  async function snapshotSource(id) {
    const runtime = runtimes.get(id)
    if (runtime?.state !== 'connected' || runtime.tunnelPort === undefined) throw new Error('source is not connected')
    const [sessions, workspaces] = await Promise.all([
      rpc(runtime.tunnelPort, 'session.list', {}),
      rpc(runtime.tunnelPort, 'workspace.list', {}),
    ])
    return { sessions, workspaces }
  }

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://local').pathname
      const suffix = pathname.slice(API_PREFIX.length) || '/'
      try {
        if (suffix === '/host-api') {
          const url = new URL(req.url ?? '/', 'http://local')
          const id = url.searchParams.get('id') ?? ''
          sources = await loadSources()
          const source = sources.find(item => item.id === id)
          if (source === undefined) throw new Error(`unknown source ${id}`)
          await proxyHostApi(req, res, source)
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
          const { id } = await readJson(req)
          const runtime = await connectSource(String(id))
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
        if (req.method === 'GET' && suffix === '/snapshot') {
          const id = new URL(req.url ?? '/', 'http://local').searchParams.get('id') ?? ''
          writeJson(res, 200, { ok: true, snapshot: await snapshotSource(id) })
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
    for (const id of [...runtimes.keys()]) disconnectSource(id)
  }, 'dsh-remote-desktop: runtime cleanup')
}
