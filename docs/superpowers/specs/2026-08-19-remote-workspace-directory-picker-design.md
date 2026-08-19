# Remote Workspace Directory Picker Design

## Goal

Replace the manual remote path entry in the Remote Desktop Add remote workspace flow with an official-theme directory picker. The picker starts at the selected remote user's home directory, lets the user navigate folders through a breadcrumb path and folder rows, and creates the remote workspace at the currently selected directory.

## Scope

In scope:

- the main-host Remote workspace creation modal in `packages/local/lib/client.js`;
- the parent-mediated remote creation flow used from remote iframe mode;
- a local plugin API route for browsing directories on the selected SSH host;
- tests for the browse API, picker routing, and workspace creation path;
- architecture docs for the new browse path.

Out of scope:

- replacing the official local directory flow;
- editing files or creating folders on the remote host;
- browsing files; only directories are selectable;
- adding favorites, recents, or project detection;
- changing SSH tunnel or iframe token behavior.

## Chosen UX

Use the visual option A: breadcrumb plus folder list.

The Remote workspace modal keeps the host selector, then shows a directory picker using official DSH primitives and design tokens. It must not use emoji, white custom panels, or raw browser controls when a primitive exists.

Picker layout:

- header: current host selector;
- toolbar: breadcrumb segments, starting with `Home` for the remote home directory;
- right-side toolbar toggle: `Show hidden`;
- body: directory rows only, sorted with non-hidden names first and case-insensitive alphabetical order within each group;
- footer: `Cancel` and `Create workspace here`.

The user clicks a folder row to enter that directory. The user clicks any breadcrumb segment to jump back. The selected path is always the current directory shown by the picker. `Create workspace here` calls the existing remote `workspace.create` flow with that selected path.

Hidden directories are hidden by default. Enabling `Show hidden` includes names beginning with `.` except `.` and `..`.

## Server API

Add a read-only local route:

```text
GET /remote-desktop/api/browse?id=<sourceId>&path=<absolutePath?>&hidden=0|1
```

Response:

```ts
interface BrowseResponse {
  ok: true
  path: string
  home: string
  parent?: string
  entries: Array<{
    name: string
    path: string
    hidden: boolean
  }>
}
```

When `path` is omitted, the route resolves and returns the remote home directory. The route requires the source to be connected because it uses the SSH identity and host configuration for that source.

The implementation should execute a small remote script through `ssh` rather than through the remote DSH host API. The host API proxies DSH workspace/session RPCs; directory browsing is an SSH filesystem concern and should not require adding a companion DSH RPC. The remote command must receive the requested path and hidden flag as arguments or stdin data with safe quoting. It must not concatenate raw user input into a shell command.

The remote script returns JSON with the canonical current directory, canonical home directory, optional parent, and child directory entries. It lists directories only. It should use portable POSIX shell plus Node.js only if Node is already required by the remote DSH profile; otherwise prefer POSIX commands that are available on typical SSH hosts. The implementation must handle spaces, quotes, and non-ASCII path segments.

## Client state and data flow

`RemoteSetupModal` gains browse state:

```ts
interface RemoteBrowseState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  hostId: string
  path?: string
  home?: string
  parent?: string
  entries: DirectoryEntry[]
  showHidden: boolean
  error?: string
}
```

Flow:

1. User chooses Remote workspace from `WorkspaceAddSplitter`.
2. The modal picks the first connected host or the user's selected host.
3. The picker calls `/remote-desktop/api/browse?id=<host>` with no path to load remote home.
4. Clicking a directory row calls browse with that row's path.
5. Clicking a breadcrumb segment calls browse with that segment's path.
6. Toggling `Show hidden` reloads the current path with the new hidden flag.
7. Clicking `Create workspace here` calls existing `remoteRpc(sourceId, 'workspace.create', { path })`, refreshes that host snapshot, opens or creates a remote session, and closes the modal.

Changing the selected host resets the picker to that host's home. If browsing fails, the modal keeps the last successful directory selected and shows an inline error with a Retry action.

## Breadcrumb rules

The breadcrumb should display the current path relative to home when the current path is inside home:

```text
Home / SAPDevelop / dsh-remote-desktop
```

If the current path is outside home, the breadcrumb should start from root:

```text
/ / tmp / project
```

Each segment has the absolute path needed to browse to that segment. The root segment for POSIX hosts is `/`. Duplicate separators are collapsed for display only; the selected path sent to `workspace.create` is the canonical path returned by the browse API.

## Error handling

- No connected hosts: show the existing “Connect a host” guidance and disable browsing and Add.
- Browse permission denied: keep the current directory and show `Cannot read this directory` with the remote error text when available.
- Path no longer exists: show `Directory not found` and allow going Home.
- Empty directory: show an empty state; `Create workspace here` stays enabled.
- Browse timeout or SSH failure: show Retry and keep the modal open.
- Workspace creation failure: show the existing creation error in the modal and do not fall back to local workspace creation.

## Security and safety

The browse route is read-only and returns directories only. It must validate the source id and require a connected source. It must not expose the iframe token. It must not accept arbitrary command fragments. Remote command construction must preserve path bytes safely enough for spaces, quotes, shell metacharacters, and Unicode names.

The route may browse any directory the SSH user can read. This matches the user's SSH authority and is necessary for selecting projects outside home. The UI starts at home to keep the common path fast.

## Tests

Add focused tests for:

- default browse request resolves remote home;
- hidden directories are excluded by default and included when `hidden=1`;
- browse returns directories only;
- unsafe path strings are passed as data, not interpolated into a shell command;
- client modal opens browse UI instead of requiring manual path typing;
- host changes reset browsing to the new host's home;
- breadcrumb and folder row handlers call browse with the expected path;
- `Create workspace here` uses the selected browse path in remote `workspace.create`;
- UI uses primitives and official design tokens rather than temporary raw controls.

Run `npm run check`. Because this changes an interactive modal, manually validate the flow with the UI checklist in `scripts/acceptance/check-ui-manual.md` when a connected remote host is available.

## Rollout notes

`packages/local/lib/client.js` is a hand-bundled browser file. After implementation, a running DSH web page must be refreshed; if the old bundle remains loaded, restart the local DSH web process. The remote companion is not expected to change for this feature.
