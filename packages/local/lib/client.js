window.__ModuleLoader__.load({
  id: 'dsh-remote-desktop',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    exports.inject = ['slots', 'sessions', 'workspaces']

    const LOCAL_SOURCE_ID = 'local'
    const ACTIVE_CHANGED = 'dsh-remote-desktop/active-changed'

    function createStore() {
      let snapshot = {
        sources: [],
        snapshots: {},
        active: { kind: 'local', sessionId: undefined },
        pendingOpen: null,
        loaded: false,
        error: null,
        companionReady: {},
      }
      const listeners = new Set()
      const emit = () => {
        for (const listener of [...listeners]) listener()
        window.dispatchEvent(new CustomEvent(ACTIVE_CHANGED, { detail: snapshot.active }))
      }
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
          set({ active: snapshot.active.kind === 'remote' && snapshot.active.sourceId === id ? { kind: 'local', sessionId: undefined } : snapshot.active })
          await this.refreshSources()
        },
        async delete(id) {
          await api('/delete', { method: 'POST', body: JSON.stringify({ id }) })
          const nextSnapshots = { ...snapshot.snapshots }
          const nextReady = { ...snapshot.companionReady }
          delete nextSnapshots[id]
          delete nextReady[id]
          set({
            snapshots: nextSnapshots,
            companionReady: nextReady,
            active: snapshot.active.kind === 'remote' && snapshot.active.sourceId === id ? { kind: 'local', sessionId: undefined } : snapshot.active,
          })
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
        markReady(sourceId) {
          if (snapshot.companionReady[sourceId]) return
          set({ companionReady: { ...snapshot.companionReady, [sourceId]: true } })
        },
        openRemote(sourceId, sessionId) {
          set({
            active: { kind: 'remote', sourceId, sessionId },
            pendingOpen: { sourceId, sessionId, nonce: Math.random() },
          })
        },
        openLocal(sessionId) { set({ active: { kind: 'local', sessionId }, pendingOpen: null }) },
        listSources() { return snapshot.sources.map(publicSummary) },
      }
    }

    const store = createStore()
    const useRemote = (selector) => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))

    function publicSummary(source) {
      return { id: source.id, label: source.label, state: source.state, error: source.error ?? null }
    }

    function byWorkspace(snapshot) {
      if (!snapshot || snapshot.state === 'error') return []
      const sessions = snapshot.sessions?.items || []
      const byId = new Map(sessions.map(row => [row.sessionId, row]))
      const archived = new Set(snapshot.workspaces?.archivedSessionIds || [])
      return (snapshot.workspaces?.items || []).map(ws => ({
        ...ws,
        title: ws.title || ws.path || 'Workspace',
        sessions: (ws.sessionIds || []).filter(id => !archived.has(id)).map(id => byId.get(id)).filter(Boolean),
      }))
    }

    function titleOfSession(row) {
      return row?.displayTitle || row?.title || row?.projections?.values?.title || row?.cwd?.split(/[\\/]/).pop() || row?.sessionId || 'Untitled session'
    }

    function sessionUpdatedAt(row) {
      return Number(row?.updatedAt || row?.createdAt || 0)
    }

    function relativeTime(ms) {
      if (!ms) return ''
      const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60000))
      if (minutes < 1) return 'now'
      if (minutes < 60) return `${minutes}min`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h`
      return `${Math.floor(hours / 24)}d`
    }

    function installCss() {
      if (document.querySelector('style[data-dsh-remote-desktop-sidebar]')) return () => {}
      const style = document.createElement('style')
      style.setAttribute('data-dsh-remote-desktop-sidebar', '')
      style.textContent = `
        .rd-browser {
          --rd-edge-inset: var(--dsh-sidebar-inline-padding, 12px);
          flex: 1;
          min-height: 0;
          height: 100%;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          padding-right: var(--rd-edge-inset);
          color: var(--dsw-alias-label-primary);
          font-size: 14px;
          background: var(--dsw-specific-sidebar-fill);
        }
        .rd-browser[data-wide="false"] { padding-right: 0; }
        .rd-header { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 4px; height: 36px; padding-left: 4px; margin: 2px -4px 4px 0; color: var(--dsw-alias-label-tertiary); box-sizing: border-box; overflow: hidden; }
        .rd-title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 500; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
        .rd-iconButton { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 50%; padding: 0; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary); }
        .rd-iconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
        .rd-search { flex: none; display: flex; align-items: center; height: 30px; margin: 0 0 6px 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-caption); }
        .rd-searchIcon { flex: none; width: 28px; text-align: center; color: var(--dsw-alias-label-secondary); }
        .rd-searchInput { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 18px; }
        .rd-searchInput::placeholder { color: var(--dsw-alias-label-tertiary); }
        .rd-listArea { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-left: -4px; margin-right: calc(-1 * var(--rd-edge-inset)); padding-left: 4px; overflow: visible; }
        .rd-list { flex: 1; min-height: 0; overflow-y: auto; margin-left: -4px; margin-right: 2px; padding-left: 4px; padding-right: calc(var(--rd-edge-inset) - 10px); padding-bottom: 16px; scrollbar-gutter: stable; }
        .rd-source { position: relative; }
        .rd-source + .rd-source { margin-top: 4px; }
        .rd-sourceHeader { display: flex; align-items: center; gap: 6px; height: 34px; box-sizing: border-box; border-radius: 8px; padding: 0 8px; cursor: default; user-select: none; color: var(--dsw-alias-label-primary); }
        .rd-sourceHeader[data-collapsible="true"] { cursor: pointer; }
        .rd-sourceHeader[data-collapsible="true"]:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-sourceHeader[data-active="true"] .rd-sourceIcon { color: var(--dsw-alias-state-business-primary); }
        .rd-sourceIcon { flex: none; width: 16px; height: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
        .rd-sourceLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; }
        .rd-sourceState { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; }
        .rd-stateDot { width: 7px; height: 7px; border-radius: 999px; display: inline-block; background: var(--dsw-alias-label-tertiary); }
        .rd-state-ready, .rd-state-connected, .rd-state-active { background: var(--dsw-alias-state-success-primary, #3bb273); }
        .rd-state-error { background: var(--dsw-alias-state-error-primary); }
        .rd-workspace { position: relative; }
        .rd-workspace + .rd-workspace { margin-top: 2px; }
        .rd-workspaceHeader { display: flex; align-items: center; gap: 6px; height: 34px; box-sizing: border-box; border-radius: 8px; padding: 0 8px 0 18px; cursor: pointer; user-select: none; color: var(--dsw-alias-label-primary); }
        .rd-workspaceHeader:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-folder { flex: none; width: 16px; color: var(--dsw-alias-label-tertiary); }
        .rd-workspaceTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; }
        .rd-sessionRow { display: flex; align-items: center; gap: 0; height: 32px; box-sizing: border-box; border: 0; border-radius: 8px; padding: 0 8px 0 40px; width: 100%; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; animation: rd-row-in 150ms var(--ds-ease-in-out); }
        .rd-sessionRow:hover, .rd-sessionRow[data-selected="true"] { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-sessionStatus { flex: none; width: 16px; height: 20px; display: inline-flex; align-items: center; justify-content: center; }
        .rd-sessionTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0 6px 0 4px; font-size: 14px; line-height: 20px; }
        .rd-sessionTime { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; }
        .rd-rowMessage { padding: 8px 12px 8px 40px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
        .rd-error { color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; }
        .rd-muted { color: var(--dsw-alias-label-tertiary); }
        .rd-activeText { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        @keyframes rd-row-in { from { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .rd-sessionRow { animation: none; } }
      `
      document.head.appendChild(style)
      return () => style.remove()
    }

    function RemoteWorkspaceBrowser(props) {
      const remote = useRemote(s => s)
      const localSessions = props.useSessions(s => s)
      const localWorkspaces = props.useWorkspaces(s => s.items)
      const [collapsedSources, setCollapsedSources] = useState({})
      const [collapsedWorkspaces, setCollapsedWorkspaces] = useState({})
      const [query, setQuery] = useState('')
      useEffect(() => installCss(), [])
      useEffect(() => {
        void store.refreshSources()
        const timer = setInterval(() => { void store.refreshSources() }, 5000)
        return () => clearInterval(timer)
      }, [])
      const localById = localSessions.byId || {}
      const textQuery = query.trim().toLowerCase()
      const active = remote.active
      const toggleSource = (id) => setCollapsedSources(value => ({ ...value, [id]: !value[id] }))
      const toggleWorkspace = (key) => setCollapsedWorkspaces(value => ({ ...value, [key]: !value[key] }))
      const sourceViews = useMemo(() => {
        const local = {
          id: LOCAL_SOURCE_ID,
          kind: 'local',
          label: 'Local',
          state: active.kind === 'local' ? 'active' : 'ready',
          workspaces: localWorkspaces.map(ws => ({
            id: String(ws.workspaceId),
            title: ws.title || ws.path || 'Workspace',
            path: ws.path,
            sessions: (ws.sessionIds || []).map(id => localById[id] ? { ...localById[id], sessionId: id } : undefined).filter(row => row && row.origin !== 'subagent'),
          })),
          error: null,
        }
        const remotes = remote.sources.map(source => {
          const snap = remote.snapshots[source.id]
          return {
            id: source.id,
            kind: 'remote',
            label: `Remote: ${source.label}`,
            state: source.state,
            error: source.error || (snap?.state === 'error' ? snap.error : null),
            workspaces: byWorkspace(snap).map(ws => ({ id: String(ws.workspaceId), title: ws.title || ws.path || 'Workspace', path: ws.path, sessions: ws.sessions })),
          }
        })
        return [local, ...remotes]
      }, [active.kind, localWorkspaces, localById, remote.sources, remote.snapshots])

      if (!props.wide) {
        return h('div', { className: 'rd-browser', 'data-wide': 'false' },
          h('button', { type: 'button', className: 'rd-iconButton', title: 'Remote Desktop', onClick: props.expandSidebar }, 'RD'))
      }

      return h('div', { className: 'rd-browser', 'data-wide': 'true', 'data-rd-sidebar': 'official-style-fork' },
        h('div', { className: 'rd-header' },
          h('span', { className: 'rd-title' }, 'Remote Desktop'),
          h('button', { type: 'button', className: 'rd-iconButton', title: 'Refresh remote sources', onClick: () => void store.refreshSources(), 'data-rd-refresh': 'true' }, '↻')
        ),
        h('label', { className: 'rd-search' },
          h('span', { className: 'rd-searchIcon' }, '⌕'),
          h('input', { className: 'rd-searchInput', value: query, placeholder: 'Search sessions', onChange: e => setQuery(e.target.value), 'data-rd-search': 'true' })
        ),
        remote.error && h('div', { className: 'rd-rowMessage rd-error' }, remote.error),
        h('div', { className: 'rd-listArea' },
          h('div', { className: 'rd-list', role: 'tree' },
            sourceViews.map(source => h(SourceSection, {
              key: source.id,
              source,
              active,
              query: textQuery,
              collapsed: collapsedSources[source.id] === true,
              collapsedWorkspaces,
              toggleSource,
              toggleWorkspace,
              openLocal: props.openLocal,
            })),
            h('div', { className: 'rd-rowMessage rd-muted' }, 'Configure remotes in Settings → Remote Desktop.')
          )
        )
      )
    }

    function SourceSection({ source, active, query, collapsed, collapsedWorkspaces, toggleSource, toggleWorkspace, openLocal }) {
      const activeInSource = active.kind === source.kind && (source.kind === 'local' || active.sourceId === source.id)
      const state = source.state || (source.kind === 'local' ? 'ready' : 'disconnected')
      const canCollapse = source.workspaces.length > 0 || source.error || state !== 'connected'
      const visibleWorkspaces = source.workspaces.map(ws => ({
        ...ws,
        sessions: query === '' ? ws.sessions : ws.sessions.filter(row => titleOfSession(row).toLowerCase().includes(query) || String(row.sessionId).toLowerCase().includes(query)),
      })).filter(ws => query === '' || ws.sessions.length > 0)
      const isUnavailable = source.kind === 'remote' && state !== 'connected'
      return h('section', { className: 'rd-source', 'data-rd-source-section': source.id },
        h('div', {
          className: 'rd-sourceHeader',
          role: 'group',
          'data-rd-source-id': source.id,
          'data-rd-active': activeInSource ? 'true' : 'false',
          'data-collapsible': canCollapse ? 'true' : 'false',
          onClick: canCollapse ? () => toggleSource(source.id) : undefined,
        },
          h('span', { className: 'rd-sourceIcon' }, collapsed ? '▶' : '▼'),
          h('span', { className: `rd-stateDot rd-state-${state}` }),
          h('span', { className: 'rd-sourceLabel' }, source.label),
          activeInSource && h('span', { className: 'rd-activeText' }, 'active'),
          h('span', { className: 'rd-sourceState' }, state)
        ),
        !collapsed && source.error && h('div', { className: 'rd-rowMessage rd-error' }, source.error),
        !collapsed && isUnavailable && !source.error && h('div', { className: 'rd-rowMessage rd-muted' }, 'Disconnected'),
        !collapsed && visibleWorkspaces.map(ws => h(WorkspaceGroup, {
          key: `${source.id}:${ws.id}`,
          source,
          workspace: ws,
          active,
          collapsed: collapsedWorkspaces[`${source.id}:${ws.id}`] === true,
          toggleWorkspace,
          openLocal,
        })),
        !collapsed && query !== '' && visibleWorkspaces.length === 0 && !source.error && h('div', { className: 'rd-rowMessage rd-muted' }, 'No matching sessions')
      )
    }

    function WorkspaceGroup({ source, workspace, active, collapsed, toggleWorkspace, openLocal }) {
      const key = `${source.id}:${workspace.id}`
      return h('div', { className: 'rd-workspace', 'data-rd-workspace-id': workspace.id, 'data-rd-source-id': source.id },
        h('div', { className: 'rd-workspaceHeader', role: 'treeitem', 'aria-expanded': !collapsed, onClick: () => toggleWorkspace(key), title: workspace.path || workspace.title },
          h('span', { className: 'rd-folder' }, collapsed ? '▸' : '▾'),
          h('span', { className: 'rd-workspaceTitle' }, workspace.title)
        ),
        !collapsed && workspace.sessions.map(row => h(SessionRow, { key: row.sessionId, source, row, active, openLocal }))
      )
    }

    function SessionRow({ source, row, active, openLocal }) {
      const title = `${titleOfSession(row)}${row.blank ? ' (blank)' : ''}`
      const selected = source.kind === 'local'
        ? active.kind === 'local' && active.sessionId === row.sessionId
        : active.kind === 'remote' && active.sourceId === source.id && active.sessionId === row.sessionId
      const onClick = () => {
        if (source.kind === 'local') {
          store.openLocal(row.sessionId)
          openLocal(row.sessionId)
        } else {
          store.openRemote(source.id, row.sessionId)
        }
      }
      return h('button', {
        type: 'button',
        className: 'rd-sessionRow',
        role: 'treeitem',
        'aria-selected': selected,
        'data-selected': selected ? 'true' : 'false',
        'data-rd-session-source-id': source.id,
        ...(source.kind === 'local' ? { 'data-rd-local-session-id': row.sessionId } : { 'data-rd-remote-session-id': row.sessionId, 'data-rd-source-id': source.id }),
        onClick,
        title,
      },
        h('span', { className: 'rd-sessionStatus' }, statusMark(row)),
        h('span', { className: 'rd-sessionTitle' }, title),
        !row.blank && h('span', { className: 'rd-sessionTime' }, relativeTime(sessionUpdatedAt(row)))
      )
    }

    function statusMark(row) {
      if (row?.pendingInteraction) return '●'
      if (row?.running || row?.runningSubagentCount > 0) return '◌'
      if (row?.completed) return '✓'
      return ''
    }

    function RemoteOverlay() {
      const remote = useRemote(s => s)
      const { sources, active, pendingOpen } = remote
      const [left, setLeftState] = useState(0)
      const leftRef = useRef(0)
      const setLeft = (next) => { if (leftRef.current !== next) { leftRef.current = next; setLeftState(next) } }
      const frames = useRef(new Map())
      const tokenToSource = useMemo(() => new Map(sources.map(source => [source.token, source.id])), [sources])
      const source = active.kind === 'remote' ? sources.find(s => s.id === active.sourceId) : undefined
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
          if (event.data?.type !== 'dsh-remote-desktop/ready') return
          const sourceId = tokenToSource.get(event.data.sourceToken)
          if (sourceId !== undefined) store.markReady(sourceId)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [tokenToSource])
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

      return h('div', { style: { ...styles.overlay, left, display: source ? 'block' : 'none' }, 'data-rd-overlay-active': source ? 'true' : 'false' },
        sources.filter(s => s.state === 'connected' && s.iframeUrl).map(s => h('iframe', {
          key: s.id,
          ref: el => { if (el) frames.current.set(s.id, el); else frames.current.delete(s.id) },
          src: withParent(s.iframeUrl),
          style: { ...styles.iframe, display: source?.id === s.id ? 'block' : 'none' },
          'data-rd-frame-source-id': s.id,
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
      return h('div', { style: styles.settings, 'data-rd-settings-section': 'true' },
        h('h2', null, 'Remote Desktop'),
        h('p', null, 'Connect to an already-running remote dsh web profile through SSH key authentication.'),
        ['label', 'sshHost', 'sshUser', 'sshPort', 'remoteDshHost', 'remoteDshPort'].map(key => h('label', { key, style: styles.label },
          key,
          h('input', { style: styles.input, 'data-rd-settings-field': key, value: draft[key], onChange: e => setDraft({ ...draft, [key]: e.target.value }) })
        )),
        h('button', { style: styles.button, 'data-rd-settings-save': 'true', onClick: save }, 'Save source'),
        message && h('div', { style: message.includes('required') ? styles.error : styles.hint }, message),
        h('h3', null, 'Sources'),
        sources.map(source => h('div', { key: source.id, style: styles.card, 'data-rd-settings-source-id': source.id },
          h('strong', null, source.label), ' ', h('span', null, source.state),
          source.error && h('div', { style: styles.error }, source.error),
          h('div', { style: styles.actions },
            h('button', { 'data-rd-settings-connect': source.id, onClick: () => void store.connect(source.id) }, 'Connect'),
            h('button', { 'data-rd-settings-disconnect': source.id, onClick: () => void store.disconnect(source.id) }, 'Disconnect'),
            h('button', { 'data-rd-settings-delete': source.id, onClick: () => void store.delete(source.id) }, 'Delete')
          )
        ))
      )
    }

    function createService(openLocal) {
      return {
        getSnapshot: () => store.getSnapshot(),
        subscribe: store.subscribe,
        listSources: () => store.listSources(),
        getActive: () => store.getSnapshot().active,
        openLocalSession: (sessionId) => { store.openLocal(sessionId); openLocal(sessionId) },
        openRemoteSession: (sourceId, sessionId) => { store.openRemote(sourceId, sessionId) },
      }
    }

    exports.apply = function apply(ctx) {
      if (new URLSearchParams(window.location.search).get('dshRemoteDesktop') === '1') return
      const openLocal = (sessionId) => ctx.sessions.open(sessionId)
      if (typeof ctx.provide === 'function') ctx.provide('remoteDesktop', createService(openLocal))
      else window.__dshRemoteDesktop = createService(openLocal)
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
      hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, padding: '6px 8px' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, padding: '6px 8px', whiteSpace: 'pre-wrap' },
      overlay: { position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 2147483000, isolation: 'isolate', background: 'var(--dsw-alias-bg-base, #fff)', pointerEvents: 'auto' },
      iframe: { width: '100%', height: '100%', border: 0, background: 'white' },
      badge: { position: 'absolute', top: 8, right: 12, zIndex: 2, padding: '4px 8px', borderRadius: 999, background: 'rgba(0,0,0,.55)', color: 'white', fontSize: 12 },
      settings: { padding: 16, maxWidth: 720, font: '14px system-ui, sans-serif' },
      label: { display: 'block', margin: '10px 0', fontSize: 12, color: 'inherit' },
      input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #999)', background: 'transparent', color: 'inherit' },
      button: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #777)', background: 'transparent', color: 'inherit' },
      card: { border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))', borderRadius: 10, padding: 10, margin: '8px 0' },
      actions: { display: 'flex', gap: 8, marginTop: 8 },
    }

    return module.exports
  },
})
