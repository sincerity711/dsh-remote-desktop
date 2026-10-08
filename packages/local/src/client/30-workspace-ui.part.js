    function DirectoryFlowAnchor() { return null }

    const REMOTE_ID_PREFIX = 'remote::'
    const REMOTE_ID_SEPARATOR = '::'
    const REMOTE_HOST_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']
    function remoteHostColor(sourceId) {
      let hash = 0
      for (const ch of String(sourceId)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
      return REMOTE_HOST_COLORS[hash % REMOTE_HOST_COLORS.length]
    }
    function remoteKey(sourceId, id) { return `${REMOTE_ID_PREFIX}${sourceId}${REMOTE_ID_SEPARATOR}${id}` }
    function parseRemoteKey(id) {
      if (typeof id !== 'string' || !id.startsWith(REMOTE_ID_PREFIX)) return null
      const rest = id.slice(REMOTE_ID_PREFIX.length)
      const split = rest.indexOf(REMOTE_ID_SEPARATOR)
      if (split === -1) return null
      return { sourceId: rest.slice(0, split), id: rest.slice(split + REMOTE_ID_SEPARATOR.length) }
    }
    function workspaceT(key, args = {}) {
      const table = OfficialWorkspace.en || {}
      let text = table[key] || key
      for (const [name, value] of Object.entries(args)) text = text.replaceAll(`{${name}}`, String(value))
      return text
    }
    function officialSessionSummary(row, id, sourceKind, sourceId, rawSessionId, remoteMarker) {
      const projectionValues = row.projectionValues || row.projections?.values
      return {
        ...row,
        id,
        sourceKind,
        sourceId,
        rawSessionId,
        remoteMarker,
        displayTitle: titleOfSession(row),
        ...(row.title !== undefined || projectionValues?.title === undefined ? {} : { title: projectionValues.title }),
        ...(row.parentId !== undefined || row.parentSessionId === undefined ? {} : { parentId: row.parentSessionId }),
        ...(projectionValues === undefined ? {} : { projectionValues }),
        blank: Boolean(row.blank ?? row.projections?.values?.sessionListMetadata?.blank),
        running: Boolean(row.running),
        runningSubagentCount: Number(row.runningSubagentCount || 0),
        completed: Boolean(row.completed),
        updatedAt: sessionUpdatedAt(row) || Date.now(),
        createdAt: Number(row.createdAt || row.updatedAt || Date.now()),
        origin: row.origin,
      }
    }
    function OfficialWorkspaceForkBrowser(props) {
      const remote = useRemote(s => s)
      const [addAnchor, setAddAnchor] = useState(null)
      const addButtonRef = useMemo(() => ({ current: addAnchor }), [addAnchor])
      const [pickerOpen, setPickerOpen] = useState(false)
      const [splitterOpenNonce, setSplitterOpenNonce] = useState(null)
      useEffect(() => installCss(), [])
      useEffect(() => {
        void store.refreshSources()
        const events = new EventSource('/remote-desktop/api/events')
        events.onmessage = () => { void store.refreshSources() }
        events.onerror = () => { /* EventSource owns reconnect/backoff. */ }
        return () => events.close()
      }, [])
      const useCombinedSessions = (selector) => {
        const local = props.useSessions(s => s)
        const remoteSnapshot = useRemote(s => s)
        const combined = useMemo(() => {
          const byId = {}
          const ids = []
          for (const id of local.ids || Object.keys(local.byId || {})) {
            const row = local.byId?.[id]
            if (!row) continue
            byId[id] = officialSessionSummary(row, id, 'local', LOCAL_SOURCE_ID, id)
            ids.push(id)
          }
          for (const source of remoteSnapshot.sources) {
            if (source.state !== 'connected') continue
            const snap = remoteSnapshot.snapshots[source.id]
            for (const row of snap?.sessions?.items || []) {
              if (row?.origin === 'subagent') continue
              const raw = rowSessionId(row)
              if (!raw) continue
              const id = remoteKey(source.id, raw)
              const remoteMarker = { id: source.id, label: source.label, state: source.state || 'connected', color: remoteHostColor(source.id) }
              byId[id] = officialSessionSummary(row, id, 'remote', source.id, raw, remoteMarker)
              ids.push(id)
            }
          }
          const current = remoteSnapshot.active.kind === 'remote'
            ? remoteKey(remoteSnapshot.active.sourceId, remoteSnapshot.active.sessionId || '')
            : Object.values(local.byId || {}).find(row => (row.retainedBy?.mainView || 0) > 0)?.id
          return { ...local, phase: local.phase || 'ready', ids, byId, current }
        }, [local, remoteSnapshot.sources, remoteSnapshot.snapshots, remoteSnapshot.active])
        return selector(combined)
      }
      const useCombinedWorkspaces = (selector) => {
        const local = props.useWorkspaces(s => s)
        const remoteSnapshot = useRemote(s => s)
        const combined = useMemo(() => {
          const items = (local.items || []).map(ws => ({
            ...ws,
            sourceKind: 'local',
            sourceId: LOCAL_SOURCE_ID,
            sessionIds: (ws.sessionIds || []).filter(id => local.archivedSessionIds?.includes?.(id) !== true),
          }))
          const archived = [...(local.archivedSessionIds || [])]
          for (const source of remoteSnapshot.sources) {
            if (source.state !== 'connected') continue
            const snap = remoteSnapshot.snapshots[source.id]
            const remoteArchived = new Set(snap?.workspaces?.archivedSessionIds || [])
            archived.push(...[...remoteArchived].map(id => remoteKey(source.id, id)))
            for (const ws of byWorkspace(snap)) {
              const rawWorkspaceId = String(ws.workspaceId)
              items.push({
                ...ws,
                workspaceId: remoteKey(source.id, rawWorkspaceId),
                sourceKind: 'remote',
                sourceId: source.id,
                remoteMarker: { id: source.id, label: source.label, state: source.state || 'connected', color: remoteHostColor(source.id) },
                title: ws.title || ws.path || 'Workspace',
                createdAt: ws.createdAt || new Date(0).toISOString(),
                sessionIds: (ws.sessions || []).map(row => rowSessionId(row)).filter(Boolean).map(id => remoteKey(source.id, id)),
              })
            }
          }
          return { ...local, phase: local.phase || 'ready', items, archivedSessionIds: archived }
        }, [local, remoteSnapshot.sources, remoteSnapshot.snapshots])
        return selector(combined)
      }
      const decodeSession = (sessionId) => parseRemoteKey(sessionId)
      const decodeWorkspace = (workspaceId) => parseRemoteKey(workspaceId)
      const open = (sessionId) => {
        const remoteId = decodeSession(sessionId)
        if (remoteId) store.openRemote(remoteId.sourceId, remoteId.id)
        else { store.openLocal(sessionId); props.openLocal?.(sessionId) }
      }
      const startSession = (workspaceId) => {
        const remoteId = decodeWorkspace(workspaceId)
        if (remoteId) void startRemoteWorkspace(remoteId.sourceId, remoteId.id)
        else props.startLocalWorkspace?.(workspaceId)
      }
      const searchCombinedSessions = async (query, signal) => {
        const localSearch = props.searchSessions || (async () => ({ items: [], hasMore: false }))
        const localResult = await localSearch(query, signal)
        const remoteResults = await Promise.all(remote.sources.filter(source => source.state === 'connected').map(async source => {
          try {
            const result = await remoteRpc(source.id, 'session/search', { query }, signal)
            return {
              items: (result.items || []).map(item => ({ ...item, sessionId: remoteKey(source.id, rowSessionId(item) || item.sessionId) })),
              hasMore: Boolean(result.hasMore),
            }
          } catch (error) {
            if (signal?.aborted) throw error
            console.warn('remote session search rejected:', error)
            return { items: [], hasMore: false }
          }
        }))
        return {
          items: [...(localResult.items || []), ...remoteResults.flatMap(result => result.items)],
          hasMore: Boolean(localResult.hasMore) || remoteResults.some(result => result.hasMore),
        }
      }
      const addPicker = h(WorkspaceAddSplitter, {
        open: pickerOpen,
        openSplitterNonce: splitterOpenNonce,
        onClose: () => setPickerOpen(false),
        anchorRef: addButtonRef,
        selectedId: undefined,
        onPick: workspaceId => props.startLocalWorkspace?.(workspaceId),
        createLocalWorkspace: props.createLocalWorkspace,
        useWorkspaces: props.useWorkspaces,
        useDirectoryFlow: props.useDirectoryFlow,
        renderSlot: props.renderSlot,
        directoryFlowSlot: 'sidebar.workspaces.directoryFlow',
      })
      return h(React.Fragment, null,
        h(OfficialWorkspace.WorkspaceBrowser, {
          ...props,
          useSessions: useCombinedSessions,
          useWorkspaces: useCombinedWorkspaces,
          // The retained presentation consumes pending interactions, while the
          // current renderer supplies unified Session status.
          useSessionPendingInteraction: selector => props.useSessionStatus(status => selector(
            new Map([...status].filter(([, value]) => value.pendingInteraction !== undefined)
              .map(([id, value]) => [id, value.pendingInteraction])),
          )),
          startSession,
          open,
          searchSessions: searchCombinedSessions,
          searchResultLimit: props.searchResultLimit || 50,
          renameSession: async (sessionId, title) => {
            const remoteId = decodeSession(sessionId)
            if (remoteId) await renameRemoteSession(remoteId.sourceId, remoteId.id, title)
            else await props.renameSession?.(sessionId, title)
          },
          forkSession: sessionId => {
            const remoteId = decodeSession(sessionId)
            if (remoteId) forkRemoteSession(remoteId.sourceId, remoteId.id)
            else props.forkSession?.(sessionId)
          },
          renameWorkspace: async (workspaceId, title) => {
            const remoteId = decodeWorkspace(workspaceId)
            if (remoteId) await renameRemoteWorkspace(remoteId.sourceId, remoteId.id, title)
            else await props.renameLocalWorkspace?.(workspaceId, title)
          },
          deleteWorkspace: async workspaceId => {
            const remoteId = decodeWorkspace(workspaceId)
            if (remoteId) await deleteRemoteWorkspace(remoteId.sourceId, remoteId.id)
            else await props.deleteLocalWorkspace?.(workspaceId)
          },
          insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
            const remoteId = decodeWorkspace(workspaceId)
            const beforeRemoteId = decodeWorkspace(beforeWorkspaceId)
            if (remoteId) {
              if (beforeWorkspaceId !== undefined && beforeRemoteId?.sourceId !== remoteId.sourceId) throw new Error('Cannot reorder remote workspaces across sources')
              await insertRemoteWorkspaceBefore(remoteId.sourceId, remoteId.id, beforeRemoteId?.id)
            } else if (beforeRemoteId === null) await props.insertWorkspaceBefore?.(workspaceId, beforeWorkspaceId)
            else throw new Error('Cannot reorder local workspaces into a remote source')
          },
          archiveSession: async sessionId => {
            const remoteId = decodeSession(sessionId)
            if (remoteId) await archiveRemoteSession(remoteId.sourceId, remoteId.id)
            else await props.archiveSession?.(sessionId)
          },
          insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
            const workspaceRemoteId = decodeWorkspace(workspaceId)
            const sessionRemoteId = decodeSession(sessionId)
            const beforeRemoteId = decodeSession(beforeSessionId)
            if (workspaceRemoteId || sessionRemoteId || beforeRemoteId) {
              if (!workspaceRemoteId || !sessionRemoteId || workspaceRemoteId.sourceId !== sessionRemoteId.sourceId || (beforeSessionId !== undefined && beforeRemoteId?.sourceId !== workspaceRemoteId.sourceId)) throw new Error('Cannot reorder sessions across sources')
              await insertRemoteSessionBefore(workspaceRemoteId.sourceId, workspaceRemoteId.id, sessionRemoteId.id, beforeRemoteId?.id)
            } else await props.insertSessionBefore?.(workspaceId, sessionId, beforeSessionId)
          },
          createWorkspace: props.createLocalWorkspace,
          t: workspaceT,
          openWorkspaceAdd: (anchorRef) => {
            setAddAnchor(anchorRef?.current ?? null)
            setPickerOpen(false)
            setSplitterOpenNonce(`${Date.now()}-${Math.random()}`)
          },
        }),
        (pickerOpen || splitterOpenNonce !== null) ? addPicker : null
      )
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
      useEffect(() => {
        if (props.openSplitterNonce === undefined || props.openSplitterNonce === null) return
        setMessage('')
        setSplitterOpen(true)
      }, [props.openSplitterNonce])
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
          icon: h(IconFolderCloseRegular, { size: 16 }),
        })),
        ...(remoteWorkspaceRows.length > 0 ? [{ type: 'separator', id: 'remote-separator' }] : []),
        ...remoteWorkspaceRows.map(({ source, workspace }) => ({
          id: `remote:${source.id}:${workspace.workspaceId}`,
          label: h('span', { className: 'rd-hostButtonLabel' }, workspace.title || workspace.path || 'Workspace'),
          icon: h(IconFolderCloseRegular, { size: 16 }),
        })),
      ]
      const footerItems = [{ id: 'add-workspace', label: 'Add workspace…', icon: h(IconProjectAddOutlineRegular, { size: 16 }) }]
      // Picker rows use source-qualified ids so local and remote Workspace ids
      // cannot collide. The conversation owner still reports its local
      // selection as the raw Workspace id, so qualify it before handing it to
      // Menu; otherwise a successfully selected Workspace never renders as
      // selected in the chat picker.
      const selectedMenuId = props.selectedId === undefined
        ? undefined
        : `local:${props.selectedId}`
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
          const timer = window.setTimeout(() => {
            window.removeEventListener('message', onResult)
            setMessage('Remote workspace setup timed out.')
          }, 30000)
          const onResult = (event) => {
            if (event.origin !== parent || event.source !== window.parent) return
            const data = event.data
            if (data?.type !== 'dsh-remote-desktop/add-workspace-remote-result' || data.requestId !== requestId) return
            window.clearTimeout(timer)
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
          selectedId: selectedMenuId,
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
              h('span', { className: 'rd-addChoiceIcon' }, h(IconFolderOpenOutlineRegular, { size: 16 })),
              h('span', null,
                h('span', { className: 'rd-addChoiceTitle' }, 'Local workspace'),
                h('span', { className: 'rd-addChoiceDesc' }, 'Use the official picker for this DSH instance.')
              )
            ),
            h('button', { type: 'button', className: 'rd-addChoice', onClick: openRemoteFlow, 'data-rd-add-remote': 'true' },
              h('span', { className: 'rd-addChoiceIcon' }, h(IconProjectAddOutlineRegular, { size: 16 })),
              h('span', null,
                h('span', { className: 'rd-addChoiceTitle' }, 'Remote workspace'),
                h('span', { className: 'rd-addChoiceDesc' }, isRemoteDesktopIframe() ? 'Ask the main host to create one on a connected remote.' : 'Create one on a connected remote host.')
              )
            )
          ),
          message && h('div', { className: 'rd-addError', role: 'alert' }, message)
        ),
        props.renderSlot && props.renderSlot(props.directoryFlowSlot || 'conversation.hero.workspace.directoryFlow', localFlowOwner)
      )
    }

    function RemoteSetupModal() {
      const remote = useRemote(s => s)
      const [hostId, setHostId] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [hostMenuOpen, setHostMenuOpen] = useState(false)
      const [showHidden, setShowHidden] = useState(false)
      const [browse, setBrowse] = useState({ status: 'idle', path: '', home: '', parent: undefined, entries: [], error: '' })
      const browseControllerRef = useRef(null)
      const open = remote.remoteSetup.open
      const connected = remote.sources.filter(source => source.state === 'connected')
      const selected = connected.find(source => source.id === hostId) || connected[0]
      useEffect(() => {
        if (!open) return
        setHostId(connected[0]?.id || '')
        setShowHidden(false)
        setBrowse({ status: 'idle', path: '', home: '', parent: undefined, entries: [], error: '' })
        setError('')
      }, [open, connected.map(source => source.id).join('\u0000')])
      useEffect(() => {
        if (!open || selected === undefined) return
        const controller = new AbortController()
        setBrowse(current => ({ ...current, status: 'loading', error: '' }))
        browseRemoteDirectory(selected.id, undefined, showHidden, controller.signal).then(result => {
          if (controller.signal.aborted) return
          setBrowse({ status: 'ready', path: result.path, home: result.home, parent: result.parent, entries: result.entries, error: '' })
        }).catch(reason => {
          if (controller.signal.aborted) return
          setBrowse(current => ({ ...current, status: 'error', error: reason instanceof Error ? reason.message : String(reason) }))
        })
        return () => controller.abort()
      }, [open, selected?.id])
      const close = (status = 'cancelled', message = '') => {
        browseControllerRef.current?.abort()
        browseControllerRef.current = null
        setHostMenuOpen(false)
        setBusy(false)
        setError('')
        store.closeRemoteSetup(status, message)
      }
      const browseTo = (nextPath, hidden = showHidden) => {
        const sourceId = selected?.id || hostId
        if (sourceId === '') return
        browseControllerRef.current?.abort()
        const controller = new AbortController()
        browseControllerRef.current = controller
        setBrowse(current => ({ ...current, status: 'loading', error: '' }))
        browseRemoteDirectory(sourceId, nextPath, hidden, controller.signal).then(result => {
          setBrowse({ status: 'ready', path: result.path, home: result.home, parent: result.parent, entries: result.entries, error: '' })
        }).catch(reason => {
          if (controller.signal.aborted) return
          setBrowse(current => ({ ...current, status: 'error', error: reason instanceof Error ? reason.message : String(reason) }))
        })
      }
      const submit = async () => {
        const sourceId = selected?.id || hostId
        const selectedPath = browse.path
        if (sourceId === '') { setError('Connect a remote host before adding a remote workspace.'); return }
        if (selectedPath === '') { setError('Choose a remote directory before adding a workspace.'); return }
        setBusy(true)
        setError('')
        try {
          const result = await remoteRpc(sourceId, 'workspace/create', { path: selectedPath })
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
      const breadcrumbs = remoteBreadcrumbs(browse.path, browse.home)
      const browseBusy = browse.status === 'loading'
      return h(Modal, {
        open,
        onClose: () => close('cancelled'),
        title: 'Add remote workspace',
        closeLabel: 'Close',
        description: 'Choose a connected host and browse to the remote folder to use as a workspace.',
        footer: h(React.Fragment, null,
          h(Button, { variant: 'outline', disabled: busy, onClick: () => close('cancelled') }, 'Cancel'),
          h(Button, { variant: 'primary', disabled: busy || browseBusy || connected.length === 0 || browse.path === '', onClick: () => void submit(), 'data-rd-add-workspace-submit': 'true' }, busy ? 'Adding…' : 'Create workspace here')
        ),
      },
        h('div', { 'data-rd-remote-workspace-setup': 'true', 'data-rd-remote-directory-picker': 'true' },
          h('div', { className: 'rd-setupField' },
            h('div', { className: 'rd-setupLabel' }, 'Host'),
            h(Menu, {
              open: hostMenuOpen,
              anchor: h(Button, { variant: 'outline', className: 'rd-hostButton', disabled: busy || connected.length === 0, onClick: () => setHostMenuOpen(value => !value) },
                h('span', { className: 'rd-hostButtonLabel' }, selected?.label || 'No connected hosts'),
                h(IconChevronDownOutlineRegular, { size: 14 })
              ),
              items: hostItems,
              selectedId: selected?.id,
              onSelect: (id) => { if (id !== 'no-host') setHostId(id); setHostMenuOpen(false) },
              onClose: () => setHostMenuOpen(false),
            })
          ),
          connected.length === 0 && h('div', { className: 'rd-setupHint' }, 'Connect a host in Settings → Remote Desktop before creating a remote workspace.'),
          connected.length > 0 && h('div', { className: 'rd-browsePanel' },
            h('div', { className: 'rd-browseToolbar' },
              h('div', { className: 'rd-breadcrumbs', 'data-rd-remote-breadcrumbs': 'true' },
                breadcrumbs.map((item, index) => h(React.Fragment, { key: `${item.path}:${index}` },
                  index > 0 && h('span', { className: 'rd-breadcrumbSep', 'aria-hidden': 'true' }, '/'),
                  h('button', { type: 'button', className: 'rd-breadcrumbButton', disabled: busy || browseBusy, title: item.path, onClick: () => browseTo(item.path), 'data-rd-breadcrumb-path': item.path }, item.label)
                ))
              ),
              h(Button, { variant: showHidden ? 'primary' : 'outline', className: 'rd-hiddenToggle', disabled: busy || browseBusy, onClick: () => { const next = !showHidden; setShowHidden(next); browseTo(browse.path || undefined, next) }, 'data-rd-show-hidden': showHidden ? 'true' : 'false' }, 'Show hidden')
            ),
            h('div', { className: 'rd-directoryList', 'data-rd-remote-directory-list': 'true' },
              browseBusy && h('div', { className: 'rd-browseStatus', role: 'status' }, 'Loading remote folders…'),
              browse.status === 'error' && h('div', { className: 'rd-browseStatus rd-browseStatusError', role: 'alert' },
                h('div', null, browse.error || 'Cannot read this directory.'),
                h(Button, { variant: 'outline', disabled: busy, onClick: () => browseTo(browse.path || undefined), 'data-rd-browse-retry': 'true' }, 'Retry')
              ),
              browse.status === 'ready' && browse.entries.length === 0 && h('div', { className: 'rd-browseStatus' }, 'No folders in this directory.'),
              browse.status === 'ready' && browse.entries.map(entry => h('button', { key: entry.path, type: 'button', className: 'rd-directoryRow', disabled: busy, onClick: () => browseTo(entry.path), 'data-rd-directory-path': entry.path },
                h(IconFolderCloseRegular, { size: 16 }),
                h('span', { className: 'rd-directoryName' }, entry.name)
              ))
            )
          ),
          browse.path && h('div', { className: 'rd-currentPath', 'data-rd-selected-remote-path': browse.path }, browse.path),
          error && h('div', { className: 'rd-addError', role: 'alert' }, error)
        )
      )
    }
