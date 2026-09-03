export const name = 'dsh-remote-desktop-companion'
export const inject = ['webServer']

const HEALTH_PATH = '/remote-desktop-companion/api/health'

/**
 * Transitional package-readiness probe. Session and Workspace data always use
 * the authenticated DSH Client Controller running inside the remote iframe.
 */
export function apply(ctx) {
  const disposeHealth = ctx.webServer.register({
    kind: 'exact',
    path: HEALTH_PATH,
    handler: (_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({ ok: true, name }))
    },
  })
  ctx.effect(() => disposeHealth, 'dsh-remote-desktop-companion: readiness route')
}
