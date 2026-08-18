# Remote Desktop official-style sidebar fork design

## Goal

Rework `dsh-remote-desktop` so the local DSH web page has one official-style left session browser that can open local and remote sessions by clicking session rows. The browser is a long-term fork of the official `@deepseek-ai/dsh-client-ui-workspace` sidebar implementation, adapted through source adapters instead of a ground-up custom UI.

The remote iframe keeps rendering the remote DSH main chat and remote plugins such as `dsh-better-sidebar`. The remote DSH left sidebar is strongly hidden in iframe mode, so the local page remains the only session selector.

## Decisions

- The plugin continues to occupy the official `sidebar.workspaces` slot on the local page.
- The plugin does not change the official DSH sidebar extension model for this release.
- The local sidebar is a long-term fork of official `WorkspaceBrowser`, not a temporary copy.
- The fork keeps official row components, CSS modules, spacing, hover states, selected state, and design tokens where possible.
- Source-aware behavior lives in adapter and store modules; copied official UI files stay close to upstream.
- Source headers are grouping/status controls only. They do not activate local or remote views.
- Clicking a session row is the only sidebar gesture that opens a local session or activates a remote iframe.
- Remote write actions are disabled for the first source-aware release unless a remote capability explicitly supports them later.
- A light `ctx.remoteDesktop` client service is exposed for local plugins to observe active target changes and request session opens.

## Non-goals

- No full official DSH extension-point redesign.
- No same-page multi-context React tree for remote DSH.
- No remote plugin registration into the local sidebar.
- No remote drag ordering, remote workspace management, or remote session mutation in the first source-aware release.
- No DOM inspection or mutation inside remote iframes from the local page, except the remote companion hiding its own remote sidebar from inside the iframe.

## Component layout

```text
dsh-remote-desktop/
  packages/local/
    lib/
      index.js                     # host routes, SSH tunnel, source snapshots
      client.js                    # current bundled entry until TS split lands
      client/
        RemoteDesktopProvider.tsx  # service/store wiring
        RemoteFrameOverlay.tsx     # one iframe per connected remote source
        SettingsSection.tsx        # source CRUD/connect/disconnect
        sidebar/
          WorkspaceBrowser.tsx     # forked official browser entry
          WorkspaceBrowser.module.css
          rows/Rows.tsx            # official row components, minimal changes
          rows/Rows.module.css
          tree.ts                  # official derivation helpers, minimal changes
          stores.ts                # official local UI-state helpers, minimal changes
          locales.ts
          source-model.ts          # source-aware data model
          local-source-adapter.ts  # local sessions/workspaces to SourceView
          remote-source-adapter.ts # remote snapshot to SourceView
          capabilities.ts          # per-source action support
  packages/companion/
    lib/client.js                  # iframe guard, sidebar hide, open-session receiver
```

The current MVP keeps code in `packages/local/lib/client.js`; the sidebar rework may either introduce the split above immediately or stage it behind the same exported client entry. The design target is the split layout because it keeps the long-term fork maintainable.

## Source model

The sidebar renders `SourceView[]`.

```ts
type SourceId = 'local' | string

type SourceKind = 'local' | 'remote'

type SourceState = 'ready' | 'connecting' | 'connected' | 'disconnected' | 'error'

interface SourceView {
  id: SourceId
  kind: SourceKind
  label: string
  state: SourceState
  error?: string
  workspaces: SourceWorkspaceView[]
  looseSessions: SourceSessionView[]
  capabilities: SourceCapabilities
}

interface SourceWorkspaceView {
  workspaceId: string
  title: string
  path?: string
  sessionIds: string[]
}

interface SourceSessionView {
  sourceId: SourceId
  sessionId: string
  title: string
  cwd?: string
  createdAt?: number
  updatedAt?: number
  blank?: boolean
  running?: boolean
  completed?: boolean
  pendingInteraction?: 'approval' | 'plan-review' | 'question'
  runningSubagentCount?: number
}

interface SourceCapabilities {
  open: boolean
  search: 'host' | 'title-filter' | 'none'
  renameSession: boolean
  forkSession: boolean
  archiveSession: boolean
  createSession: boolean
  renameWorkspace: boolean
  deleteWorkspace: boolean
  reorderWorkspace: boolean
  reorderSession: boolean
}
```

The local adapter maps `ctx.sessions` and `ctx.workspaces` into this model with local capabilities enabled to match the official browser. The remote adapter maps `/remote-desktop/api/snapshot` into the same model with open enabled and mutation capabilities disabled.

## Active target model

```ts
type ActiveTarget =
  | { kind: 'local'; sessionId?: string }
  | { kind: 'remote'; sourceId: string; sessionId?: string }
```

Rules:

- Local session row click sets `{ kind: 'local', sessionId }`, calls `ctx.sessions.open(sessionId)`, and hides the remote overlay.
- Remote session row click sets `{ kind: 'remote', sourceId, sessionId }`, shows the matching iframe, and posts `open-session` to the remote companion.
- Source header click toggles only expansion if that control is present. It never changes `ActiveTarget`.
- Selected row styling compares both source id and session id.
- Selected source styling is derived from the selected row's source; it is not a switch state.
- If a remote source is deleted or disconnected while active, the service returns to `{ kind: 'local' }` and hides the remote overlay.

## Sidebar UI behavior

The sidebar keeps official layout behavior:

- wide and rail modes follow the official `sidebar.workspaces` owner prop.
- row heights, radii, hover fills, selected fills, text color, and animations use official CSS modules and DSH design tokens.
- scrollbars inherit the official sidebar scrollbar variables.
- search, grouping, flat list, ordering controls, hover cards, and local row menus retain official behavior for the local source.

Source rendering adds one grouping layer:

```text
Remote Desktop
  Search / view controls

Local                         ready
  Workspace A
    Local session 1
    Local session 2

Remote: win-wsl               connected
  Workspace X
    Remote session 1
    Remote session 2

Remote: gpu-box               error
  Could not refresh snapshot: ...
```

Source headers:

- show label and state.
- show error/disconnected rows when needed.
- may expand/collapse the source group.
- do not activate if clicked.

Rail mode:

- keeps official rail search/add controls where local capabilities apply.
- remote sources do not add extra rail-only controls in the first release.
- opening a row requires the expanded browser, matching official session-list behavior.

## Actions and capabilities

Local source actions keep official behavior:

- open session.
- search through the official session search service.
- create session in workspace.
- rename/fork/archive session.
- rename/delete workspace.
- drag reorder workspaces and local sessions.

Remote source actions in the first source-aware release:

- open remote session.
- title-filter search when host search is not implemented.
- show hover card with available title, cwd, and timestamps.
- hide mutation menus and drag affordances.
- show unavailable copy where an action would otherwise appear but cannot be performed.

Future remote capabilities can be added by extending the companion protocol, then enabling individual capability flags per source.

## `ctx.remoteDesktop` service

The local plugin provides a light client service.

```ts
interface RemoteDesktopService {
  getSnapshot(): RemoteDesktopSnapshot
  subscribe(listener: () => void): () => void
  listSources(): readonly RemoteSourceSummary[]
  getActive(): ActiveTarget
  openLocalSession(sessionId: string): void
  openRemoteSession(sourceId: string, sessionId: string): void
}
```

`RemoteDesktopSnapshot` contains active target, source summaries, source states, companion readiness, and the latest explicit error. The service does not expose a row-action registry or remote plugin bridge in this release.

The service is used internally by the forked sidebar and overlay. Other local plugins can use it to observe whether the visible page is local or remote and request a session open.

## Remote frame overlay

- Each connected remote source owns one iframe.
- Iframes stay mounted while connected so remote DSH and remote plugins keep their client state.
- Only the active remote source iframe is visible.
- The overlay is hidden when the active target is local.
- The overlay uses the measured local sidebar right edge as its left boundary.
- The local page sends only control messages: `open-session` and health probes.
- The local page does not inspect remote DOM or intercept remote plugin requests.

Remote routes stay origin-isolated. A remote plugin continues to see root-relative paths and WebSocket URLs on the iframe origin, and the local proxy forwards them through the SSH tunnel.

## Remote companion

The remote companion is installed on remote DSH profiles that should be controlled by the local page.

Responsibilities:

- detect remote iframe mode by marker and token in the fragment.
- validate parent origin and token for every message.
- send `ready` to the parent.
- receive `open-session` and call remote `ctx.sessions.open(sessionId)`.
- strongly hide the remote DSH left sidebar in iframe mode.
- avoid registering a remote-desktop local sidebar inside the iframe.

Strong hide means the remote official left sidebar column is removed from layout or made zero width from inside the remote frame. The remote main chat and remote right/bottom plugins remain visible.

If the full local package is accidentally installed on a remote profile, iframe-mode guards prevent it from registering `sidebar.workspaces`, `shell.overlay`, or local source-management UI inside the iframe.

## Error handling

- A remote source in `error` state shows the error under its source header.
- A snapshot failure shows a snapshot error row and keeps the previous successful list only if it is explicitly marked stale.
- A disconnected source stays visible and shows a disconnected row.
- A missing companion lets the iframe load but marks session-row open control as not ready until the companion reports ready.
- Deleting the active remote source returns to local active target.
- Source header clicks are harmless even for error/disconnected sources.
- Remote iframe failures show an overlay error and do not crash the local sidebar.

## Acceptance gates to add

### Static gates

- `npm run check` must include syntax checks for all plugin entry points and acceptance scripts.
- Add a fork drift check that compares copied official files against the pinned upstream source and reports files changed outside an allowlist. The initial allowlist should permit the source-aware browser entry and adapter files, while `Rows.module.css` and token-heavy CSS stay close to upstream.
- Add a no-inline-sidebar-style check for the new browser files. The source-aware sidebar should use CSS modules and design tokens, not ad-hoc inline row styles.
- Add a service API smoke test that imports the client service types or runtime entry and proves `ctx.remoteDesktop` is provided with the documented methods.

### Unit/component gates

- Source adapter tests:
  - local sessions/workspaces map to `SourceView` with local capabilities enabled.
  - remote snapshots map to `SourceView` with mutation capabilities disabled.
  - remote snapshot errors produce explicit error rows, not empty lists.
- Active target store tests:
  - local session open hides remote active state.
  - remote session open records source id and session id.
  - deleting/disconnecting active remote returns to local.
  - source header events do not change active target.
- Sidebar component tests:
  - selected row is keyed by source id plus session id.
  - source header is not rendered as an activation button.
  - remote rows hide unsupported menus and drag affordances.
  - local rows keep official actions when capabilities are enabled.

### P0 browser acceptance

- Start local DSH with the local plugin and remote `win-wsl` DSH with companion plus `dsh-better-sidebar`.
- Add/connect `win-wsl` source from settings or setup script.
- Verify local source header is visible and non-activating.
- Verify remote source header is visible and non-activating.
- Click a remote session row and assert:
  - active target is remote source/session.
  - remote iframe is visible.
  - companion opens the requested remote session.
  - selected row is the remote session row, not the source header.
- Click a local session row and assert:
  - active target is local session.
  - remote iframe is hidden.
  - selected row is the local session row.
- Repeat local/remote switching at least twice without stale overlay state.

### P1 browser acceptance

- UI parity checks:
  - sidebar row heights, hover class, selected class, and token usage match the official fork baseline within snapshot tolerance.
  - no inline MVP row styles are present in rendered source-aware rows.
- Search checks:
  - local search still finds local sessions through official search.
  - remote title-filter search finds remote sessions by title when host search is unavailable.
- Capability checks:
  - local row menu actions remain available.
  - remote row mutation menus and drag handles are absent or disabled.
- Error checks:
  - disconnected remote source renders a disconnected row.
  - snapshot failure renders an explicit error row.
  - missing companion produces a clear not-ready message after remote row click.

### P2 compatibility acceptance

- Better Sidebar remote compatibility:
  - remote iframe hides remote official left sidebar.
  - remote `dsh-better-sidebar` remains visible and usable.
  - remote explorer proves remote filesystem access with a sentinel file on `win-wsl`.
  - remote terminal proves remote execution with `hostname` or sentinel output from `win-wsl`.
- Multi-source checks:
  - two configured remote sources keep separate iframes and selected rows.
  - switching between remote sources does not reuse the wrong iframe or token.
- Service checks:
  - a small test plugin or injected browser script subscribes to `ctx.remoteDesktop` and observes active changes for local and remote opens.
  - calling `openRemoteSession(sourceId, sessionId)` through the service opens the expected iframe/session.

### Manual checklist

Manual checks are not required on every run, but should be documented for release validation:

- Compare local forked sidebar visually against official DSH sidebar in light and dark themes.
- Collapse and expand the left sidebar and verify rail behavior remains official-looking.
- Resize the window and verify the remote overlay boundary follows the local sidebar edge.
- Confirm remote better-sidebar right/bottom panel layout remains usable after the remote left sidebar is hidden.

## Rollout plan

1. Preserve the current host/proxy/iframe architecture.
2. Add source-aware store and `ctx.remoteDesktop` service.
3. Copy official WorkspaceBrowser files into the local package.
4. Wire local adapter first and prove local-only behavior matches official behavior.
5. Add remote adapter and session-row remote switching.
6. Add companion strong-hide guard and missing-companion status.
7. Replace existing inline MVP sidebar with the forked source-aware browser.
8. Add static, unit, and browser acceptance gates listed above.
9. Run `npm run check`, `npm run acceptance:p0`, `npm run acceptance:p1`, and `npm run acceptance:all` before manual validation.

## Spec self-review

- No placeholders remain.
- The design consistently treats source headers as grouping/status controls, not activation controls.
- Remote mutation actions are explicitly out of the first source-aware release even though the UI fork keeps local official actions.
- The local page remains the only session selector; the remote iframe hides its own left sidebar.
- Gate coverage includes static drift/style checks, unit/component checks, browser switching checks, remote plugin compatibility, and manual release checks.
