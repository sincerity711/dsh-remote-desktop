import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { apply as applyLocal, closeProxy, normalizeSource, parseSshConfig, startProxyServer } from '../lib/index.js'
import { apply as applyCompanion } from '../../companion/lib/index.js'
import { syncFixture } from './helpers/sync-fixture.mjs'

function responseRecorder() {
  return {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    write(chunk) { this.body += String(chunk) },
    end(chunk = '') { this.body += String(chunk) },
  }
}

test('local management routes reject unauthenticated browser requests before dispatch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-rd-auth-'))
  const previousHome = process.env.DSH_REMOTE_DESKTOP_HOME
  const previousConfig = process.env.DSH_REMOTE_DESKTOP_SSH_CONFIG
  process.env.DSH_REMOTE_DESKTOP_HOME = home
  process.env.DSH_REMOTE_DESKTOP_SSH_CONFIG = join(home, 'missing-ssh-config')
  let route
  const disposers = []
  try {
    await applyLocal({
      webServer: { register(value) { route = value; return () => {} } },
      connection: { requestRejection() { return 401 } },
      effect(factory) { const dispose = factory(); if (typeof dispose === 'function') disposers.push(dispose) },
    })
    const res = responseRecorder()
    await route.handler({ method: 'GET', url: '/remote-desktop/api/sources' }, res)
    assert.equal(res.status, 401)
    assert.equal(res.body, 'unauthorized')
  } finally {
    await new Promise(resolve => setImmediate(resolve))
    for (const dispose of disposers.reverse()) await dispose()
    if (previousHome === undefined) delete process.env.DSH_REMOTE_DESKTOP_HOME
    else process.env.DSH_REMOTE_DESKTOP_HOME = previousHome
    if (previousConfig === undefined) delete process.env.DSH_REMOTE_DESKTOP_SSH_CONFIG
    else process.env.DSH_REMOTE_DESKTOP_SSH_CONFIG = previousConfig
    await rm(home, { recursive: true, force: true })
  }
})

test('companion host exposes readiness only and no Session or Workspace business API', async t => {
  const fixture = await syncFixture()
  t.after(() => fixture.close())
  const routes = new Map()
  await applyCompanion({
    profileContext: { installAnchor: fixture.anchor },
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
    effect() {},
  })
  assert.deepEqual([...routes.keys()], ['/remote-desktop-companion/api/health'])
  assert.equal(routes.has('/remote-desktop-companion/api/snapshot'), false)
  assert.equal(routes.has('/remote-desktop-companion/api/rpc'), false)
})

test('only persisted sources opt into startup auto-connect by default', () => {
  const [discovered] = parseSshConfig('Host build-box\n  HostName 10.0.0.2\n  User builder\n')
  const saved = normalizeSource({ id: 'saved-box', sshAlias: 'saved-box' })
  assert.equal(discovered.autoConnect, undefined)
  assert.equal(saved.autoConnect, true)
  assert.equal(normalizeSource({ id: 'manual-box', sshAlias: 'manual-box', autoConnect: false }).autoConnect, false)
})

test('connection lifecycle owns listeners, cancellation, reconnect backoff, and bounded output', async () => {
  const server = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(server, /abort: new AbortController\(\)/)
  assert.match(server, /runtime\.abort\?\.abort\(new Error\('source disconnected'\)\)/)
  assert.match(server, /Math\.min\(1000 \* \(2 \*\* attempt\), 30000\)/)
  assert.match(server, /function appendCapped\(current, chunk, limit = 4000\)/)
  assert.match(server, /shouldInstall \? \{ setup: true \} : \{ startPrepared: true \}/)
  assert.match(server, /dsh-remote-desktop-\$DSH_REMOTE_DESKTOP_PORT\.pid/)
  assert.doesNotMatch(server, /lsof\s+-ti|fuser/)
})

test('iframe proxy exchanges the launch token server-side and forwards only the session cookie', async () => {
  const requests = []
  const upstream = createServer((req, res) => {
    requests.push({ url: req.url, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie })
    if (req.url === '/?token=remote-launch-token') {
      res.writeHead(303, { location: '/', 'set-cookie': 'dsh-session=ready; Path=/; HttpOnly' })
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'text/plain',
      'set-cookie': 'dsh-session=must-not-reach-browser; Path=/; HttpOnly',
    })
    res.end('ok')
  })
  await new Promise((resolve, reject) => {
    upstream.once('error', reject)
    upstream.listen(0, '127.0.0.1', resolve)
  })
  const upstreamPort = upstream.address().port
  const proxy = await startProxyServer(upstreamPort, 'remote.internal:30800', 'remote-launch-token')
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/?dshRemoteDesktop=1`, {
      headers: {
        origin: `http://127.0.0.1:${proxy.port}`,
        cookie: 'dsh-session=stale-browser-cookie; local-cookie=must-not-reach-remote',
      },
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'ok')
    assert.equal(response.headers.get('set-cookie'), null)
    assert.deepEqual(requests[0], {
      url: '/?token=remote-launch-token',
      host: 'remote.internal:30800',
      origin: undefined,
      cookie: undefined,
    })
    assert.deepEqual(requests[1], {
      url: '/?dshRemoteDesktop=1',
      host: 'remote.internal:30800',
      origin: 'http://remote.internal:30800',
      cookie: 'dsh-session=ready',
    })
  } finally {
    closeProxy(proxy)
    upstream.closeAllConnections()
    await new Promise(resolve => upstream.close(resolve))
  }
})

test('iframe proxy absorbs routine client and WebSocket socket resets', async () => {
  const server = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(server, /server\.on\('clientError', \(_error, socket\) => \{ socket\.destroy\(\) \}\)/)
  assert.match(server, /socket\.on\('error', \(\) => \{\}\)/)
  assert.match(server, /socket\.on\('error', \(\) => \{ upstream\.destroy\(\) \}\)/)
  assert.doesNotMatch(server, /res\.destroy\(error\)/)
})
