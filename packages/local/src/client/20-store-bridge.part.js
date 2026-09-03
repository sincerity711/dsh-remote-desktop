    const LOCAL_SOURCE_ID = 'local'
    const ACTIVE_CHANGED = 'dsh-remote-desktop/active-changed'
    const BRIDGE_PROTOCOL_VERSION = 1
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
      let sourceRefreshGeneration = 0
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
          const generation = ++sourceRefreshGeneration
          try {
            const json = await api('/sources')
            if (generation !== sourceRefreshGeneration) return
            set({ sources: json.sources, loaded: true, error: null })
          } catch (error) {
            if (generation !== sourceRefreshGeneration) return
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
          closeRemoteBridge(id)
          set({ active: snapshot.active.kind === 'remote' && snapshot.active.sourceId === id ? { kind: 'local', sessionId: undefined } : snapshot.active })
          await this.refreshSources()
        },
        async delete(id) {
          await api('/delete', { method: 'POST', body: JSON.stringify({ id }) })
          closeRemoteBridge(id)
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
        setSourceSnapshot(sourceId, remoteSnapshot, generation, revision) {
          const current = snapshot.snapshots[sourceId]
          if (current?.generation === generation && Number(revision) <= Number(current.revision || 0)) return
          set({ snapshots: { ...snapshot.snapshots, [sourceId]: { state: 'ready', generation, revision, ...remoteSnapshot } } })
        },
        markReady(sourceId) {
          if (snapshot.companionReady[sourceId]) return
          set({ companionReady: { ...snapshot.companionReady, [sourceId]: true } })
        },
        markNotReady(sourceId) {
          if (!snapshot.companionReady[sourceId]) return
          set({ companionReady: { ...snapshot.companionReady, [sourceId]: false } })
        },
        settleOpen(sourceId, sessionId, error) {
          if (snapshot.pendingOpen?.sourceId !== sourceId || snapshot.pendingOpen?.sessionId !== sessionId) return
          set({ pendingOpen: null, ...(error ? { error } : {}) })
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
    const remoteBridges = new Map()

    function closeRemoteBridge(sourceId, reason = new Error('remote bridge closed')) {
      const bridge = remoteBridges.get(sourceId)
      if (bridge === undefined) return
      remoteBridges.delete(sourceId)
      bridge.port.close()
      for (const pending of bridge.pending.values()) {
        window.clearTimeout(pending.timer)
        pending.reject(reason)
      }
      bridge.pending.clear()
      store.markNotReady(sourceId)
    }

    function attachRemoteBridge(source, target) {
      closeRemoteBridge(source.id, new Error('remote bridge replaced'))
      const channel = new MessageChannel()
      const bridge = { port: channel.port1, pending: new Map(), ready: false, target, generation: null, revision: 0, capabilities: new Set() }
      remoteBridges.set(source.id, bridge)
      channel.port1.onmessage = (event) => {
        if (remoteBridges.get(source.id) !== bridge) return
        const data = event.data
        if (data?.sourceToken !== source.token || data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) return
        if (data.type === 'dsh-remote-desktop/ready') {
          if (typeof data.generation !== 'string' || !Array.isArray(data.capabilities)) return
          bridge.ready = true
          bridge.generation = data.generation
          bridge.revision = 0
          bridge.capabilities = new Set(data.capabilities.filter(value => typeof value === 'string'))
          store.markReady(source.id)
          return
        }
        if (data.type === 'dsh-remote-desktop/state-baseline' && data.snapshot) {
          if (typeof data.generation !== 'string' || !Number.isSafeInteger(data.revision) || data.revision < 1) return
          if (bridge.generation !== data.generation) {
            bridge.generation = data.generation
            bridge.revision = 0
          }
          if (data.revision <= bridge.revision) return
          bridge.revision = data.revision
          store.setSourceSnapshot(source.id, data.snapshot, data.generation, data.revision)
          return
        }
        if (data.type !== 'dsh-remote-desktop/result' || typeof data.requestId !== 'string') return
        const pending = bridge.pending.get(data.requestId)
        if (pending === undefined) return
        bridge.pending.delete(data.requestId)
        window.clearTimeout(pending.timer)
        if (data.ok === true) pending.resolve(data.value)
        else pending.reject(Object.assign(new Error(data.error?.message || 'remote bridge request failed'), { code: data.error?.code }))
      }
      channel.port1.start?.()
      target.postMessage({ type: 'dsh-remote-desktop/connect', protocolVersion: BRIDGE_PROTOCOL_VERSION, sourceToken: source.token }, new URL(source.iframeUrl).origin, [channel.port2])
    }

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

    async function remoteRpc(sourceId, method, payload = {}, signal) {
      const bridge = remoteBridges.get(sourceId)
      if (bridge === undefined || !bridge.ready) throw new Error(`remote bridge for ${sourceId} is not ready`)
      if (!bridge.capabilities.has(method)) throw new Error(`remote bridge for ${sourceId} does not support ${method}`)
      if (signal?.aborted) throw signal.reason || new Error('remote request aborted')
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
      return await new Promise((resolve, reject) => {
        const finishAbort = () => {
          const pending = bridge.pending.get(requestId)
          if (pending === undefined) return
          bridge.pending.delete(requestId)
          window.clearTimeout(pending.timer)
          reject(signal.reason || new Error('remote request aborted'))
        }
        const timer = window.setTimeout(() => {
          bridge.pending.delete(requestId)
          signal?.removeEventListener('abort', finishAbort)
          reject(new Error(`${method} timed out`))
        }, 30000)
        bridge.pending.set(requestId, {
          timer,
          resolve: (value) => { signal?.removeEventListener('abort', finishAbort); resolve(value) },
          reject: (error) => { signal?.removeEventListener('abort', finishAbort); reject(error) },
        })
        signal?.addEventListener('abort', finishAbort, { once: true })
        bridge.port.postMessage({
          type: 'dsh-remote-desktop/request', protocolVersion: BRIDGE_PROTOCOL_VERSION,
          sourceToken: store.getSnapshot().sources.find(source => source.id === sourceId)?.token,
          requestId, method, payload,
        })
      })
    }

    async function browseRemoteDirectory(sourceId, path, hidden, signal) {
      const url = new URL('/remote-desktop/api/browse', window.location.origin)
      url.searchParams.set('id', sourceId)
      url.searchParams.set('hidden', hidden ? '1' : '0')
      if (path) url.searchParams.set('path', path)
      const response = await fetch(url, { signal })
      const parsed = await response.json().catch(() => null)
      if (!response.ok || parsed?.ok !== true) throw new Error(parsed?.error?.message || `HTTP ${response.status}`)
      return { path: parsed.path, home: parsed.home, parent: parsed.parent, entries: parsed.entries || [] }
    }

    function pathSegments(path) {
      return String(path || '/').split('/').filter(Boolean)
    }

    function joinPosix(parts) {
      return `/${parts.filter(Boolean).join('/')}`.replace(/\/+$|^$/g, '') || '/'
    }

    function remoteBreadcrumbs(path, home) {
      const current = String(path || '/')
      const homePath = String(home || '')
      if (homePath !== '' && (current === homePath || current.startsWith(`${homePath}/`))) {
        const relative = current === homePath ? [] : current.slice(homePath.length + 1).split('/').filter(Boolean)
        const items = [{ label: 'Home', path: homePath }]
        const base = pathSegments(homePath)
        relative.forEach((part, index) => items.push({ label: part, path: joinPosix([...base, ...relative.slice(0, index + 1)]) }))
        return items
      }
      const parts = pathSegments(current)
      return [{ label: '/', path: '/' }, ...parts.map((part, index) => ({ label: part, path: joinPosix(parts.slice(0, index + 1)) }))]
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
      const sessionId = rowSessionId(blank) || (await remoteRpc(sourceId, 'session/create', { workspaceId })).sessionId
      store.openRemote(sourceId, sessionId)
    }


    async function renameRemoteWorkspace(sourceId, workspaceId, title) {
      await remoteRpc(sourceId, 'workspace/rename', { workspaceId, title })
    }

    async function deleteRemoteWorkspace(sourceId, workspaceId) {
      await remoteRpc(sourceId, 'workspace/delete', { workspaceId })
    }

    async function insertRemoteWorkspaceBefore(sourceId, workspaceId, beforeWorkspaceId) {
      await remoteRpc(sourceId, 'workspace/insertBefore', { workspaceId, ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }) })
    }

    async function renameRemoteSession(sourceId, sessionId, title) {
      await remoteRpc(sourceId, 'session/rename', { sessionId, title })
    }

    function forkRemoteSession(sourceId, sessionId) {
      remoteRpc(sourceId, 'session/fork', { sessionId }).then((child) => {
        store.openRemote(sourceId, child.sessionId)
        }).catch((reason) => {
        console.warn('remote session fork rejected:', reason)
      })
    }

    async function archiveRemoteSession(sourceId, sessionId) {
      await remoteRpc(sourceId, 'workspace/archiveSession', { sessionId })
    }

    async function insertRemoteSessionBefore(sourceId, workspaceId, sessionId, beforeSessionId) {
      await remoteRpc(sourceId, 'workspace/insertSessionBefore', { workspaceId, sessionId, ...(beforeSessionId === undefined ? {} : { beforeSessionId }) })
    }

    function publicSummary(source) {
      return { id: source.id, label: source.label, state: source.state, error: source.error ?? null }
    }

    function byWorkspace(snapshot) {
      if (!snapshot || snapshot.state === 'error') return []
      const sessions = snapshot.sessions?.items || []
      const byId = new Map(sessions.map(row => [rowSessionId(row), row]))
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
        .rd-settingsSection { display: flex; flex-direction: column; gap: 12px; max-width: 720px; color: var(--dsw-alias-label-primary); }
        .rd-settingsTitle { margin: 0; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 500; line-height: 24px; }
        .rd-settingsIntro { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 22px; }
        .rd-settingsHeadingRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
        .rd-settingsHeading { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
        .rd-settingsCount { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
        .rd-settingsEmpty { padding: 20px 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; text-align: center; }
        .rd-settingsHosts { display: flex; flex-direction: column; gap: 8px; }
        .rd-settingsHost { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: transparent; }
        .rd-settingsHostHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .rd-settingsIdentity { min-width: 0; }
        .rd-settingsHostName { overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
        .rd-settingsHostAddress { overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
        .rd-settingsHostState { display: inline-flex; flex: none; align-items: center; gap: 6px; min-height: 22px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
        .rd-settingsActions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .rd-settingsNativeUrl { display: block; max-width: 100%; overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
        .rd-settingsFeedback { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
        .rd-settingsFeedbackError { color: var(--dsw-alias-state-error-primary); }
        .rd-pickerMenu { position: fixed; z-index: 2147482600; min-width: 260px; max-width: min(360px, calc(100vw - 24px)); max-height: min(420px, calc(100vh - 24px)); overflow-y: auto; padding: 6px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv3); }
        .rd-addChoiceGrid { display: flex; flex-direction: column; gap: 8px; }
        .rd-addChoice { box-sizing: border-box; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
        .rd-addChoice:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-addChoice[disabled] { opacity: .55; cursor: default; }
        .rd-addChoiceIcon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
        .rd-addChoiceTitle { display: block; font-size: 14px; line-height: 22px; font-weight: 500; }
        .rd-addChoiceDesc { display: block; margin-top: 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
        .rd-setupField { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
        .rd-setupLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
        .rd-hostButton { justify-content: space-between; width: 100%; }
        .rd-hostButtonLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
        .rd-setupHint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; margin-top: 8px; }
        .rd-addError { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; margin-top: 8px; }
        .rd-browsePanel { margin-top: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: transparent; overflow: hidden; }
        .rd-browseToolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
        .rd-breadcrumbs { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; }
        .rd-breadcrumbButton { flex: none; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); padding: 3px 6px; font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
        .rd-breadcrumbButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
        .rd-breadcrumbSep { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
        .rd-hiddenToggle { flex: none; }
        .rd-directoryList { max-height: min(320px, 42vh); overflow-y: auto; padding: 6px; }
        .rd-directoryRow { box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; min-height: 36px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); padding: 0 8px; font: inherit; font-size: 14px; line-height: 22px; text-align: left; cursor: pointer; }
        .rd-directoryRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .rd-directoryName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rd-currentPath { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; margin-top: 8px; word-break: break-all; }
        .rd-browseStatus { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; padding: 18px 10px; text-align: center; }
        .rd-browseStatusError { color: var(--dsw-alias-state-error-primary); }
        @keyframes rd-row-in { from { opacity: 0; } }
        @media (max-width: 620px) { .rd-settingsHostHead { align-items: stretch; flex-direction: column; gap: 4px; } .rd-settingsActions > * { flex: 1 1 auto; } .rd-browseToolbar { align-items: stretch; flex-direction: column; } .rd-hiddenToggle { align-self: flex-start; } }
        @media (prefers-reduced-motion: reduce) { .rd-sessionNode { animation: none; } }
      `
      document.head.appendChild(style)
      return () => style.remove()
    }

