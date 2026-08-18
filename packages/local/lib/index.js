import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

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
  const id = String(input.id ?? slug(String(input.label ?? input.sshHost ?? randomUUID()))).trim()
  const label = String(input.label ?? id).trim()
  const sshHost = String(input.sshHost ?? '').trim()
  const sshUser = String(input.sshUser ?? '').trim()
  if (id === '' || label === '' || sshHost === '' || sshUser === '') {
    throw new Error('id, label, sshHost, and sshUser are required')
  }
  return {
    id,
    label,
    sshHost,
    sshUser,
    sshPort: Number(input.sshPort ?? DEFAULT_SSH_PORT),
    remoteDshHost: String(input.remoteDshHost ?? DEFAULT_REMOTE_HOST).trim() || DEFAULT_REMOTE_HOST,
    remoteDshPort: Number(input.remoteDshPort),
  }
}

function slug(value) {
  const base = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return base || `remote-${createHash('sha1').update(value).digest('hex').slice(0, 8)}`
}

async function loadSources() {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8'))
    return Array.isArray(parsed.sources) ? parsed.sources.map(normalizeSource) : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
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

  async function persist(next) {
    sources = next
    await saveSources(sources)
  }

  async function connectSource(id) {
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
        '-p', String(source.sshPort),
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
        `${source.sshUser}@${source.sshHost}`,
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
        if (req.method === 'GET' && suffix === '/sources') {
          writeJson(res, 200, { ok: true, sources: sources.map(source => publicSource(source, runtimes.get(source.id))) })
          return
        }
        if (req.method === 'POST' && suffix === '/sources') {
          const input = await readJson(req)
          const source = normalizeSource(input)
          const next = [...sources.filter(item => item.id !== source.id), source]
          await persist(next)
          writeJson(res, 200, { ok: true, source: publicSource(source, runtimes.get(source.id)) })
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
          await persist(sources.filter(item => item.id !== String(id)))
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
