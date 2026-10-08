import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

// Exercise the published Client Controller through the forwarded browser origin.
// The test-only route exposes the companion's Context in this disposable page;
// no debug capability is added to either plugin's release artifact.
export async function terminalThroughBrowser({ origin, sessionId, input, sentinel }) {
  const candidates = [new URL('../../node_modules/playwright/index.js', import.meta.url).pathname,
    '/Users/i060912/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js']
  const path = candidates.find(existsSync)
  if (!path) throw new Error('Playwright is required for terminal acceptance')
  const { chromium } = createRequire(path)('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', async route => {
      if (!route.request().url().includes('/plugins/??')) return route.continue()
      const response = await route.fetch()
      const source = (await response.text()).replace("exports.inject = ['sessions', 'workspaces', 'uiWorkspace']", "exports.inject = ['sessions', 'workspaces', 'uiWorkspace', 'remote', 'remote.terminal']").replace(
        'exports.apply = function apply(ctx) {\n      const marker',
        'exports.apply = function apply(ctx) {\n      window.__acceptanceContext = ctx;\n      const marker',
      )
      await route.fulfill({ response, body: source })
    })
    await page.goto(`${origin}/?dshRemoteDesktop=1#token=acceptance&parent=${encodeURIComponent(origin)}`)
    await page.waitForFunction(() => window.__acceptanceContext?.sessions.list.getSnapshot().phase === 'ready')
    return await page.evaluate(async ({ sessionId, input, sentinel }) => {
      const ctx = window.__acceptanceContext
      return ctx.sessions.using(sessionId, { source: 'controllerOperation' }, async reference => {
        const binding = await reference.ready
        const terminal = ctx.remote.terminal
        const id = `acceptance-${crypto.randomUUID()}`
        const attachment = crypto.randomUUID()
        const result = await terminal.create(sessionId, { id, cols: 120, rows: 24 })
        if (!result.ok) throw new Error(result.error.message)
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(new Error('terminal sentinel timeout')), 10000)
        const stream = terminal.follow(sessionId, id, attachment, abort.signal)
        let text = ''
        try {
          for await (const frame of stream) {
            if (frame.type === 'snapshot') {
              const written = await terminal.write(sessionId, id, attachment, input)
              if (!written.ok) throw new Error(written.error.message)
            }
            text += frame.type === 'output' ? frame.data : frame.type === 'snapshot' ? frame.screen : ''
            if (text.includes(sentinel)) return text
          }
          throw new Error('terminal stream ended before sentinel')
        } finally {
          clearTimeout(timer)
          abort.abort()
          await terminal.close(sessionId, id)
        }
      })
    }, { sessionId, input, sentinel })
  } finally { await browser.close() }
}
