# Host filter settings and project-first sidebar design

## Summary

`dsh-remote-desktop` will stop grouping the left sidebar by remote source. The sidebar will show projects/workspaces as the primary list, with a small host badge on remote projects. Settings will gain a Codex-style global Host filter so the same settings surface can switch between local settings and a connected remote host's settings. Remote hosts are discovered from `~/.ssh/config` on the main host.

This design intentionally separates the work into two stages: first the project-first sidebar and SSH host discovery in `dsh-remote-desktop`, then a `dsh-remote-desktop`-owned Settings shell fork that is kept in sync with upstream by rebase.

## Goals

- Show local and remote workspaces in one project-first sidebar instead of source-grouped sections.
- Keep same-name projects as separate rows; do not merge by name or path.
- Avoid host-based special sorting; preserve each source's natural order in the flattened projection.
- Discover candidate remote hosts from `~/.ssh/config` `Host` entries.
- Add a global settings Host filter that switches settings between local and connected remote hosts.
- Keep the Remote Desktop settings page simple and main-host-only.
- Provide a top-level Add workspace entry that can create/select a workspace on either the local host or a connected remote host.
- Preserve iframe isolation, per-host tokens, per-host proxy origins, and remote companion validation.

## Non-goals

- Do not build a full SSH config editor.
- Do not merge duplicate projects across hosts.
- Do not proxy settings through an embedded remote settings iframe.
- Do not make disconnected remote settings editable.
- Do not require every settings section to become host-aware in the first sidebar-only stage.

## Current state

`packages/local/lib/client.js` owns a full replacement for `sidebar.workspaces`. It currently projects the list as source sections: `Local`, then `Remote: <label>` for each source. Remote sessions open through `store.openRemote(sourceId, sessionId)`, which activates the per-source iframe overlay. Settings are contributed as one `settings.section` named `Remote Desktop`, with manual source fields and connect/disconnect/delete actions.

`packages/local/lib/index.js` persists manually entered sources in `sources.json`, opens SSH tunnels from those fields, creates a local per-source proxy, exposes source status through `/remote-desktop/api/sources`, and snapshots remote workspaces through the remote DSH API.

The upstream settings shell in `deepseek-harness` owns the modal chrome and renders registered `settings.section` entries. It does not currently expose a global Host filter or host-scoped settings context.

## Architecture

Remote Desktop becomes a host/source layer under two product surfaces:

1. Sidebar projection: local and remote workspace rows are flattened into one project-first tree. Remote rows carry host metadata as a badge, not as a grouping parent.
2. Settings host context: the settings shell owns a global selected host. Local context uses the local settings API; remote context routes settings API calls through the connected remote host proxy.

The existing runtime concepts remain: host id, SSH tunnel, local proxy origin, iframe URL, source token, remote snapshot, active remote session, companion ready state, and overlay iframe registry.

## Sidebar design

The sidebar list will be projected as workspace rows:

- Local workspace rows come from the existing local workspaces/session stores.
- Remote workspace rows come from snapshots of connected hosts.
- Remote workspace rows display a host badge such as `win-wsl` or `xsn` and a connected status dot.
- Local rows do not need a visible `local` badge in the default design.
- Workspace rows keep their own sessions underneath.
- Clicking a local session calls `ctx.sessions.open(sessionId)`.
- Clicking a remote session calls `store.openRemote(hostId, sessionId)`.

Same-name workspaces remain separate rows. The projection must not coalesce rows by title, path, or workspace id. The projection also must not group rows under host headers.

Ordering is intentionally simple: the flattened projection appends rows in the order each source already exposes them. The implementation may keep local rows before remote rows for continuity with the existing local-first projection, but it must not sort by host label or try to cluster rows by host.

## SSH host discovery

The main host reads `~/.ssh/config` and exposes candidate hosts through a Remote Desktop API.

Parsing rules:

- Include concrete `Host` aliases.
- Exclude wildcard or pattern aliases containing `*` or `?`.
- Preserve the alias as the host id and display label.
- Let `ssh <alias>` resolve `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump`, and other SSH behavior.
- Keep a default remote DSH endpoint of `127.0.0.1:30800` unless an override exists.

The API should expose enough resolved display data for Settings, but connection should prefer invoking `ssh <alias>` instead of reconstructing every SSH option itself. This keeps plugin behavior aligned with the user's SSH profile.

## Connection model

A host has these user-visible states:

- `connected`: SSH tunnel is active, remote DSH API responds, and the remote companion can respond from the iframe.
- `not connected`: no active connection, connection failed, remote DSH is down, or the companion did not respond.

Detailed failure text may be available in an expanded row, but list-level copy should stay simple. The host filter and Remote Desktop settings page should show only connected/not connected as their primary status.

Connection flow:

1. User clicks Connect for an SSH host.
2. The local plugin starts `ssh -N -L 127.0.0.1:<localPort>:127.0.0.1:<remoteDshPort> <alias>`.
3. The plugin waits for TCP readiness and verifies remote DSH with an API call.
4. The plugin starts or reuses a per-host local proxy origin.
5. The plugin creates an iframe URL with a per-host source token.
6. The companion readiness message marks the host fully connected.

Disconnecting a host kills its SSH process, closes its proxy server, removes active remote state for that host, and hides any active remote overlay.

## Workspace add flow

The upstream Workspace picker exposes a directory-flow child hole for choosing a local directory, but the owner component also owns workspace adoption through `ctx.workspaces.create`. That seam can replace the directory chooser, but it cannot by itself select a remote host or adopt the picked path on a remote DSH instance.

`dsh-remote-desktop` therefore shadows `conversation.hero.workspace` with a remote-aware picker while keeping the implementation inside the plugin. The picker lists local workspaces and connected remote workspaces in one menu. Selecting a local workspace delegates to the owner's `onPick(workspaceId)`. Selecting a remote workspace opens or creates a blank remote session for that workspace and activates the remote iframe overlay.

The picker has one Add workspace entry. It asks for Host and directory path. Local submits call `ctx.workspaces.create({ path })` and then `onPick(created.workspaceId)`. Remote submits call the connected host through `/remote-desktop/api/host-api` with `workspace.create`, refresh the host snapshot, then open or create a blank remote session through `session.create`. Disconnected hosts are not offered as remote creation targets; the Settings page remains the connection entry.

This is intentionally a small first implementation. It does not copy the upstream in-app directory browser for remote hosts. A later stage can add a remote directory browsing flow by adding host-aware browse/list/create directory APIs, but it should keep adoption on the selected host rather than routing local `workspace.create`.

## Settings Host filter

The `dsh-remote-desktop` copied Settings shell renders a global Host filter in the settings header, matching the Codex reference behavior.

Host filter entries:

- `All settings` or the local host entry for local settings.
- One entry per SSH host discovered by Remote Desktop.
- Each remote entry shows connected/not connected status with a small status dot.

Selection behavior:

- Local selection renders local settings using the existing local settings API.
- Connected remote selection renders settings for that remote host.
- Not-connected remote selection renders a connection prompt and does not render remote settings sections.
- The selected host is viewing state in the settings shell; it should not mutate settings by itself.

The Host filter is a global settings context, not a control inside the Remote Desktop page.

## Host-scoped settings rendering

Host-scoped settings should reuse the existing settings components rather than iframe a remote app.

Local context:

```text
settings component -> local host API -> local ctx.settings
```

Remote context:

```text
settings component -> host-aware settings client -> dsh-remote-desktop proxy -> remote DSH settings API -> remote ctx.settings
```

This is implemented as a Settings shell fork in `dsh-remote-desktop`:

- `dsh-remote-desktop` disables `ui-settings-general` in its patch.
- The copied shell owns the Host filter and active host viewing state.
- The copied shell declares and renders `settings.section` contributions.
- A fetch routing shim sends `/api/*` calls through the selected connected host's proxy while a remote host is selected.
- A not-connected placeholder is shown for disconnected selected hosts.

The implementation avoids DOM patching the settings modal; the fork is an explicit plugin-level replacement that must be rebased when upstream Settings shell behavior changes.

## Remote Desktop settings page

The Remote Desktop settings page is visible only on the main/local host. It manages connection availability, not remote settings values.

The page shows hosts discovered from `~/.ssh/config`:

- Host alias.
- Optional resolved display details, such as user, hostname, and port when available.
- Connected/not connected status.
- Connect and Disconnect actions.
- Optional remote DSH port override.
- Optional expanded failure details.

The page should not be shown when the global Host filter is set to a remote host. Remote hosts should not manage their own nested Remote Desktop host list from inside the host-scoped settings view.

## Data flow

Host discovery:

```text
~/.ssh/config
  -> dsh-remote-desktop backend parser
  -> /remote-desktop/api/hosts
  -> Remote Desktop settings page and settings Host filter
```

Connection:

```text
Connect(host alias)
  -> /remote-desktop/api/connect
  -> ssh tunnel
  -> remote DSH API check
  -> per-host proxy origin and iframe URL
  -> companion ready/opened messages
```

Sidebar:

```text
local workspaces/sessions + remote connected snapshots
  -> flat workspace rows
  -> remote rows get host badge
  -> session click opens local session or remote iframe
```

Remote settings:

```text
Host filter selects remote host
  -> settings shell active host changes
  -> settings client routes calls through remote-desktop proxy
  -> remote settings API returns remote values
  -> existing settings components render remote values
```

## Error handling

- A disconnected remote host should not contribute workspace rows to the sidebar in the first implementation. This avoids stale remote project rows.
- If a remote disconnects while active, the overlay is hidden and active state returns to local.
- If a selected settings host is not connected, settings content shows a connection prompt and a Connect action.
- If remote DSH is reachable but the companion is missing or silent, the host remains not connected with a concise companion error.
- SSH stderr and detailed proxy errors may be shown in expandable details, not as the primary row label.
- Add workspace failures stay on the Add workspace dialog and must not silently create a local workspace when a remote host was selected.
- Remote settings update failures stay scoped to the selected remote host and must not fall back to local writes.

## Gate levels

### G0: static and unit gate

Run for every implementation change.

- `npm run check` in `dsh-remote-desktop`.
- Static checks assert the sidebar no longer renders `Remote: <host>` source headers.
- Static checks assert remote workspace rows carry host badge data attributes.
- Static or unit checks cover SSH config parsing, including wildcard exclusion.
- Static checks assert the companion origin/token validation remains present.
- Because this route does not modify `deepseek-harness`, Settings shell coverage lives in `dsh-remote-desktop` static, unit, and acceptance checks.

### G1: sidebar and single-host acceptance

Run after sidebar, connection, overlay, or single-host settings-host changes.

- Update and run P0 acceptance for one remote host.
- Verify a remote project appears as a project row with a host badge, not under a `Remote: <host>` group.
- Verify clicking a remote session still opens the remote iframe overlay.
- Verify local to remote to local switching still hides and restores the overlay correctly.
- Verify Remote Desktop settings lists SSH config hosts and marks the connected host as connected.
- Verify Add workspace can target the connected remote host and opens a blank remote session for the created workspace.

### G2: multi-host and host-filter acceptance

Run before release and after host-filter/settings routing changes.

- Update and run P1/P2 acceptance for two remote hosts.
- Verify two connected remotes use separate proxy origins and tokens.
- Verify same-name projects from different hosts are not merged.
- Verify projects are not grouped by host.
- Verify the settings Host filter lists local, `win-wsl`, and `xsn` with status dots.
- Verify selecting a connected remote host renders that host's settings values.
- Verify selecting a not-connected host renders the not-connected placeholder and does not render local settings as a fallback.
- Verify the workspace picker lists connected remote workspaces with host labels and does not list disconnected hosts as Add workspace targets.

### G3: manual visual gate

Run when layout, sidebar visual styling, settings chrome, or Host filter UI changes.

- Use `scripts/acceptance/check-ui-manual.md` after updating it for project-first rows and Host filter behavior.
- Check host badge readability in the sidebar.
- Check that the Host filter looks and behaves like the Codex reference.
- Check that remote and local settings context changes are visually obvious.
- Check that settings does not look like an iframe nested inside another settings modal.

## Existing specs and docs to update

Update these `dsh-remote-desktop` files as part of implementation:

- `docs/acceptance.md`
  - Replace source-grouped sidebar expectations with project-first rows and host badges.
  - Add Host filter requirements to P1/P2.
  - Add same-name-project non-merge acceptance.
  - Add SSH-config host discovery expectations.
- `scripts/acceptance/e2e-win-wsl.mjs`
  - Change P0 selectors from `Remote: <host>` source sections to remote workspace rows with host badges.
  - Keep iframe, companion, Better Sidebar, and local-return checks.
- `scripts/acceptance/p1-p2-win-wsl.mjs`
  - Add two-host Host filter checks.
  - Add same-name-project non-merge checks.
  - Add disconnected-host settings placeholder checks.
- `scripts/acceptance/check-ui-manual.md`
  - Add checks for remote host badges on project rows.
  - Add checks for the global settings Host filter.
  - Remove or revise checks that assume a visible `Remote: <host>` source header.
- `scripts/check-static.mjs`
  - Remove assertions that depend on source headers.
  - Add assertions for remote workspace badge attributes and the absence of `Remote: ${host}` group labels.
- `README.md`
  - Explain that hosts are discovered from `~/.ssh/config`.
  - Explain that the sidebar is project-first and remote projects carry host badges.
- `docs/remote-server-setup.md`
  - Keep the remote DSH setup instructions.
  - Add that local connection uses SSH config host aliases.
- `packages/local/README.md`
  - Describe the local plugin as a host-discovery, proxy, sidebar badge, and settings-host provider.
- `packages/companion/README.md`
  - Clarify that the companion still validates parent origin/token for iframe session open.

The upstream `deepseek-harness` Settings shell remains the source copied by `dsh-remote-desktop`; no `deepseek-harness` source docs are changed by this route.

## New specs and tests to add

Add these `dsh-remote-desktop` specs/tests:

- `packages/local/tests/ssh-config.spec.mjs`
  - Parses simple `Host win-wsl` entries.
  - Excludes wildcard entries such as `Host *` and `Host dev-*`.
  - Preserves alias labels.
  - Does not require reconstructing every SSH option for connection.
- `packages/local/tests/sidebar-projection.spec.mjs`
  - Produces flat workspace rows from local and remote snapshots.
  - Keeps same-name remote/local workspaces as separate rows.
  - Does not create source-group header rows.
  - Adds remote host badge metadata to remote workspace rows.
- `packages/local/tests/settings-hosts.spec.mjs`
  - Lists SSH config hosts.
  - Shows connected and not-connected statuses.
  - Hides the Remote Desktop management page in remote host settings context.
- `packages/local/tests/remote-settings-proxy.spec.mjs`
  - Routes settings describe/read/update calls to the selected connected host.
  - Does not fall back to local settings on remote errors.
  - Preserves per-host origin/token isolation.
- `packages/local/tests/workspace-picker.spec.mjs`
  - Registers a remote-aware `conversation.hero.workspace` picker.
  - Keeps local workspace creation on the local workspace service.
  - Routes remote workspace creation and blank-session creation through the selected connected host.

Do not add `deepseek-harness` tests for this plugin-owned route; `dsh-remote-desktop` acceptance owns the copied shell behavior.

Update acceptance scripts rather than adding a parallel acceptance suite. P0 remains the single-host gate, and P1/P2 remains the multi-host/settings gate.

## Implementation stages

### Stage 1: project-first sidebar and SSH host discovery

Primary repo: `dsh-remote-desktop`.

- Add SSH config parsing and host listing API.
- Connect by SSH alias while preserving existing tunnel/proxy/runtime behavior.
- Replace source-section sidebar projection with flat workspace rows and remote host badges.
- Simplify Remote Desktop settings to list SSH config hosts and connection status.
- Update P0 acceptance and static checks for the new sidebar.

Stage 1 proves the main UX change: remote workspaces are projects with host badges, not source-machine groups.

### Stage 1.5: remote-aware workspace picker

Repo: `dsh-remote-desktop`.

- Shadow `conversation.hero.workspace` with a plugin-owned picker.
- List local workspaces and connected remote workspaces in one menu.
- Add a Host + path Add workspace dialog.
- Route remote `workspace.create` and `session.create` through the host API proxy.
- Keep disconnected hosts out of the creation target list.

Stage 1.5 restores a user entry for creating remote workspaces after the sidebar stopped using source-machine grouping.

### Stage 2: copied settings shell and host-scoped routing

Repo: `dsh-remote-desktop`.

- Disable upstream `ui-settings-general` in the plugin patch.
- Register a copied Settings shell that declares and renders `settings.section` entries.
- Render the global Host filter inside the copied shell header.
- Route `/api/*` settings-page calls through `/remote-desktop/api/host-api` for the selected connected remote host.
- Hide the Remote Desktop management list for remote settings contexts and show a remote-host placeholder/connect action.
- Update P1/P2 acceptance for multi-host settings behavior.

Stage 2 delivers the Codex-style settings behavior without modifying `deepseek-harness`; the copied shell is a deliberate fork that must be rebased over upstream Settings shell changes.

## Open decisions resolved

- Same-name workspaces are not merged.
- Sidebar is not grouped by source machine.
- Settings uses the global Host filter approach in a `dsh-remote-desktop`-owned copied Settings shell, not an internal Remote Desktop page selector.
- SSH host discovery reads `~/.ssh/config` directly.
- Remote Desktop management is main-host-only and simple.
