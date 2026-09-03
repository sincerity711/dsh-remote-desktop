    function RemoteOverlay() {
      const remote = useRemote(s => s)
      const { sources, active, pendingOpen, companionReady } = remote
      const [left, setLeftState] = useState(0)
      const leftRef = useRef(0)
      const setLeft = (next) => { if (leftRef.current !== next) { leftRef.current = next; setLeftState(next) } }
      const frames = useRef(new Map())
      const tokenToSource = useMemo(() => new Map(sources.map(source => [source.token, source.id])), [sources])
      const source = active.kind === 'remote' ? sources.find(s => s.id === active.sourceId) : undefined
      useEffect(() => {
        const connected = new Set(sources.filter(item => item.state === 'connected').map(item => item.id))
        for (const sourceId of [...remoteBridges.keys()]) if (!connected.has(sourceId)) closeRemoteBridge(sourceId)
      }, [sources])
      useEffect(() => () => {
        for (const sourceId of [...remoteBridges.keys()]) closeRemoteBridge(sourceId)
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
        mo.observe(document.body, { subtree: true, childList: true })
        window.addEventListener('resize', measure)
        return () => {
          window.removeEventListener('resize', measure)
          mo.disconnect()
          ro.disconnect()
        }
      }, [])
      useEffect(() => {
        const onMessage = (event) => {
          const data = event.data
          if (data?.type === 'dsh-remote-desktop/bridge-listening'
            && data.protocolVersion === BRIDGE_PROTOCOL_VERSION
            && typeof data.sourceToken === 'string') {
            const sourceId = tokenToSource.get(data.sourceToken)
            const source = sourceId === undefined ? undefined : sources.find(item => item.id === sourceId)
            const frame = source === undefined ? undefined : frames.current.get(source.id)
            if (source === undefined || event.origin !== new URL(source.iframeUrl).origin || event.source !== frame?.contentWindow) return
            attachRemoteBridge(source, event.source)
            return
          }
          if (!isAddWorkspaceBridgeRequest(data)) return
          const sourceId = tokenToSource.get(data.token)
          const source = sourceId === undefined ? undefined : sources.find(item => item.id === sourceId)
          const frame = source === undefined ? undefined : frames.current.get(source.id)
          if (source === undefined || event.origin !== new URL(source.iframeUrl).origin || event.source !== frame?.contentWindow) return
          store.openRemoteSetup({ requestId: data.requestId, origin: event.origin, target: event.source })
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [tokenToSource])
      useEffect(() => {
        if (!source || !pendingOpen || pendingOpen.sourceId !== source.id || !companionReady[source.id]) return
        const controller = new AbortController()
        void remoteRpc(source.id, 'session/open', { sessionId: pendingOpen.sessionId }, controller.signal).then(() => {
          store.settleOpen(source.id, pendingOpen.sessionId)
        }).catch((error) => {
          if (!controller.signal.aborted) store.settleOpen(source.id, pendingOpen.sessionId, error instanceof Error ? error.message : String(error))
        })
        return () => controller.abort()
      }, [source?.id, source?.iframeUrl, source?.token, pendingOpen?.nonce, source === undefined ? undefined : companionReady[source.id]])

      // Leave the official 8px sidebar drag handle above the remote surface.
      const overlayLeft = left === 0 ? 0 : left + 4
      const overlay = h('div', { style: { ...styles.overlay, left: overlayLeft, display: source ? 'block' : 'none' }, 'data-rd-overlay-active': source ? 'true' : 'false' },
        sources.filter(s => s.state === 'connected' && s.iframeUrl).map(s => h('iframe', {
          key: s.id,
          ref: el => {
            if (el) frames.current.set(s.id, el)
            else frames.current.delete(s.id)
          },
          onLoad: event => { attachRemoteBridge(s, event.currentTarget.contentWindow) },
          src: withParent(s.iframeUrl),
          style: { ...styles.iframe, display: source?.id === s.id ? 'block' : 'none' },
          'data-rd-frame-source-id': s.id,
          title: `Remote dsh ${s.label}`,
        })),
      )
      return h(React.Fragment, null, overlay, h(RemoteSetupModal, null))
    }

    function withParent(url) {
      const u = new URL(url)
      const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
      hash.set('parent', window.location.origin)
      u.hash = hash.toString()
      return String(u)
    }

    function nativeRemoteUrl(url) {
      const u = new URL(url)
      u.search = ''
      u.hash = ''
      return String(u)
    }


    function SettingsSection() {
      const sources = useRemote(s => s.sources)
      const [pendingHost, setPendingHost] = useState(null)
      const [feedback, setFeedback] = useState(null)
      useEffect(() => { void store.refreshSources() }, [])
      const connect = async (id) => {
        setPendingHost(id)
        setFeedback(null)
        try { await store.connect(id); setFeedback({ id, tone: 'success', text: 'Connected.' }) } catch (e) { setFeedback({ id, tone: 'error', text: e.message || String(e) }) } finally { setPendingHost(null) }
      }
      const disconnect = async (id) => {
        setPendingHost(id)
        setFeedback(null)
        try { await store.disconnect(id); setFeedback({ id, tone: 'success', text: 'Disconnected.' }) } catch (e) { setFeedback({ id, tone: 'error', text: e.message || String(e) }) } finally { setPendingHost(null) }
      }
      const openNative = (source) => {
        if (!source.iframeUrl) return
        const nativeUrl = nativeRemoteUrl(source.iframeUrl)
        window.open(nativeUrl, '_blank', 'noopener,noreferrer')
      }
      return h('section', { className: 'rd-settingsSection', 'data-rd-settings-section': 'true' },
        h('h2', { className: 'rd-settingsTitle' }, 'Remote Desktop'),
        h('p', { className: 'rd-settingsIntro' }, 'Use DSH on SSH Hosts from the same Workspace browser. Connected Hosts open in place; native DSH remains available in a separate tab.'),
        h('div', { className: 'rd-settingsHeadingRow' },
          h('h3', { className: 'rd-settingsHeading' }, 'SSH Hosts'),
          h('span', { className: 'rd-settingsCount' }, `${sources.length} ${sources.length === 1 ? 'Host' : 'Hosts'}`)
        ),
        sources.length === 0 && h('div', { className: 'rd-settingsEmpty' }, 'No concrete Host entries were found in ~/.ssh/config.'),
        h('div', { className: 'rd-settingsHosts' }, sources.map(source => {
          const connected = source.state === 'connected'
          const busy = pendingHost === source.id
          const stateText = connected ? 'Connected' : source.state === 'connecting' ? 'Connecting' : source.state === 'error' ? 'Connection failed' : 'Not connected'
          const dotState = connected ? 'done' : source.state === 'connecting' ? 'ongoing' : source.state === 'error' ? 'error' : 'warning'
          const address = [source.sshUser, source.sshHost].filter(Boolean).join('@') || source.sshAlias || source.id
          return h('article', { key: source.id, className: 'rd-settingsHost', 'data-rd-settings-source-id': source.id },
            h('div', { className: 'rd-settingsHostHead' },
              h('div', { className: 'rd-settingsIdentity' },
                h('div', { className: 'rd-settingsHostName' }, source.label),
                h('div', { className: 'rd-settingsHostAddress' }, address)
              ),
              h('span', { className: 'rd-settingsHostState', 'data-rd-settings-host-state': source.state },
                h(StateDot, { state: dotState, size: 8 }),
                stateText
              )
            ),
            source.error && h('p', { className: 'rd-settingsFeedback rd-settingsFeedbackError', role: 'alert' }, source.error),
            feedback?.id === source.id && h('p', { className: `rd-settingsFeedback${feedback.tone === 'error' ? ' rd-settingsFeedbackError' : ''}`, role: feedback.tone === 'error' ? 'alert' : 'status' }, feedback.text),
            h('div', { className: 'rd-settingsActions' },
              connected
                ? h(Button, { variant: 'primary', disabled: busy || !source.iframeUrl, 'data-rd-settings-open-native': source.id, onClick: () => openNative(source) }, `Open ${source.label}`)
                : h(Button, { variant: 'primary', disabled: busy, 'data-rd-settings-connect': source.id, onClick: () => void connect(source.id) }, busy ? 'Connecting…' : 'Connect'),
              connected && h(Button, { variant: 'outline', disabled: busy, 'data-rd-settings-disconnect': source.id, onClick: () => void disconnect(source.id) }, busy ? 'Disconnecting…' : 'Disconnect')
            ),
            connected && source.iframeUrl
              ? h('a', { className: 'rd-settingsNativeUrl', href: nativeRemoteUrl(source.iframeUrl), target: '_blank', rel: 'noopener noreferrer', 'data-rd-settings-native-link': 'true' }, nativeRemoteUrl(source.iframeUrl))
              : h('div', { className: 'rd-settingsNativeUrl', 'data-rd-settings-native-placeholder': 'true' }, 'Connect to create a forwarded DSH Web URL for this Host.')
          )
        }))
      )
    }
