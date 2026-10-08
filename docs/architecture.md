# dsh-remote-desktop architecture

`dsh-remote-desktop` lets one local DSH web page operate sessions from other DSH web instances. It is intentionally a two-plugin system: the local plugin owns host discovery, SSH/proxy lifecycle, and the unified local/remote UI; the companion plugin runs in each remote DSH profile and validates iframe control messages from the local page.

## Package roles

| Package | Installed on | Main files | Role |
| --- | --- | --- | --- |
| `dsh-remote-desktop` | Local DSH web profile | `packages/local/lib/index.js`, `packages/local/lib/client.js` | Discovers SSH hosts, owns cancellable tunnel/proxy lifecycles, exposes authenticated management APIs and SSE state changes, projects remote Controller snapshots, and renders remote iframes. |
| `dsh-remote-desktop-companion` | Remote DSH web profile | `packages/companion/lib/index.js`, `packages/companion/lib/client.js` | Runs only inside `?dshRemoteDesktop=1` iframe mode, hides the embedded remote sidebar, validates the parent, and bridges official Controller snapshots/actions over a dedicated MessageChannel. |

The local bundle patch disables stock `ui-workspace`, keeps the official `ui-settings-general` shell enabled, then inserts `dsh-remote-desktop`. The companion bundle only inserts `dsh-remote-desktop-companion`.

## Runtime overview

```mermaid
flowchart LR
  LocalBrowser["Local DSH browser"] --> LocalClient["local client plugin"]
  LocalClient --> LocalApi["authenticated API + source SSE"]
  LocalApi --> Ssh["ssh -N -L loopback tunnel"]
  Ssh --> RemoteDsh["remote DSH web server"]
  LocalClient --> ProxyOrigin["per-host loopback proxy origin"]
  ProxyOrigin --> RemoteDsh
  LocalClient <-->|"per-source MessageChannel"| Iframe["remote iframe"]
  Iframe --> Companion["remote companion client"]
  Companion --> RemoteSessions["remote ctx.sessions"]
```

A connected host has three local runtime resources:

1. an SSH process forwarding a free local loopback port to `remoteDshHost:remoteDshPort` on the remote machine;
2. a per-host local proxy server on another free loopback port;
3. a source token embedded only in the iframe URL hash.

The source token identifies the iframe control channel. It is not used for native remote pages opened from Settings. After validating the exact parent origin, token, and window identity, the companion accepts one transferred `MessagePort`; snapshots and commands then stay on that isolated channel.

The proxy exchanges the remote DSH launch token server-side and keeps the resulting DSH session cookie in the per-source runtime. HTTP and WebSocket traffic receives that cookie upstream, so the launch token never enters iframe navigation history and browser SameSite rules cannot create a redirect loop between the two loopback ports.

Every local management route passes DSH's `ctx.connection.requestRejection()` browser-session and trusted-authority checks. The companion has no Session/Workspace Host API. Its server entry exposes only a transitional package-readiness health probe; all business state and commands use the authenticated iframe's official Client Controllers.

## Local server plugin

`packages/local/lib/index.js` is the server-side Cordis plugin. It injects `webServer` and `connection`, registers the `/remote-desktop/api` prefix, and applies the standard DSH request-rejection boundary before dispatch.

### Host state

Host definitions come from two places:

- concrete `Host` aliases in `~/.ssh/config`, excluding wildcard aliases containing `*` or `?`;
- saved source overrides in `sources.json` under `DSH_REMOTE_DESKTOP_HOME`, or under `DSH_HOME/remote-desktop` when `DSH_HOME` is set.

Saved entries override discovered SSH entries with the same id. Connections prefer `ssh <alias>` when `sshAlias` is present, so OpenSSH still owns `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump`, and related options.

### API routes

| Route | Purpose |
| --- | --- |
| `GET /remote-desktop/api/sources` | Return discovered/saved hosts plus runtime state, errors, iframe URL, and token when connected. |
| `GET /remote-desktop/api/hosts` | Alias-style host listing with the same public fields. |
| `POST /remote-desktop/api/sources` | Save or override one host definition. |
| `POST /remote-desktop/api/connect` | Start the SSH tunnel, create the proxy origin, and return connected state. |
| `POST /remote-desktop/api/disconnect` | Kill the SSH process and close the proxy for one host. |
| `POST /remote-desktop/api/delete` | Disconnect and remove a saved host override. Discovered SSH hosts remain discoverable. |
| `GET /remote-desktop/api/events` | Authenticated SSE invalidations for source lifecycle changes. |
| `GET /remote-desktop/api/browse?id=<host>&path=<path>&hidden=0|1` | List readable remote directories for the Add remote workspace picker, starting at the SSH user's home when `path` is omitted. |

### Connection lifecycle

```mermaid
sequenceDiagram
  participant UI as Local client
  participant API as Local plugin API
  participant SSH as ssh process
  participant Remote as Remote DSH
  participant Proxy as Per-host proxy

  UI->>API: POST /connect { id }
  API->>SSH: ssh host dsh plugin --profile web add companion
  API->>SSH: ssh host dsh --profile web --host remoteHost --port remotePort when needed
  API->>SSH: ssh -N -L 127.0.0.1:local:remoteHost:remotePort host
  API->>API: wait for local TCP port
  API->>Proxy: start loopback proxy to tunnel port
  API->>Remote: verify companion health endpoint
  API-->>UI: iframeUrl + token + state connected
  UI->>Iframe: transfer a source-scoped MessagePort
  Iframe-->>UI: Controller snapshot baseline
  Iframe-->>UI: event-driven Session/Workspace snapshots
```

On startup, only saved sources with `autoConnect` enabled are started; arbitrary aliases discovered from SSH config remain idle. Each source owns an abort signal, tunnel process, proxy sockets, reconnect generation, and capped exponential-backoff timer. Disconnect and Cordis teardown abort in-flight setup, destroy upgraded sockets, and suppress reconnect. Plugin-started remote DSH processes use a per-port PID file, so setup never kills an unrelated listener merely because it occupies the configured port.

## Local client plugin

The numbered sources under `packages/local/src/client/` generate `packages/local/lib/client.js`. They separate the pinned official workspace code from the plugin-owned store/bridge, workspace UI, overlay/settings, and registration sections while preserving the single ModuleLoader factory DSH consumes. `npm run check:generated` prevents source/release drift.

The client maintains an in-memory remote store containing sources, remote snapshots, active target, pending iframe requests, companion readiness, and remote workspace setup. Source state is invalidated by authenticated SSE; Session/Workspace state is pushed from the iframe Controller stores and coalesced per microtask.

The client runs in two modes.

| Mode | Detection | Enabled behavior |
| --- | --- | --- |
| Main-host mode | no `?dshRemoteDesktop=1` query marker | unified sidebar, remote iframe overlay, official Settings extension, remote source service, source SSE, Controller snapshots, and the parent side of the iframe bridge. |
| Remote-iframe mode | `?dshRemoteDesktop=1` | only the Add workspace splitter and a directory-flow anchor. Sidebar, settings shell, source management, and overlay are disabled inside the iframe. |

Main-host mode exposes a small lifecycle-scoped `window.__dshRemoteDesktop` service. It provides source listing, subscription, active target, and open-local/open-remote commands and is removed during plugin teardown/HMR.

## Sidebar and workspace projection

The local sidebar presents a project-first tree. Local workspaces and connected remote workspaces appear in one list; remote workspace rows carry a compact host marker rather than being grouped under host headings.

Remote ids are source-qualified before entering the official workspace browser logic:

```text
remote::<sourceId>::<rawWorkspaceOrSessionId>
```

This prevents collisions between local ids and remote ids, and between different hosts. When a row is clicked, the wrapper decodes the id:

- local session rows call local `ctx.uiWorkspace.openSession` and set active target to local;
- remote session rows set active target to `{ kind: "remote", sourceId, sessionId }` and issue a latest-wins `session/open` bridge request;
- local workspace mutation actions still call local workspace/session APIs;
- supported remote workspace/session mutations run through the owning iframe’s official `ctx.sessions`/`ctx.workspaces` client services;
- cross-source drag and reorder attempts are rejected before a local or unrelated remote API receives a source-qualified id.

Ungrouped sessions are also source-aware. Local loose sessions render under the local Ungrouped bucket, and each connected remote host with loose sessions renders its own Ungrouped bucket with the same compact host marker used by remote workspace rows. Each Ungrouped bucket exposes `Archive all sessions`, which archives only that bucket's sessions through the local archive API or that host's remote `workspace.archiveSession` API.

## Remote iframe overlay and bridge

The remote overlay occupies the official `shell.overlay` seat and is positioned from the right edge of the local sidebar to the frame edge. It keeps one iframe per connected source and shows only the active remote source. ResizeObserver and structural mutation observation replace the former pointer/250 ms measurement polling.

The parent first transfers a dedicated channel after validating the iframe window and origin. The protocol is versioned, advertises an explicit capability allowlist, and identifies each Controller publication generation and revision:

```text
parent -> child: dsh-remote-desktop/request { protocolVersion, sourceToken, requestId, method, payload }
child  -> parent: dsh-remote-desktop/result { protocolVersion, sourceToken, requestId, ok, value|error }
child  -> parent: dsh-remote-desktop/state-baseline { protocolVersion, sourceToken, generation, revision, snapshot }
child  -> parent: dsh-remote-desktop/ready { protocolVersion, sourceToken, generation, capabilities }
```

The companion accepts the initial channel only when origin, token, and `event.source === window.parent` all match. The parent transfers the port only to the expected iframe window and exact proxy origin. Requests have correlation ids, timeouts, and latest-wins cancellation for Session navigation.

## Companion plugin

`packages/companion/lib/client.js` applies only when the remote page has `?dshRemoteDesktop=1`, a non-empty `token`, and a non-empty `parent` hash parameter.

It performs three tasks:

1. installs scoped CSS that hides the remote app's own left sidebar while keeping the remote main area and remote plugins mounted;
2. publishes event-driven, microtask-coalesced Controller baselines from `ctx.sessions.list` and `ctx.workspaces.list`;
3. executes an explicit command allowlist through the official client Controller services, including latest-wins Session navigation.

The server entry point currently registers only `/remote-desktop-companion/api/health` as a transitional package-readiness probe. It does not inject Host Session/Workspace Controllers and does not expose snapshot or mutation routes. Runtime UI state and mutations use the authenticated iframe’s official Controller services.

## Workspace add flow

The client owns `WorkspaceAddSplitter`, registered into `conversation.hero.workspace` in both main-host and remote-iframe modes. The official-looking sidebar Add workspace button opens this splitter directly instead of first opening the official single-instance workspace picker or directory flow. Picker footer Add workspace entries route to the same splitter.

- Local branch: delegates to the official directory-flow slot for the current DSH instance, then creates a workspace through that instance's `ctx.workspaces.create`.
- Main-host remote branch: opens a local Remote setup modal, browses remote directories through `/remote-desktop/api/browse`, sends `workspace/create` through the source MessageChannel, receives the Controller state echo, creates or reuses a blank remote session, and opens the remote iframe.
- Remote-iframe remote branch: sends `dsh-remote-desktop/add-workspace-remote-request` to the parent with the child token and request id. The parent validates origin/token and opens the main-host Remote setup modal.

Remote workspace creation must not fall back to local workspace creation after remote errors.

## Settings flow

The local bundle keeps the official `ui-settings-general` shell. Remote Desktop extends it through the official `settings.section` slot with a `Remote Desktop` page that lists SSH hosts, shows connection state, and exposes Connect, Disconnect, and Open native DSH actions.

The native remote Settings URL is derived from the iframe URL by removing `?dshRemoteDesktop=1` and the token hash. Remote Settings are not embedded in the local modal and do not receive the iframe token.

## Fork and replacement inventory

This project uses “fork” narrowly: copied upstream source with a recorded baseline that must be rebased when upstream changes.

| Surface | Status | Upstream baseline | Why |
| --- | --- | --- | --- |
| `ui-workspace` browser/picker/tree/rows/store/locales | **Vendored fork** | `deepseek-harness` commit `4e84901e6471b79ec0338099867ebb4606d12bb5`, package `packages/client/ui-workspace`; recorded in `packages/local/upstream/ui-workspace/UPSTREAM.md` | The sidebar must look and behave like official DSH while accepting source-qualified remote rows, host markers, remote open routing, and host-forwarded remote workspace/session actions. |
| Remote Desktop settings section | **Official-slot extension, not a fork** | `settings.section` from `ui-settings-general` | The official Settings shell stays enabled; Remote Desktop contributes one settings page using official primitives and design tokens. |
| Workspace Add splitter | **Plugin-owned replacement/extension, not a source fork** | Uses official directory-flow slot and UI primitives | The first screen must split Local and Remote. Local delegates back to the official current-instance directory flow; Remote is plugin-owned. |
| Local server API, SSH tunnel/proxy, remote store, iframe overlay, companion bridge | **Custom dsh-remote-desktop code** | None | These implement remote host lifecycle and iframe control; they are not forks of DSH packages. |
| Companion sidebar-hiding CSS | **Custom compatibility shim** | None | It adapts the embedded remote app frame in iframe mode and must remain narrowly scoped. |

The only true source fork today is the `ui-workspace` fork. Settings is an official-slot extension. Add workspace is an intentional plugin-owned replacement/extension, but it does not carry a copied upstream source baseline.

## Maintenance rules

- Rebase the `ui-workspace` fork with the procedure in `packages/local/upstream/ui-workspace/UPSTREAM.md` whenever the upstream workspace browser changes.
- Keep `packages/local/upstream/ui-workspace/remote-desktop.patch` and `src/client/10-official-workspace.part.js` updated with the maintained delta.
- Edit client sources, then run `npm run build`; never hand-edit generated `lib/client.js` files.
- When touching iframe layout, sidebar behavior, Settings, or Add workspace, run `npm run check` and use the manual checklist in `scripts/acceptance/check-ui-manual.md` when visual behavior changes.
- Preserve origin and token validation for every parent/child iframe message.
- Do not expose the iframe source token in native remote Settings URLs.

## DSH 0.2 compatibility

The source-aware browser retains its recorded presentation baseline. Its navigation implementation now follows DSH 0.2.0-rc.2; see the additional baseline in `packages/local/upstream/ui-workspace/UPSTREAM.md`. Current Session selection follows `mainView` references, temporary renames retain/release their Session binding, and the presentation adapts `useSessionStatus`. Directory-flow declarations remain owned by Remote Desktop, so the stock workspace UI stays disabled.
