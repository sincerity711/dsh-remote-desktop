# Workspace Add splitter design

## Summary

`dsh-remote-desktop` will replace the current one-step Add workspace dialog with a ChatGPT-style splitter that is available from the main host and every remote iframe. The first screen always asks whether the user wants to add a Local workspace or a Remote workspace. Local returns to the official DSH workspace add path for the current app instance. Remote uses a `dsh-remote-desktop` owned UI and main-host routing to create or open a workspace on a selected connected remote host.

The splitter is a plugin-owned experience. It must not require `deepseek-harness` source changes in the first implementation, and it must use official DSH UI primitives and design tokens rather than hand-rolled chrome.

## Goals

- Show the same Local / Remote first screen whenever the user clicks Add workspace, including inside a remote iframe.
- Keep Local behavior on the official DSH path: native or in-app directory picking, workspace adoption, and local error handling remain owned by upstream `ui-workspace` for the current DSH instance.
- Give Remote its own purpose-built UI for host selection and remote workspace setup.
- Avoid nested remote management inside remote iframes; remote iframe Remote actions delegate to the main host.
- Preserve existing iframe origin/token validation and per-host isolation.
- Match official DSH design language, including primitives, tokens, spacing, hover states, and modal behavior.

## Non-goals

- Do not redesign the whole workspace picker or sidebar.
- Do not add a full remote file browser in the first version.
- Do not make disconnected remote hosts editable from the splitter.
- Do not iframe a second DSH app inside the active remote iframe.
- Do not change upstream `deepseek-harness` unless a future plan explicitly approves a formal extension seam.

## Current state

`dsh-remote-desktop` currently shadows `conversation.hero.workspace` with a remote-aware picker. That picker lists local workspaces and connected remote workspaces, then opens a simple Add workspace dialog containing a Host select and a path input. Local creation calls `ctx.workspaces.create`. Remote creation calls the main-host proxy at `/remote-desktop/api/host-api` and then opens or creates a blank remote session.

This works as an entry point, but the UI does not match the official DSH design and it does not clearly distinguish the official Local path from the plugin-owned Remote path. The current behavior is also main-host oriented; remote iframes skip the whole remote desktop client because the plugin returns early when `dshRemoteDesktop=1` is present.

Upstream `ui-workspace` already has a directory-flow seam. That seam can drive directory selection for the current DSH instance, but it does not choose a remote host and does not adopt a path on another host. The splitter therefore uses that seam only for Local.

## Architecture

The feature has three cooperating parts:

1. `WorkspaceAddSplitter`: a plugin-owned first screen registered into the workspace picker surface. It presents Local and Remote choices and owns only the branch decision.
2. `LocalAddBridge`: a thin adapter that invokes the official current-instance add path. On the main host this means a local workspace on the main machine. Inside a remote iframe this means a local workspace on that remote machine.
3. `RemoteWorkspaceSetup`: a plugin-owned flow for selecting a remote host, entering a remote path, creating or resolving the workspace on the target host, and opening a blank remote session.

The main host owns remote host discovery, SSH tunnel lifecycle, `/remote-desktop/api/host-api`, remote snapshots, and iframe activation. Remote iframes can render the splitter, but remote Remote branch actions are delegated to the main host through a parent message protocol.

## Runtime placement

`dsh-remote-desktop` should no longer treat `?dshRemoteDesktop=1` as a global client no-op. Instead, the client applies in two modes:

- Main-host mode: sidebar, overlay, settings shell, host filter, host APIs, and splitter are enabled.
- Remote-iframe mode: sidebar replacement, overlay, settings shell, and host management are disabled; the splitter and parent bridge client are enabled.

This split keeps the embedded app lightweight while giving every Add workspace entry the same first screen.

## Splitter UX

The first screen is a single splitter page inside the official Workspace picker surface, using the same modal/popover chrome as that surface. It contains two primary choices:

- Local workspace: add a workspace on this DSH instance.
- Remote workspace: add a workspace on another connected host.

The copy must make “local” relative to the current DSH instance. In the main host, Local means the user's main machine. In a remote iframe, Local means the remote machine that iframe is showing.

If the user cancels the splitter, no workspace is created and the workspace chip returns to its previous state.

## Local branch

Local branch must hand control back to official DSH workspace add behavior.

Required behavior:

- Use the existing directory-flow path rather than a `dsh-remote-desktop` path textbox.
- Let upstream `ui-workspace` own directory picker errors, workspace adoption, and `onPick(workspaceId)`.
- Keep local creation scoped to the DSH instance where the user clicked Add workspace.
- Preserve existing native and in-app browse picker compositions.

Implementation can achieve this by rendering or invoking the official picker core for Local, or by composing a small local-only entry that uses the official directory-flow owner contract. The spec requires the behavior, not a specific internal function call, because the current upstream seam may require adapter work.

## Remote branch on the main host

The main-host Remote branch is owned by `dsh-remote-desktop`.

The first version includes:

- Host list from the main host's SSH config discovery.
- Connected/not connected status.
- Connected hosts as selectable targets.
- Disconnected hosts shown with a disabled state and a Settings connection hint.
- Remote absolute path input.
- Submit, cancel, busy, and error states.

Submit flow:

```text
selected host + remote path
  -> /remote-desktop/api/host-api?id=<host>&path=/api/workspace.create
  -> refresh target host snapshot
  -> reuse existing blank session for that remote workspace, or call session.create on the target host
  -> open the target remote iframe/session from the main host
```

Remote workspace creation must never fall back to local `workspace.create` after a remote error.

## Remote branch inside a remote iframe

A remote iframe still shows the same splitter. The Local branch stays inside that iframe and uses the official current-instance path.

The Remote branch does not start SSH management from inside the iframe. It sends a parent message to the main host requesting the Remote workspace setup flow.

Message requirements:

- The child includes its source token and a request id.
- The parent verifies iframe origin and token against the known connected source before accepting the message.
- The parent opens the main-host Remote setup UI.
- The parent returns a success, cancel, or error result to the child.
- The child closes its local splitter after delegation succeeds or shows a scoped error if delegation fails.

This avoids nested remote management and keeps one authority for SSH hosts.

## Parent bridge protocol

The protocol is intentionally small:

```text
child -> parent: dsh-remote-desktop/add-workspace-remote-request
parent -> child: dsh-remote-desktop/add-workspace-remote-result
```

Request fields:

- `token`: source token assigned to the iframe.
- `requestId`: opaque child-generated id.
- `originSourceId`: optional source id for diagnostics only; parent trusts token/origin, not this field.

Result fields:

- `requestId`.
- `status`: `opened`, `cancelled`, or `error`.
- `message`: present only for `error`.

The request asks the parent to open the setup UI; it does not carry a path or target host. Host and path are entered in the parent-owned UI so secrets and remote host state stay on the main host.

## Official UI design requirements

All new splitter and remote setup UI must use official DSH UI primitives and tokens.

Required:

- Use `@deepseek-ai/dsh-client-ui-primitives` for Button, Menu, Modal, icons, and comparable controls where available.
- Use existing design tokens for colors, borders, background, shadows, typography, radius, spacing, hover, focus, and disabled states.
- Match the visual density and motion of the official Settings modal and Workspace picker.
- Use official icons instead of emoji.
- Keep CSS to layout and composition glue; visual constants should come from tokens.
- Keep accessible labels and keyboard behavior consistent with official Modal/Menu components.

Forbidden:

- Bare browser `<select>` controls for primary UI.
- Emoji as icons.
- Hard-coded white backgrounds, raw black text, raw borders, or ad hoc shadows.
- Inline style blocks for permanent component visuals except for calculated placement values.
- A second visual language inside the DSH app.

## Error handling

- Local branch errors are handled by the official local workspace flow.
- Remote branch path errors remain in the remote setup UI.
- Disconnected hosts cannot submit remote workspace creation.
- If a connected host disconnects during setup, the submit fails with a scoped error and no local workspace is created.
- If iframe delegation fails origin or token validation, the parent ignores the request and the child times out into a scoped error.
- If the parent setup is cancelled, the child returns to its previous workspace state.
- If remote workspace creation succeeds but remote blank session creation fails, the UI reports the session failure and refreshes snapshots so the created workspace is visible on the next open.

## Data flow

Main-host Local:

```text
Add workspace -> splitter -> Local -> official directory flow -> local workspace.create -> onPick(local workspace)
```

Remote-iframe Local:

```text
Add workspace inside iframe -> splitter -> Local -> iframe official directory flow -> iframe workspace.create -> iframe onPick(local workspace)
```

Main-host Remote:

```text
Add workspace -> splitter -> Remote setup -> host-api workspace.create -> host-api session.create/reuse -> main host opens remote iframe session
```

Remote-iframe Remote:

```text
Add workspace inside iframe -> splitter -> Remote -> parent bridge request -> main-host Remote setup -> host-api create/open -> parent result
```

## Acceptance gates

### G0: static and unit gate

Run for every implementation change.

- `npm run check` in `dsh-remote-desktop`.
- Unit/static checks prove the splitter is registered in main-host mode and remote-iframe mode.
- Unit/static checks prove remote-iframe mode disables sidebar, overlay, and settings shell registration.
- Unit/static checks prove Local branch still uses the official local directory-flow/adoption path.
- Unit/static checks prove Remote branch uses the host API proxy for `workspace.create` and `session.create`.
- Static checks reject emoji icons, hard-coded white backgrounds, and permanent inline visual styles in the splitter components.

### G1: main-host acceptance

Run after changing splitter, workspace picker, or remote setup behavior.

- Main host Add workspace opens the Local / Remote first screen.
- Local opens the official workspace add path.
- Remote lists SSH config hosts with connected/not connected state.
- Connected remote host plus path creates or resolves a remote workspace.
- Created remote workspace opens a blank remote session in the remote iframe.
- Remote failure does not create a local workspace.

### G2: remote-iframe acceptance

Run before release and after parent bridge changes.

- Inside a remote iframe, Add workspace opens the same Local / Remote first screen.
- Iframe Local stays inside that iframe and uses that remote DSH instance's official path.
- Iframe Remote sends a validated parent request and opens the main-host Remote setup UI.
- Parent rejects wrong-token or wrong-origin requests.
- Cancelling parent setup leaves the iframe workspace state unchanged.

### G3: visual gate

Run when splitter or remote setup UI changes.

- Compare splitter and remote setup against official Settings and Workspace picker surfaces.
- Verify primitives and tokens are used for buttons, modal chrome, focus, hover, disabled, and error states.
- Verify no emoji icons, raw browser select UI, hard-coded white panels, or mismatched shadows remain.
- Verify the first screen feels identical from the main host and from a remote iframe.

## Specs and docs to update

- Update `docs/superpowers/specs/2026-08-18-host-filter-project-sidebar-design.md` to point to this spec for Add workspace behavior.
- Update `docs/acceptance.md` with main-host and remote-iframe Add workspace acceptance.
- Update `scripts/acceptance/e2e-win-wsl.mjs` for main-host Local / Remote first screen checks.
- Update `scripts/acceptance/p1-p2-win-wsl.mjs` for remote-iframe splitter and parent bridge checks.
- Update `scripts/acceptance/check-ui-manual.md` with the visual token/primitives checklist.
- Update `README.md` to describe Local vs Remote Add workspace behavior.
- Update `packages/local/README.md` to document main-host mode and remote-iframe splitter mode.

## Tests to add or update

- `packages/local/tests/workspace-picker.spec.mjs`
  - Splitter registration in main-host mode.
  - Splitter registration in remote-iframe mode.
  - Local branch keeps the official local add path.
  - Remote branch routes workspace/session creation through the host API proxy.
  - Remote-iframe mode does not register sidebar, overlay, or settings shell.
- `packages/local/tests/parent-bridge.spec.mjs`
  - Child request includes token and request id.
  - Parent validates token and origin before opening setup.
  - Parent result correlates by request id.
  - Invalid requests are ignored or rejected without opening setup.
- Static style test or check-static rules
  - No emoji icons in splitter/setup labels.
  - No hard-coded permanent panel colors or shadows.
  - No raw `<select>` for host picking.

## Implementation stages

### Stage 1: component split and visual cleanup

- Extract splitter, Local branch adapter, Remote setup UI, and parent bridge modules out of the large client file when practical.
- Replace temporary inline-style and emoji UI with official primitives and token-backed CSS.
- Keep current main-host remote creation behavior while moving it behind the Remote branch.

### Stage 2: official Local branch restoration

- Wire Local to the official directory-flow/adoption path for the current DSH instance.
- Remove plugin-owned local path input behavior.
- Prove main-host Local and remote-iframe Local both stay scoped to their current DSH instance.

### Stage 3: remote-iframe splitter mode

- Allow the client to run splitter-only mode under `?dshRemoteDesktop=1`.
- Keep sidebar, overlay, settings shell, and host management disabled in iframe mode.
- Add child-to-parent Remote branch delegation.

### Stage 4: acceptance and docs

- Update automated acceptance for main-host and iframe flows.
- Update manual visual checklist.
- Update README and package docs.

## Open decisions

- Remote directory browsing is deferred. First version uses a remote absolute path input.
- Disconnected hosts are visible but disabled in the Remote setup UI.
- The parent-owned Remote setup UI is the only place that manages SSH remote targets.
- Local means current DSH instance, not always the physical main host.
