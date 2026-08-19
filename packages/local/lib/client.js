window.__ModuleLoader__.load({
  id: 'dsh-remote-desktop',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const ReactDOM = require('react-dom')
    const {
      Button, IconChevronDownOutline14, IconFolderClose16, IconFolderOpenOutline16,
      IconPlusOutline16, Input, Menu, Modal,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const { createElement: h, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    exports.inject = ['slots', 'sessions', 'workspaces']

    const LOCAL_SOURCE_ID = 'local'
    const ACTIVE_CHANGED = 'dsh-remote-desktop/active-changed'
    let settingsHostId = 'local'
    let fetchPatched = false

    function setSettingsHost(id) {
      settingsHostId = id || 'local'
      window.__dshRemoteDesktopSettingsHost = settingsHostId
    }

    function isHostScopedSettingsApi(pathname) {
      return pathname.startsWith('/api/settings.') || pathname.startsWith('/api/credentials.') || pathname.startsWith('/api/llm.')
    }

    function installHostApiFetchPatch() {
      if (fetchPatched) return
      fetchPatched = true
      const originalFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        if (settingsHostId === 'local') return originalFetch(input, init)
        const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin)
        if (url.origin !== window.location.origin || !isHostScopedSettingsApi(url.pathname)) return originalFetch(input, init)
        const next = new URL('/remote-desktop/api/host-api', window.location.origin)
        next.searchParams.set('id', settingsHostId)
        next.searchParams.set('path', `${url.pathname}${url.search}`)
        if (typeof input === 'string') return originalFetch(String(next), init)
        return originalFetch(new Request(String(next), input), init)
      }
    }

    function createStore() {
      let snapshot = {
        sources: [],
        snapshots: {},
        active: { kind: 'local', sessionId: undefined },
        pendingOpen: null,
        loaded: false,
        error: null,
        companionReady: {},
        remoteSetup: { open: false, request: null },
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
        openRemoteSetup(request = null) { set({ remoteSetup: { open: true, request } }) },
        closeRemoteSetup(status = 'cancelled', message = '') {
          const request = snapshot.remoteSetup.request
          if (request?.target && request?.origin && request?.requestId) {
            request.target.postMessage({
              type: 'dsh-remote-desktop/add-workspace-remote-result',
              requestId: request.requestId,
              status,
              ...(message ? { message } : {}),
            }, request.origin)
          }
          set({ remoteSetup: { open: false, request: null } })
        },
        listSources() { return snapshot.sources.map(publicSummary) },
      }
    }

    const store = createStore()
    const useRemote = (selector) => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))

    function isRemoteDesktopIframe() {
      return new URLSearchParams(window.location.search).get('dshRemoteDesktop') === '1'
    }

    function bridgeHash() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      return { token: params.get('token') || '', parent: params.get('parent') || '' }
    }

    function isAddWorkspaceBridgeRequest(data) {
      return data?.type === 'dsh-remote-desktop/add-workspace-remote-request'
        && typeof data.requestId === 'string' && data.requestId !== ''
        && typeof data.token === 'string' && data.token !== ''
    }

    async function remoteRpc(sourceId, method, payload = {}) {
      const rpcId = `${Date.now()}-${Math.random()}`
      const path = `/api/${method}`
      const url = new URL('/remote-desktop/api/host-api', window.location.origin)
      url.searchParams.set('id', sourceId)
      url.searchParams.set('path', path)
      const response = await fetch(String(url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      })
      const parsed = await response.json().catch(() => null)
      if (!response.ok) throw new Error(parsed?.error?.message || `HTTP ${response.status}`)
      if (parsed?.rpcId !== rpcId) throw new Error(`${method} rpcId mismatch`)
      if (parsed?.result?.ok !== true) throw new Error(parsed?.result?.error?.message || `${method} failed`)
      return parsed.result.value
    }

    function rowSessionId(row) {
      return row?.sessionId || row?.id
    }

    async function startRemoteWorkspace(sourceId, workspaceId) {
      const snapshot = store.getSnapshot().snapshots[sourceId]
      const workspace = snapshot?.workspaces?.items?.find(row => String(row.workspaceId) === String(workspaceId))
      const archived = new Set(snapshot?.workspaces?.archivedSessionIds || [])
      const sessions = snapshot?.sessions?.items || []
      const blank = sessions.find(row => row?.blank && !archived.has(rowSessionId(row)) && (workspace?.sessionIds || []).includes(rowSessionId(row)))
      const sessionId = rowSessionId(blank) || (await remoteRpc(sourceId, 'session.create', { workspaceId })).sessionId
      store.openRemote(sourceId, sessionId)
      void store.refreshSnapshot(sourceId)
    }

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
        .rd-hostBadge { flex: none; display: inline-flex; align-items: center; gap: 6px; max-width: 84px; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; }
        .rd-hostLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rd-stateDot { width: 7px; height: 7px; border-radius: 999px; display: inline-block; background: var(--dsw-alias-label-tertiary); }
        .rd-state-ready, .rd-state-connected, .rd-state-active { background: var(--dsw-alias-state-success-primary, #3bb273); }
        .rd-state-error { background: var(--dsw-alias-state-error-primary); }
        .rd-workspace { position: relative; }
        .rd-workspace + .rd-workspace { margin-top: 2px; }
        .rd-workspaceHeader { display: flex; align-items: center; gap: 6px; height: 34px; box-sizing: border-box; border-radius: 8px; padding: 0 8px; cursor: pointer; user-select: none; color: var(--dsw-alias-label-primary); }
        .rd-workspaceHeader:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-folder { flex: none; width: 16px; color: var(--dsw-alias-label-tertiary); }
        .rd-workspaceTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; }
        .rd-sessionRow { display: flex; align-items: center; gap: 0; height: 32px; box-sizing: border-box; border: 0; border-radius: 8px; padding: 0 8px 0 30px; width: 100%; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; animation: rd-row-in 150ms var(--ds-ease-in-out); }
        .rd-sessionRow:hover, .rd-sessionRow[data-selected="true"] { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-sessionStatus { flex: none; width: 16px; height: 20px; display: inline-flex; align-items: center; justify-content: center; }
        .rd-sessionTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0 6px 0 4px; font-size: 14px; line-height: 20px; }
        .rd-sessionTime { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; }
        .rd-rowMessage { padding: 8px 12px 8px 40px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
        .rd-error { color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; }
        .rd-muted { color: var(--dsw-alias-label-tertiary); }
        .rd-activeText { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .rd-settingsTrigger { flex: none; display: flex; align-items: center; gap: 8px; width: calc(100% + 8px); height: 34px; margin: 4px -4px; padding: 6px 2px 6px 10px; box-sizing: border-box; border: none; border-radius: 12px; background: transparent; cursor: pointer; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; }
        .rd-settingsTrigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-settingsOverlay { position: fixed; inset: 0; z-index: 2147482500; display: flex; align-items: center; justify-content: center; }
        .rd-settingsMask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1, rgba(0,0,0,.24)); backdrop-filter: var(--dsw-mask-blur, blur(8px)); }
        .rd-settingsPanel { position: relative; z-index: 1; display: flex; width: 800px; height: min(800px, calc(100vh - 48px)); max-width: calc(100vw - 48px); border-radius: 24px; overflow: hidden; background: var(--dsw-alias-bg-layer-2, #fff); box-shadow: var(--dsw-shadow-lv3, 0 10px 40px rgba(0,0,0,.18)); color: var(--dsw-alias-label-primary); }
        .rd-settingsNav { flex: none; display: flex; flex-direction: column; gap: 18px; width: 188px; padding: 22px 12px 0; box-sizing: border-box; }
        .rd-settingsTitle { padding: 0 12px; font-size: 16px; line-height: 24px; font-weight: 500; }
        .rd-settingsNavList { display: flex; flex-direction: column; gap: 4px; }
        .rd-settingsNavCell { display: flex; align-items: center; gap: 8px; height: 40px; padding: 9px 16px 9px 12px; box-sizing: border-box; border: none; border-radius: 12px; background: transparent; cursor: pointer; color: inherit; font: inherit; font-size: 14px; line-height: 22px; text-align: left; }
        .rd-settingsNavCell:hover { background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-interactive-bg-hover)); }
        .rd-settingsNavCell.rd-settingsActive { background: var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-hover)); }
        .rd-settingsNavIcon { flex: none; }
        .rd-settingsNavLabel { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .rd-settingsContent { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .rd-settingsHeader { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; height: 54px; padding: 20px 14px 8px 10px; box-sizing: border-box; }
        .rd-settingsClose { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 28px; background: transparent; cursor: pointer; color: inherit; font-size: 18px; }
        .rd-settingsClose:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-settingsOptions { flex: 1; min-height: 0; padding: 0 24px 24px; overflow-y: auto; }
        .rd-pickerMenu { position: fixed; z-index: 2147482600; min-width: 260px; max-width: min(360px, calc(100vw - 24px)); max-height: min(420px, calc(100vh - 24px)); overflow-y: auto; padding: 6px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv3); }
        .rd-addChoiceGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .rd-addChoice { display: flex; align-items: flex-start; gap: 10px; width: 100%; min-height: 92px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
        .rd-addChoice:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-addChoice[disabled] { opacity: .55; cursor: default; }
        .rd-addChoiceIcon { flex: none; color: var(--dsw-alias-label-secondary); }
        .rd-addChoiceTitle { display: block; font-size: 14px; line-height: 20px; font-weight: 520; }
        .rd-addChoiceDesc { display: block; margin-top: 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
        .rd-setupField { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
        .rd-setupLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
        .rd-hostButton { justify-content: space-between; width: 100%; }
        .rd-hostButtonLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
        .rd-setupHint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; margin-top: 8px; }
        .rd-addError { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; margin-top: 8px; }
        @keyframes rd-row-in { from { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .rd-sessionRow { animation: none; } }
      `
      document.head.appendChild(style)
      return () => style.remove()
    }

    function DirectoryFlowAnchor() { return null }

    function RemoteWorkspaceBrowser(props) {
      const remote = useRemote(s => s)
      const localSessions = props.useSessions(s => s)
      const localWorkspaces = props.useWorkspaces(s => s.items)
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
      const toggleWorkspace = (key) => setCollapsedWorkspaces(value => ({ ...value, [key]: !value[key] }))
      const workspaceViews = useMemo(() => {
        const rows = localWorkspaces.map(ws => ({
          source: { id: LOCAL_SOURCE_ID, kind: 'local', label: 'Local', state: active.kind === 'local' ? 'active' : 'ready' },
          workspace: {
            id: String(ws.workspaceId),
            title: ws.title || ws.path || 'Workspace',
            path: ws.path,
            sessions: (ws.sessionIds || []).map(id => localById[id] ? { ...localById[id], sessionId: id } : undefined).filter(row => row && row.origin !== 'subagent'),
          },
        }))
        for (const source of remote.sources) {
          if (source.state !== 'connected') continue
          const snap = remote.snapshots[source.id]
          for (const ws of byWorkspace(snap)) {
            rows.push({
              source: { id: source.id, kind: 'remote', label: source.label, state: source.state, error: source.error || (snap?.state === 'error' ? snap.error : null) },
              workspace: { id: String(ws.workspaceId), title: ws.title || ws.path || 'Workspace', path: ws.path, sessions: ws.sessions },
            })
          }
        }
        return rows.map(row => ({
          ...row,
          workspace: {
            ...row.workspace,
            sessions: textQuery === '' ? row.workspace.sessions : row.workspace.sessions.filter(session => titleOfSession(session).toLowerCase().includes(textQuery) || String(session.sessionId).toLowerCase().includes(textQuery)),
          },
        })).filter(row => textQuery === '' || row.workspace.sessions.length > 0 || row.workspace.title.toLowerCase().includes(textQuery))
      }, [active.kind, localWorkspaces, localById, remote.sources, remote.snapshots, textQuery])

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
            workspaceViews.map(({ source, workspace }) => h(WorkspaceGroup, {
              key: `${source.id}:${workspace.id}`,
              source,
              workspace,
              active,
              collapsed: collapsedWorkspaces[`${source.id}:${workspace.id}`] === true,
              toggleWorkspace,
              openLocal: props.openLocal,
            })),
            textQuery !== '' && workspaceViews.length === 0 && h('div', { className: 'rd-rowMessage rd-muted' }, 'No matching sessions'),
            h('div', { className: 'rd-rowMessage rd-muted' }, 'Configure hosts in Settings → Remote Desktop.')
          )
        )
      )
    }

    function WorkspaceGroup({ source, workspace, active, collapsed, toggleWorkspace, openLocal }) {
      const key = `${source.id}:${workspace.id}`
      return h('div', { className: 'rd-workspace', 'data-rd-workspace-id': workspace.id, 'data-rd-source-id': source.id, 'data-rd-workspace-source-kind': source.kind },
        h('div', { className: 'rd-workspaceHeader', role: 'treeitem', 'aria-expanded': !collapsed, onClick: () => toggleWorkspace(key), title: workspace.path || workspace.title },
          h('span', { className: 'rd-folder' }, collapsed ? '▸' : '▾'),
          h('span', { className: 'rd-workspaceTitle' }, workspace.title),
          source.kind === 'remote' && h('span', { className: 'rd-hostBadge', 'data-rd-host-badge': source.id },
            h('span', { className: 'rd-hostLabel' }, source.label),
            h('span', { className: `rd-stateDot rd-state-${source.state || 'connected'}` })
          )
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

    function WorkspaceAddSplitter(props) {
      const remote = useRemote(s => s)
      const localWorkspaces = props.useWorkspaces(s => s.items)
      const [splitterOpen, setSplitterOpen] = useState(false)
      const [localFlowOpen, setLocalFlowOpen] = useState(false)
      const [localBusy, setLocalBusy] = useState(false)
      const [message, setMessage] = useState('')
      const anchorRect = props.anchorRef?.current?.getBoundingClientRect?.()
      const flowAvailable = props.useDirectoryFlow ? props.useDirectoryFlow(Boolean) : false
      useEffect(() => { if (!isRemoteDesktopIframe()) void store.refreshSources() }, [])
      const closePicker = () => { setMessage(''); props.onClose?.() }
      const remoteWorkspaceRows = []
      if (!isRemoteDesktopIframe()) {
        for (const source of remote.sources) {
          if (source.state !== 'connected') continue
          const snap = remote.snapshots[source.id]
          for (const ws of byWorkspace(snap)) remoteWorkspaceRows.push({ source, workspace: ws })
        }
      }
      const menuItems = [
        ...localWorkspaces.map(ws => ({
          id: `local:${ws.workspaceId}`,
          label: ws.title || ws.path || 'Workspace',
          icon: h(IconFolderClose16, { size: 16 }),
        })),
        ...(remoteWorkspaceRows.length > 0 ? [{ type: 'separator', id: 'remote-separator' }] : []),
        ...remoteWorkspaceRows.map(({ source, workspace }) => ({
          id: `remote:${source.id}:${workspace.workspaceId}`,
          label: h('span', { className: 'rd-hostButtonLabel' }, workspace.title || workspace.path || 'Workspace'),
          icon: h(IconFolderClose16, { size: 16 }),
        })),
      ]
      const footerItems = [{ id: 'add-workspace', label: 'Add workspace…', icon: h(IconPlusOutline16, { size: 16 }) }]
      const openRemoteWorkspace = async (sourceId, workspaceId) => {
        setMessage('')
        closePicker()
        try { await startRemoteWorkspace(sourceId, workspaceId) } catch (e) { setMessage(e.message || String(e)) }
      }
      const handleMenuSelect = (id) => {
        if (id === 'add-workspace') {
          props.onClose?.()
          setSplitterOpen(true)
          return
        }
        if (id.startsWith('local:')) {
          closePicker()
          props.onPick(id.slice('local:'.length))
          return
        }
        if (id.startsWith('remote:')) {
          const [, sourceId, workspaceId] = id.split(':')
          void openRemoteWorkspace(sourceId, workspaceId)
        }
      }
      const openLocalFlow = () => {
        setMessage('')
        if (!flowAvailable) {
          setMessage('Local directory picker is unavailable in this profile.')
          return
        }
        setSplitterOpen(false)
        setLocalFlowOpen(true)
      }
      const openRemoteFlow = () => {
        setMessage('')
        if (isRemoteDesktopIframe()) {
          const { token, parent } = bridgeHash()
          if (token === '' || parent === '') {
            setMessage('Remote workspace setup requires the main host bridge.')
            return
          }
          const requestId = `${Date.now()}-${Math.random()}`
          const onResult = (event) => {
            if (event.origin !== parent) return
            const data = event.data
            if (data?.type !== 'dsh-remote-desktop/add-workspace-remote-result' || data.requestId !== requestId) return
            window.removeEventListener('message', onResult)
            if (data.status === 'error') setMessage(data.message || 'Remote workspace setup failed')
            else setSplitterOpen(false)
          }
          window.addEventListener('message', onResult)
          window.parent?.postMessage({
            type: 'dsh-remote-desktop/add-workspace-remote-request',
            token,
            requestId,
          }, parent)
          return
        }
        setSplitterOpen(false)
        store.openRemoteSetup()
      }
      const localFlowOwner = {
        open: localFlowOpen,
        busy: localBusy,
        onPicked: (path) => {
          setLocalBusy(true)
          props.createLocalWorkspace({ path }).then((workspace) => {
            setLocalFlowOpen(false)
            props.onPick(workspace.workspaceId)
          }).catch((error) => {
            setMessage(error instanceof Error ? error.message : String(error))
            setLocalFlowOpen(false)
            setSplitterOpen(true)
          }).finally(() => { setLocalBusy(false) })
        },
        onCancel: () => { setLocalFlowOpen(false) },
        onError: (error) => {
          setMessage(error)
          setLocalFlowOpen(false)
          setSplitterOpen(true)
        },
      }
      return h(React.Fragment, null,
        h(Menu, {
          open: props.open,
          anchor: null,
          items: menuItems,
          footer: footerItems,
          selectedId: props.selectedId,
          onSelect: handleMenuSelect,
          onClose: closePicker,
          portal: true,
          getAnchorRect: () => anchorRect ?? null,
        }),
        h(Modal, {
          open: splitterOpen,
          onClose: () => setSplitterOpen(false),
          title: 'Add workspace',
          closeLabel: 'Close',
          description: 'Choose where the workspace should live.',
          footer: h(Button, { variant: 'outline', onClick: () => setSplitterOpen(false) }, 'Cancel'),
        },
          h('div', { className: 'rd-addChoiceGrid', 'data-rd-add-workspace-splitter': 'true' },
            h('button', { type: 'button', className: 'rd-addChoice', onClick: openLocalFlow, 'data-rd-add-local': 'true' },
              h('span', { className: 'rd-addChoiceIcon' }, h(IconFolderOpenOutline16, { size: 16 })),
              h('span', null,
                h('span', { className: 'rd-addChoiceTitle' }, 'Local workspace'),
                h('span', { className: 'rd-addChoiceDesc' }, 'Use the official picker for this DSH instance.')
              )
            ),
            h('button', { type: 'button', className: 'rd-addChoice', onClick: openRemoteFlow, 'data-rd-add-remote': 'true' },
              h('span', { className: 'rd-addChoiceIcon' }, h(IconPlusOutline16, { size: 16 })),
              h('span', null,
                h('span', { className: 'rd-addChoiceTitle' }, 'Remote workspace'),
                h('span', { className: 'rd-addChoiceDesc' }, isRemoteDesktopIframe() ? 'Ask the main host to create one on a connected remote.' : 'Create one on a connected remote host.')
              )
            )
          ),
          message && h('div', { className: 'rd-addError', role: 'alert' }, message)
        ),
        props.renderSlot && props.renderSlot('conversation.hero.workspace.directoryFlow', localFlowOwner)
      )
    }

    function RemoteSetupModal() {
      const remote = useRemote(s => s)
      const [hostId, setHostId] = useState('')
      const [path, setPath] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [hostMenuOpen, setHostMenuOpen] = useState(false)
      const open = remote.remoteSetup.open
      const connected = remote.sources.filter(source => source.state === 'connected')
      const selected = connected.find(source => source.id === hostId) || connected[0]
      useEffect(() => {
        if (!open) return
        setHostId(connected[0]?.id || '')
        setPath('')
        setError('')
      }, [open, connected.map(source => source.id).join('\u0000')])
      const close = (status = 'cancelled', message = '') => {
        setHostMenuOpen(false)
        setBusy(false)
        setError('')
        store.closeRemoteSetup(status, message)
      }
      const submit = async () => {
        const sourceId = selected?.id || hostId
        const trimmed = path.trim()
        if (sourceId === '') { setError('Connect a remote host before adding a remote workspace.'); return }
        if (trimmed === '') { setError('Remote path is required.'); return }
        setBusy(true)
        setError('')
        try {
          const result = await remoteRpc(sourceId, 'workspace.create', { path: trimmed })
          await store.refreshSnapshot(sourceId)
          await startRemoteWorkspace(sourceId, result.workspace.workspaceId)
          close('opened')
        } catch (e) {
          const message = e.message || String(e)
          setError(message)
        } finally {
          setBusy(false)
        }
      }
      const hostItems = connected.length === 0
        ? [{ id: 'no-host', label: 'No connected hosts', disabled: true }]
        : connected.map(source => ({ id: source.id, label: source.label }))
      return h(Modal, {
        open,
        onClose: () => close('cancelled'),
        title: 'Add remote workspace',
        closeLabel: 'Close',
        description: 'Choose a connected host and enter an absolute path on that host.',
        footer: h(React.Fragment, null,
          h(Button, { variant: 'outline', disabled: busy, onClick: () => close('cancelled') }, 'Cancel'),
          h(Button, { variant: 'primary', disabled: busy || connected.length === 0, onClick: () => void submit(), 'data-rd-add-workspace-submit': 'true' }, busy ? 'Adding…' : 'Add')
        ),
      },
        h('div', { 'data-rd-remote-workspace-setup': 'true' },
          h('div', { className: 'rd-setupField' },
            h('div', { className: 'rd-setupLabel' }, 'Host'),
            h(Menu, {
              open: hostMenuOpen,
              anchor: h(Button, { variant: 'outline', className: 'rd-hostButton', disabled: busy || connected.length === 0, onClick: () => setHostMenuOpen(value => !value) },
                h('span', { className: 'rd-hostButtonLabel' }, selected?.label || 'No connected hosts'),
                h(IconChevronDownOutline14, { size: 14 })
              ),
              items: hostItems,
              selectedId: selected?.id,
              onSelect: (id) => { if (id !== 'no-host') setHostId(id); setHostMenuOpen(false) },
              onClose: () => setHostMenuOpen(false),
            })
          ),
          h('label', { className: 'rd-setupField' },
            h('span', { className: 'rd-setupLabel' }, 'Remote absolute path'),
            h(Input, { value: path, disabled: busy, placeholder: '/path/to/project', onChange: e => setPath(e.target.value), onKeyDown: e => { if (e.key === 'Enter') void submit() } })
          ),
          connected.length === 0 && h('div', { className: 'rd-setupHint' }, 'Connect a host in Settings → Remote Desktop before creating a remote workspace.'),
          error && h('div', { className: 'rd-addError', role: 'alert' }, error)
        )
      )
    }

    function RemoteOverlay() {
      const remote = useRemote(s => s)
      const { sources, active, pendingOpen } = remote
      const [host, setHost] = useState(null)
      const [left, setLeftState] = useState(0)
      const leftRef = useRef(0)
      const setLeft = (next) => { if (leftRef.current !== next) { leftRef.current = next; setLeftState(next) } }
      const frames = useRef(new Map())
      const tokenToSource = useMemo(() => new Map(sources.map(source => [source.token, source.id])), [sources])
      const source = active.kind === 'remote' ? sources.find(s => s.id === active.sourceId) : undefined
      useEffect(() => {
        const node = document.createElement('div')
        node.setAttribute('data-rd-overlay-host', 'body-portal')
        document.body.appendChild(node)
        setHost(node)
        return () => { node.remove(); setHost(null) }
      }, [])
      useEffect(() => {
        const measure = () => {
          const col = document.querySelector('[class*="sidebarCol"]')
          setLeft(col ? Math.round(col.getBoundingClientRect().right) : 0)
        }
        const observed = new Set()
        const ro = new ResizeObserver(measure)
        const observe = (element) => {
          if (!(element instanceof Element) || observed.has(element)) return
          observed.add(element)
          ro.observe(element)
        }
        const refreshObserved = () => {
          observe(document.body)
          observe(document.documentElement)
          observe(document.querySelector('[class*="sidebarCol"]'))
          observe(document.querySelector('[class*="frame"]'))
        }
        measure()
        refreshObserved()
        const mo = new MutationObserver(() => { refreshObserved(); measure() })
        mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })
        window.addEventListener('resize', measure)
        document.addEventListener('pointermove', measure, true)
        document.addEventListener('pointerup', measure, true)
        const timer = window.setInterval(measure, 250)
        return () => {
          window.clearInterval(timer)
          document.removeEventListener('pointermove', measure, true)
          document.removeEventListener('pointerup', measure, true)
          window.removeEventListener('resize', measure)
          mo.disconnect()
          ro.disconnect()
        }
      }, [])
      useEffect(() => {
        const onMessage = (event) => {
          const data = event.data
          if (data?.type === 'dsh-remote-desktop/ready') {
            const sourceId = tokenToSource.get(data.sourceToken)
            if (sourceId !== undefined) store.markReady(sourceId)
            return
          }
          if (!isAddWorkspaceBridgeRequest(data)) return
          const sourceId = tokenToSource.get(data.token)
          const source = sourceId === undefined ? undefined : sources.find(item => item.id === sourceId)
          if (source === undefined || event.origin !== new URL(source.iframeUrl).origin) return
          store.openRemoteSetup({ requestId: data.requestId, origin: event.origin, target: event.source })
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

      const overlay = h('div', { style: { ...styles.overlay, left, display: source ? 'block' : 'none' }, 'data-rd-overlay-active': source ? 'true' : 'false' },
        sources.filter(s => s.state === 'connected' && s.iframeUrl).map(s => h('iframe', {
          key: s.id,
          ref: el => { if (el) frames.current.set(s.id, el); else frames.current.delete(s.id) },
          src: withParent(s.iframeUrl),
          style: { ...styles.iframe, display: source?.id === s.id ? 'block' : 'none' },
          'data-rd-frame-source-id': s.id,
          title: `Remote dsh ${s.label}`,
        })),
      )
      return h(React.Fragment, null,
        host ? ReactDOM.createPortal(overlay, host) : null,
        h(RemoteSetupModal, null)
      )
    }

    function withParent(url) {
      const u = new URL(url)
      const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
      hash.set('parent', window.location.origin)
      u.hash = hash.toString()
      return String(u)
    }


    function slotLabel(label) {
      if (typeof label === 'function') return String(label())
      return label == null ? '' : String(label)
    }

    function SettingsShell(props) {
      const rows = props.useSettingsSections(s => s)
      const [open, setOpen] = useState(false)
      const [activeId, setActiveId] = useState(undefined)
      const [activeHostId, setActiveHostIdState] = useState('local')
      const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id
      const setActiveHostId = (id) => { setSettingsHost(id); setActiveHostIdState(id) }
      const close = () => { setSettingsHost('local'); setActiveHostIdState('local'); setOpen(false); setActiveId(undefined) }
      useEffect(() => () => setSettingsHost('local'), [])
      useEffect(() => {
        if (!open) return
        const onKeyDown = (event) => { if (event.key === 'Escape') close() }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open])
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'rd-settingsTrigger', onClick: () => setOpen(true), 'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false' }, props.wide === false ? '⚙' : '⚙ Settings'),
        open && h('div', { className: 'rd-settingsOverlay', role: 'presentation' },
          h('div', { className: 'rd-settingsMask', onClick: close }),
          h('div', { className: 'rd-settingsPanel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
            h('nav', { className: 'rd-settingsNav' },
              h('div', { className: 'rd-settingsTitle' }, 'Settings'),
              h('div', { className: 'rd-settingsNavList' }, rows.map(row => h('button', { key: row.id, type: 'button', className: `rd-settingsNavCell${row.id === active ? ' rd-settingsActive' : ''}`, onClick: () => setActiveId(row.id), 'aria-current': row.id === active ? 'true' : undefined },
                h('span', { className: 'rd-settingsNavIcon' }, '⚙'),
                h('span', { className: 'rd-settingsNavLabel' }, row.label)
              )))
            ),
            h('div', { className: 'rd-settingsContent' },
              h('div', { className: 'rd-settingsHeader' },
                h(SettingsHostFilter, { activeHostId, setActiveHostId }),
                h('button', { type: 'button', className: 'rd-settingsClose', onClick: close, 'aria-label': 'Close' }, '×')
              ),
              h('div', { className: 'rd-settingsOptions' }, active !== undefined && props.renderSlot('settings.section', { close, activeHostId }, { only: active }))
            )
          )
        )
      )
    }

    function GeneralSection(props) {
      return h('div', { style: styles.settings }, props.renderSlot('settings.general.item', {}))
    }

    function SettingsHostFilter({ activeHostId, setActiveHostId }) {
      const sources = useRemote(s => s.sources)
      const [open, setOpen] = useState(false)
      useEffect(() => { void store.refreshSources() }, [])
      const active = activeHostId === 'local' ? { id: 'local', label: 'All settings', state: 'connected' } : sources.find(source => source.id === activeHostId)
      const select = (id) => { setSettingsHost(id); setActiveHostId(id); setOpen(false) }
      return h('div', { style: styles.hostFilter, 'data-rd-settings-host-filter': 'true' },
        h('button', { type: 'button', style: styles.hostFilterButton, onClick: () => setOpen(value => !value), 'data-rd-settings-host-filter-button': 'true' },
          h('span', null, active?.label ?? activeHostId),
          activeHostId !== 'local' && h('span', { className: `rd-stateDot rd-state-${active?.state ?? 'disconnected'}` }),
          h('span', null, '⌄')
        ),
        open && h('div', { style: styles.hostFilterMenu, 'data-rd-settings-host-filter-menu': 'true' },
          h('button', { type: 'button', style: styles.hostFilterItem, onClick: () => select('local'), 'data-rd-settings-host-option': 'local' }, 'All settings'),
          sources.map(source => h('button', { key: source.id, type: 'button', style: styles.hostFilterItem, onClick: () => select(source.id), 'data-rd-settings-host-option': source.id },
            h('span', null, source.label),
            h('span', { className: `rd-stateDot rd-state-${source.state}` })
          ))
        )
      )
    }

    function SettingsSection({ activeHostId = 'local' }) {
      const sources = useRemote(s => s.sources)
      const [message, setMessage] = useState('')
      useEffect(() => { void store.refreshSources() }, [])
      const connect = async (id) => {
        try { await store.connect(id); setMessage('Connected') } catch (e) { setMessage(e.message || String(e)) }
      }
      const disconnect = async (id) => {
        try { await store.disconnect(id); setMessage('Disconnected') } catch (e) { setMessage(e.message || String(e)) }
      }
      if (activeHostId !== 'local') {
        const active = sources.find(source => source.id === activeHostId)
        return h('div', { style: styles.settings, 'data-rd-settings-section': 'true', 'data-rd-settings-remote-host-placeholder': activeHostId },
          h('h2', null, active?.label ?? activeHostId),
          h('p', null, active?.state === 'connected' ? 'This remote host is selected in the global Host filter.' : 'This remote host is not connected.'),
          active?.state !== 'connected' && h('button', { 'data-rd-settings-connect': activeHostId, onClick: () => void connect(activeHostId) }, 'Connect')
        )
      }
      return h('div', { style: styles.settings, 'data-rd-settings-section': 'true' },
        h('h2', null, 'Remote Desktop'),
        h('p', null, 'Hosts come from this machine\'s SSH config. A host is connected when its remote dsh web profile and companion answer through SSH.'),
        message && h('div', { style: message.toLowerCase().includes('error') || message.toLowerCase().includes('required') ? styles.error : styles.hint }, message),
        h('h3', null, 'SSH hosts'),
        sources.length === 0 && h('div', { style: styles.hint }, 'No concrete Host entries found in ~/.ssh/config.'),
        sources.map(source => h('div', { key: source.id, style: styles.card, 'data-rd-settings-source-id': source.id },
          h('div', { style: styles.hostRow },
            h('strong', null, source.label),
            h('span', { style: styles.hostStatus, 'data-rd-settings-host-state': source.state }, source.state === 'connected' ? 'connected' : 'not connected')
          ),
          h('div', { style: styles.hint }, [source.sshUser, source.sshHost].filter(Boolean).join('@') || source.sshAlias || source.id),
          source.error && h('div', { style: styles.error }, source.error),
          h('div', { style: styles.actions },
            h('button', { 'data-rd-settings-connect': source.id, onClick: () => void connect(source.id) }, 'Connect'),
            h('button', { 'data-rd-settings-disconnect': source.id, onClick: () => void disconnect(source.id) }, 'Disconnect')
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
      const iframeMode = isRemoteDesktopIframe()
      if (!iframeMode) installHostApiFetchPatch()
      const openLocal = (sessionId) => ctx.sessions.open(sessionId)
      const createLocalWorkspace = input => ctx.workspaces.create(input)
      const flowSource = {
        getSnapshot: () => ctx.slots.entries('conversation.hero.workspace.directoryFlow').length > 0,
        subscribe: listener => ctx.slots.subscribe('conversation.hero.workspace.directoryFlow', listener),
      }
      ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
        name: 'conversation.hero.workspace',
        priority: -10,
        children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
        inject: () => ({ createLocalWorkspace, hooks: { directoryFlow: flowSource } }),
      }, WorkspaceAddSplitter))
      if (iframeMode) {
        ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
          name: 'sidebar.workspaces',
          priority: -10,
          children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
        }, DirectoryFlowAnchor))
        return
      }
      if (typeof ctx.provide === 'function') ctx.provide('remoteDesktop', createService(openLocal))
      else window.__dshRemoteDesktop = createService(openLocal)
      ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
        name: 'sidebar.workspaces',
        priority: -10,
        children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
        inject: () => ({ openLocal }),
      }, RemoteWorkspaceBrowser))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'remote-desktop-overlay',
        order: 100,
      }, RemoteOverlay))
      let rowsVersion = -1
      let rows = []
      const settingsShellInjected = () => ({
        hooks: {
          settingsSections: {
            getSnapshot: () => {
              const version = ctx.slots.getVersion('settings.section')
              if (version !== rowsVersion) {
                rowsVersion = version
                rows = ctx.slots.entries('settings.section')
                  .map(entry => ({ id: entry.options.id || '', order: entry.options.order || 0, label: slotLabel(entry.options.label) }))
                  .sort((a, b) => a.order - b.order)
              }
              return rows
            },
            subscribe: listener => ctx.slots.subscribe('settings.section', listener),
          },
        },
      })
      ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
        name: 'sidebar.settings',
        children: {
          'settings.section': { kind: 'list', scope: 'root' },
        },
        inject: settingsShellInjected,
      }, SettingsShell))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'general',
        order: 0,
        label: 'General',
        children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
      }, GeneralSection))
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
      settings: { padding: 16, maxWidth: 720, font: '14px system-ui, sans-serif' },
      label: { display: 'block', margin: '10px 0', fontSize: 12, color: 'inherit' },
      input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #999)', background: 'transparent', color: 'inherit' },
      button: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #777)', background: 'transparent', color: 'inherit' },
      card: { border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))', borderRadius: 10, padding: 10, margin: '8px 0' },
      actions: { display: 'flex', gap: 8, marginTop: 8 },
      hostRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      hostStatus: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
      hostFilter: { position: 'relative', display: 'inline-flex' },
      hostFilterButton: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))', background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'inherit' },
      hostFilterMenu: { position: 'absolute', top: 36, right: 0, minWidth: 180, zIndex: 2, display: 'flex', flexDirection: 'column', gap: 2, padding: 6, borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2, #fff)', boxShadow: 'var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.18))' },
      hostFilterItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 8px', border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', textAlign: 'left' },
    }

    return module.exports
  },
})
