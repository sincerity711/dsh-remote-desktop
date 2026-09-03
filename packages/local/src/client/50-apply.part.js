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
      const sessions = ctx.get('sessions')
      const workspaces = ctx.get('workspaces')
      const uiWorkspace = new OfficialWorkspace.UiWorkspaceService(
        ctx, ctx.remote.directoryPicker, workspaces, sessions,
      )
      ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
      const openLocal = (sessionId) => sessions.open(sessionId)
      const createLocalWorkspace = input => workspaces.create(input)
      const startLocalWorkspace = async (workspaceId) => {
        const sessionId = await uiWorkspace.connectWorkspace(workspaceId)
        sessions.open(sessionId)
        // The official Session Controller changes the local selection, while
        // Remote Desktop separately owns which Host surface is visible.
        // Always switch that second state back to local as part of this action.
        store.openLocal(sessionId)
        return sessionId
      }
      const flowSource = {
        getSnapshot: () => ctx.slots.entries('conversation.hero.workspace.directoryFlow').length > 0,
        subscribe: listener => ctx.slots.subscribe('conversation.hero.workspace.directoryFlow', listener),
      }
      const browserFlowSource = {
        getSnapshot: () => ctx.slots.entries('sidebar.workspaces.directoryFlow').length > 0,
        subscribe: listener => ctx.slots.subscribe('sidebar.workspaces.directoryFlow', listener),
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
      ctx.effect(() => {
        const service = createService(openLocal)
        window.__dshRemoteDesktop = service
        return () => {
          for (const sourceId of [...remoteBridges.keys()]) closeRemoteBridge(sourceId)
          if (window.__dshRemoteDesktop === service) delete window.__dshRemoteDesktop
        }
      }, 'dsh-remote-desktop: public service and remote bridges')
      const hostInfo = {
        getSnapshot: () => ctx.remote.$host,
        subscribe: listener => ctx.on('connection/reset', listener),
      }
      ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
        name: 'sidebar.workspaces',
        priority: -10,
        children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
        store: OfficialWorkspace.createWorkspaceViewStore(),
        inject: () => ({
          openLocal,
          createLocalWorkspace,
          startLocalWorkspace,
          renameLocalWorkspace: (workspaceId, title) => workspaces.rename(workspaceId, title),
          deleteLocalWorkspace: workspaceId => workspaces.delete(workspaceId),
          insertWorkspaceBefore: (workspaceId, beforeWorkspaceId) => workspaces.insertBefore(workspaceId, beforeWorkspaceId),
          insertSessionBefore: (workspaceId, sessionId, beforeSessionId) => workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId),
          archiveSession: sessionId => uiWorkspace.archiveSession(sessionId),
          renameSession: async (sessionId, title) => {
            const session = sessions.binding(sessionId)?.session
            if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
            const result = await session.rename(title)
            if (!result.ok) throw new Error(result.error.message)
          },
          forkSession: sessionId => {
            sessions.fork({ sessionId, increaseTitle: true }).then(childId => sessions.open(childId)).catch(() => {})
          },
          searchSessions: async (query, signal) => {
            const result = await sessions.search(query, signal)
            if (!result.ok) throw new Error(result.error.message)
            return result.value
          },
          searchResultLimit: sessions.searchResultLimit,
          hooks: { directoryFlow: browserFlowSource, hostInfo },
        }),
      }, OfficialWorkspaceForkBrowser))
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
      overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, isolation: 'isolate', background: 'var(--dsw-alias-bg-base)', pointerEvents: 'auto' },
      iframe: { width: '100%', height: '100%', border: 0, background: 'transparent' },
    }

    return module.exports
  },
})
