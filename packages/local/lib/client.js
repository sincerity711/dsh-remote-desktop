window.__ModuleLoader__.load({
  id: 'dsh-remote-desktop',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    exports.inject = ['slots', 'sessions', 'workspaces']

    function createStore() {
      let snapshot = { sources: [], snapshots: {}, active: { kind: 'local' }, pendingOpen: null, loaded: false, error: null }
      const listeners = new Set()
      const emit = () => { for (const l of [...listeners]) l() }
      const set = (patch) => { snapshot = { ...snapshot, ...patch }; emit() }
      const api = async (path, init) => {
        const res = await fetch(`/remote-desktop/api${path}`, { headers: { 'content-type': 'application/json' }, ...init })
        const json = await res.json().catch(() => null)
        if (!res.ok || json?.ok !== true) throw new Error(json?.error?.message || `HTTP ${res.status}`)
        return json
      }
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
        set,
        async refreshSources() {
          try {
            const json = await api('/sources')
            set({ sources: json.sources, loaded: true, error: null })
            for (const source of json.sources) {
              if (source.state === 'connected') void this.refreshSnapshot(source.id)
            }
          } catch (error) {
            set({ loaded: true, error: error instanceof Error ? error.message : String(error) })
          }
        },
        async saveSource(source) {
          await api('/sources', { method: 'POST', body: JSON.stringify(source) })
          await this.refreshSources()
        },
        async connect(id) {
          await api('/connect', { method: 'POST', body: JSON.stringify({ id }) })
          await this.refreshSources()
        },
        async disconnect(id) {
          await api('/disconnect', { method: 'POST', body: JSON.stringify({ id }) })
          set({ active: snapshot.active.kind === 'remote' && snapshot.active.id === id ? { kind: 'local' } : snapshot.active })
          await this.refreshSources()
        },
        async delete(id) {
          await api('/delete', { method: 'POST', body: JSON.stringify({ id }) })
          const next = { ...snapshot.snapshots }
          delete next[id]
          set({ snapshots: next, active: snapshot.active.kind === 'remote' && snapshot.active.id === id ? { kind: 'local' } : snapshot.active })
          await this.refreshSources()
        },
        async refreshSnapshot(id) {
          try {
            const json = await api(`/snapshot?id=${encodeURIComponent(id)}`)
            set({ snapshots: { ...snapshot.snapshots, [id]: { state: 'ready', ...json.snapshot } } })
          } catch (error) {
            set({ snapshots: { ...snapshot.snapshots, [id]: { state: 'error', error: error instanceof Error ? error.message : String(error) } } })
          }
        },
        openRemote(id, sessionId) {
          set({ active: { kind: 'remote', id }, pendingOpen: { sourceId: id, sessionId, nonce: Math.random() } })
        },
        openLocal() { set({ active: { kind: 'local' }, pendingOpen: null }) },
      }
    }

    const store = createStore()
    const useRemote = (selector) => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))

    function byWorkspace(snapshot) {
      if (!snapshot || snapshot.state === 'error') return []
      const sessions = snapshot.sessions?.items || []
      const byId = new Map(sessions.map(row => [row.sessionId, row]))
      const archived = new Set(snapshot.workspaces?.archivedSessionIds || [])
      return (snapshot.workspaces?.items || []).map(ws => ({
        ...ws,
        sessions: (ws.sessionIds || []).filter(id => !archived.has(id)).map(id => byId.get(id)).filter(Boolean),
      }))
    }

    function titleOfSession(row) {
      return row?.projections?.values?.title || row?.cwd?.split(/[\\/]/).pop() || row?.sessionId || 'Untitled session'
    }

    function RemoteWorkspaceBrowser(props) {
      const remote = useRemote(s => s)
      const localSessions = props.useSessions(s => s)
      const localWorkspaces = props.useWorkspaces(s => s.items)
      useEffect(() => {
        void store.refreshSources()
        const timer = setInterval(() => { void store.refreshSources() }, 5000)
        return () => clearInterval(timer)
      }, [])
      const localById = localSessions.byId || {}
      return h('div', { style: styles.browser },
        h('div', { style: styles.header },
          h('strong', null, props.wide ? 'Remote Desktop' : 'RD'),
          props.wide && h('button', { style: styles.smallButton, onClick: () => void store.refreshSources() }, 'Refresh')
        ),
        remote.error && h('div', { style: styles.error }, remote.error),
        h(SourceHeader, { label: 'Local', state: remote.active.kind === 'local' ? 'active' : 'ready', onClick: () => store.openLocal() }),
        props.wide && localWorkspaces.map(ws => h('div', { key: ws.workspaceId, style: styles.group },
          h('div', { style: styles.groupTitle }, ws.title || ws.path),
          (ws.sessionIds || []).map(id => {
            const row = localById[id]
            if (!row || row.blank || row.origin === 'subagent') return null
            return h('button', { key: id, style: styles.row, onClick: () => props.openLocal(id) }, row.displayTitle || row.title || id)
          })
        )),
        remote.sources.map(source => h(RemoteSource, { key: source.id, source, snapshot: remote.snapshots[source.id], wide: props.wide })),
        props.wide && h('div', { style: styles.hint }, 'Configure remotes in Settings → Remote Desktop.')
      )
    }

    function SourceHeader({ label, state, onClick }) {
      return h('button', { type: 'button', style: styles.sourceHeader, onClick },
        h('span', { style: { ...styles.dot, background: state === 'connected' || state === 'ready' || state === 'active' ? '#3bb273' : state === 'error' ? '#d9534f' : '#999' } }),
        h('span', null, label),
        h('span', { style: styles.state }, state)
      )
    }

    function RemoteSource({ source, snapshot, wide }) {
      const groups = byWorkspace(snapshot)
      return h('div', null,
        h(SourceHeader, { label: `Remote: ${source.label}`, state: source.state, onClick: () => { if (source.state === 'connected') store.set({ active: { kind: 'remote', id: source.id } }) } }),
        wide && source.error && h('div', { style: styles.error }, source.error),
        wide && source.state !== 'connected' && h('div', { style: styles.hint }, 'Disconnected'),
        wide && snapshot?.state === 'error' && h('div', { style: styles.error }, snapshot.error),
        wide && groups.map(ws => h('div', { key: ws.workspaceId, style: styles.group },
          h('div', { style: styles.groupTitle }, ws.title || ws.path),
          ws.sessions.map(row => h('button', {
            key: row.sessionId,
            style: styles.row,
            onClick: () => store.openRemote(source.id, row.sessionId),
          }, `${titleOfSession(row)}${row.blank ? ' (blank)' : ''}`))
        ))
      )
    }

    function RemoteOverlay() {
      const remote = useRemote(s => s)
      const { sources, active, pendingOpen } = remote
      const [left, setLeftState] = useState(0)
      const leftRef = useRef(0)
      const setLeft = (next) => { if (leftRef.current !== next) { leftRef.current = next; setLeftState(next) } }
      const frames = useRef(new Map())
      const ready = useRef(new Set())
      const source = active.kind === 'remote' ? sources.find(s => s.id === active.id) : undefined
      useEffect(() => {
        const measure = () => {
          const col = document.querySelector('[class*="sidebarCol"]')
          setLeft(col ? Math.round(col.getBoundingClientRect().right) : 0)
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(document.body)
        return () => ro.disconnect()
      }, [])
      useEffect(() => {
        const onMessage = (event) => {
          if (event.data?.type === 'dsh-remote-desktop/ready') ready.current.add(event.data.sourceToken)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [])
      useEffect(() => {
        if (!source || !pendingOpen || pendingOpen.sourceId !== source.id) return
        const frame = frames.current.get(source.id)
        if (!frame?.contentWindow) return
        const send = () => frame.contentWindow.postMessage({
          type: 'dsh-remote-desktop/open-session',
          token: source.token,
          sessionId: pendingOpen.sessionId,
        }, new URL(source.iframeUrl).origin)
        send()
        const retry = setTimeout(send, 500)
        return () => clearTimeout(retry)
      }, [source?.id, source?.iframeUrl, source?.token, pendingOpen?.nonce])

      return h('div', { style: { ...styles.overlay, left, display: source ? 'block' : 'none' } },
        sources.filter(s => s.state === 'connected' && s.iframeUrl).map(s => h('iframe', {
          key: s.id,
          ref: el => { if (el) frames.current.set(s.id, el); else frames.current.delete(s.id) },
          src: withParent(s.iframeUrl),
          style: { ...styles.iframe, display: source?.id === s.id ? 'block' : 'none' },
          title: `Remote dsh ${s.label}`,
        })),
        source && h('div', { style: styles.badge }, `Remote: ${source.label}`)
      )
    }

    function withParent(url) {
      const u = new URL(url)
      const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
      hash.set('parent', window.location.origin)
      u.hash = hash.toString()
      return String(u)
    }

    function SettingsSection() {
      const sources = useRemote(s => s.sources)
      const [draft, setDraft] = useState({ label: '', sshHost: '', sshUser: '', sshPort: 22, remoteDshHost: '127.0.0.1', remoteDshPort: 30800 })
      const [message, setMessage] = useState('')
      useEffect(() => { void store.refreshSources() }, [])
      const save = async () => {
        try { await store.saveSource(draft); setMessage('Saved') } catch (e) { setMessage(e.message || String(e)) }
      }
      return h('div', { style: styles.settings },
        h('h2', null, 'Remote Desktop'),
        h('p', null, 'Connect to an already-running remote dsh web profile through SSH key authentication.'),
        ['label', 'sshHost', 'sshUser', 'sshPort', 'remoteDshHost', 'remoteDshPort'].map(key => h('label', { key, style: styles.label },
          key,
          h('input', { style: styles.input, value: draft[key], onChange: e => setDraft({ ...draft, [key]: e.target.value }) })
        )),
        h('button', { style: styles.button, onClick: save }, 'Save source'),
        message && h('div', { style: styles.hint }, message),
        h('h3', null, 'Sources'),
        sources.map(source => h('div', { key: source.id, style: styles.card },
          h('strong', null, source.label), ' ', h('span', null, source.state),
          source.error && h('div', { style: styles.error }, source.error),
          h('div', { style: styles.actions },
            h('button', { onClick: () => void store.connect(source.id) }, 'Connect'),
            h('button', { onClick: () => void store.disconnect(source.id) }, 'Disconnect'),
            h('button', { onClick: () => void store.delete(source.id) }, 'Delete')
          )
        ))
      )
    }

    exports.apply = function apply(ctx) {
      const openLocal = (sessionId) => ctx.sessions.open(sessionId)
      ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
        name: 'sidebar.workspaces',
        inject: () => ({ openLocal }),
      }, RemoteWorkspaceBrowser))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'remote-desktop-overlay',
        order: 100,
      }, RemoteOverlay))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'remote-desktop',
        order: 80,
        label: 'Remote Desktop',
      }, SettingsSection))
    }

    const styles = {
      browser: { height: '100%', overflow: 'auto', padding: 8, boxSizing: 'border-box', font: '13px system-ui, sans-serif' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 8px' },
      smallButton: { fontSize: 12 },
      sourceHeader: { width: '100%', display: 'flex', gap: 8, alignItems: 'center', padding: '7px 8px', border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
      dot: { width: 8, height: 8, borderRadius: 99, flex: '0 0 auto' },
      state: { marginLeft: 'auto', opacity: .55, fontSize: 11 },
      group: { margin: '4px 0 8px 14px' },
      groupTitle: { opacity: .7, fontSize: 12, padding: '4px 0' },
      row: { display: 'block', width: '100%', border: 0, background: 'transparent', color: 'inherit', padding: '6px 8px', borderRadius: 8, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      hint: { opacity: .65, fontSize: 12, padding: '6px 8px' },
      error: { color: '#d9534f', fontSize: 12, padding: '6px 8px', whiteSpace: 'pre-wrap' },
      overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 30, background: 'var(--dsw-alias-bg-base, #fff)', pointerEvents: 'auto' },
      iframe: { width: '100%', height: '100%', border: 0, background: 'white' },
      badge: { position: 'absolute', top: 8, right: 12, zIndex: 2, padding: '4px 8px', borderRadius: 999, background: 'rgba(0,0,0,.55)', color: 'white', fontSize: 12 },
      settings: { padding: 16, maxWidth: 720, font: '14px system-ui, sans-serif' },
      label: { display: 'block', margin: '10px 0', fontSize: 12, color: 'inherit' },
      input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid #999', background: 'transparent', color: 'inherit' },
      button: { padding: '8px 12px', borderRadius: 8, border: '1px solid #777', background: 'transparent', color: 'inherit' },
      card: { border: '1px solid rgba(128,128,128,.35)', borderRadius: 10, padding: 10, margin: '8px 0' },
      actions: { display: 'flex', gap: 8, marginTop: 8 },
    }

    return module.exports
  },
})
