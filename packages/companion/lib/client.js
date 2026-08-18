window.__ModuleLoader__.load({
  id: 'dsh-remote-desktop-companion',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    exports.inject = ['sessions']

    function parseHash() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      return { token: params.get('token') || '', parent: params.get('parent') || '' }
    }

    function installEmbeddedCss() {
      document.body.setAttribute('data-dsh-remote-desktop-child', 'true')
      const style = document.createElement('style')
      style.setAttribute('data-dsh-remote-desktop-companion', '')
      style.textContent = `
        body[data-dsh-remote-desktop-child="true"] [class*="sidebarCol"] { display: none !important; }
        body[data-dsh-remote-desktop-child="true"] [class*="handle"][data-side="sidebar"] { display: none !important; }
        body[data-dsh-remote-desktop-child="true"] [class*="frame"] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
      `
      document.head.appendChild(style)
      return () => { style.remove(); document.body.removeAttribute('data-dsh-remote-desktop-child') }
    }

    exports.apply = function apply(ctx) {
      const marker = new URLSearchParams(window.location.search).get('dshRemoteDesktop')
      const { token, parent } = parseHash()
      if (marker !== '1' || token === '' || parent === '') return
      ctx.effect(() => {
        const disposeCss = installEmbeddedCss()
        const ready = () => {
          window.parent?.postMessage({ type: 'dsh-remote-desktop/ready', sourceToken: token }, parent)
        }
        const onMessage = (event) => {
          if (event.origin !== parent) return
          const data = event.data
          if (data?.type !== 'dsh-remote-desktop/open-session' || data.token !== token) return
          if (typeof data.sessionId !== 'string' || data.sessionId === '') return
          ctx.sessions.open(data.sessionId)
          window.parent?.postMessage({ type: 'dsh-remote-desktop/opened', sourceToken: token, sessionId: data.sessionId }, parent)
        }
        window.addEventListener('message', onMessage)
        ready()
        const timer = window.setInterval(ready, 1000)
        return () => {
          window.clearInterval(timer)
          window.removeEventListener('message', onMessage)
          disposeCss()
        }
      }, 'dsh-remote-desktop-companion: iframe bridge')
    }
    return module.exports
  },
})
