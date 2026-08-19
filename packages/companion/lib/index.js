export const name = 'dsh-remote-desktop-companion'
export const inject = ['webServer']

const HEALTH_PATH = '/remote-desktop-companion/api/health'

export function apply(ctx) {
  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: HEALTH_PATH,
    handler: (_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({ ok: true, name }))
    },
  })
  ctx.effect(() => disposeRoute, 'dsh-remote-desktop-companion: health route')
}
