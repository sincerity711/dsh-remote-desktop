# dsh-remote-desktop acceptance standard

This document defines the acceptance standard for `dsh-remote-desktop`. The goal is to prevent ad-hoc verification that proves only transport reachability while missing the user-facing switching, iframe isolation, and remote-plugin behavior.

## Acceptance levels

### P0: required after every implementation change

P0 is the hard gate for the first release. The recommended local run uses Apple container `remote-a`; the external-host run uses `win-wsl`. Both cover the complete user path:

1. Prepare isolated local and remote dsh homes.
2. Connect the local dsh page to the remote dsh instance through SSH.
3. Show local and remote workspaces as project rows in the unified left sidebar, with a `win-wsl` badge on remote project rows.
4. Switch from local to a remote session by clicking a remote session row under a remote project, not the remote project header.
5. Prove the remote iframe is visible, isolated, controlled by the companion, and rendering the remote dsh main area.
6. Prove `dsh-better-sidebar` inside the remote iframe reads and executes on the remote machine.
7. Switch back from remote to local by clicking a local session row and prove the remote iframe no longer owns the interaction path.
8. Save screenshots, logs, and a structured report.

P0 must be automated by `scripts/acceptance/e2e-win-wsl.mjs` and exposed as `npm run acceptance:p0` for external hosts and `npm run acceptance:container:p0` for Apple container remotes.

### P1: required before release and after large interaction changes

P1 covers multi-remote isolation, reconnect behavior, and Settings CRUD. The Apple container run uses separate `remote-a` and `remote-b` containers. It is automated by `scripts/acceptance/p1-p2-win-wsl.mjs` and exposed as `npm run acceptance:p1` for external hosts and `npm run acceptance:container:p1` for Apple container remotes.

### P2: long-term product quality

P2 covers performance, broader plugin compatibility, security hardening, and layout polish. The first automated P2 subset runs as part of `npm run acceptance:p1`. The complete gate for this repository is `npm run acceptance:all`, which runs `check`, P0, and the automated P1/P2 subset.

## Apple container local acceptance

The recommended local acceptance path on macOS uses Apple container CLI as the local container backend. The repository creates two local SSH containers, `remote-a` and `remote-b`, and points Remote Desktop host discovery at `.acceptance/container/ssh-config` instead of the developer's default SSH config.

Commands:

```sh
npm run acceptance:container:up
npm run acceptance:container:p0
npm run acceptance:container:p1
npm run acceptance:container:all
```

The Apple container remotes are retained after P0/P1 so the developer can inspect them manually. Stop or remove them explicitly:

```sh
npm run acceptance:container:down
npm run acceptance:container:clean
```

For manual validation without browser assertions, start the canary system:

```sh
npm run acceptance:container:canary
```

The canary command starts local DSH Web, connects both Apple container remotes, creates recognizable local and remote sessions, writes sentinel files, and prints the local browser URL plus SSH commands. It requires host Ollama with `minicpm-v4.6:1b`, configures that model as the routable default for local and remote sessions, and forwards remote model traffic through the retained host proxy. Seed-text generation may fall back to static fixture text after the model availability check; no hosted model credentials are required. Override the endpoint with `DSH_RD_OLLAMA_BASE_URL` and the model with `DSH_RD_OLLAMA_MODEL`.

## Environment rules

Acceptance must not use or mutate the developer's default dsh homes.

Local acceptance state:

```text
.acceptance/local-home/
.acceptance/artifacts/
```

Apple container acceptance state:

```text
.acceptance/container/
.acceptance/canary-local-home/
Apple containers dsh-rd-remote-a and dsh-rd-remote-b
/home/dsh/.dsh-remote-desktop-test inside each container
/home/dsh/.dsh-remote-desktop-p1 inside each container
/home/dsh/.dsh-remote-desktop-canary inside each container
/tmp/dsh-rd-* inside each container
```

External `win-wsl` acceptance state:

```text
~/.dsh-remote-desktop-test/
/tmp/dsh-remote-desktop-sentinel/
```

The script may install or update packages inside those isolated homes only. It must not write to local `~/.dsh` or remote `~/.dsh`.

The script must print cleanup commands at the end:

```sh
rm -rf .acceptance/local-home .acceptance/artifacts
ssh win-wsl 'rm -rf ~/.dsh-remote-desktop-test /tmp/dsh-remote-desktop-sentinel'
```


## Static check items

`npm run check` must validate all runtime entry points and acceptance scripts with `node --check`, then run `scripts/check-static.mjs`. The static script verifies that:

- `packages/local/lib/client.js` provides the light `ctx.remoteDesktop` service with `openLocalSession` and `openRemoteSession`.
- the source-aware sidebar uses DSH design tokens and the official-style fork marker.
- legacy inline MVP row/source-header styles are absent from the sidebar implementation.
- the companion still validates parent origin and token before `open-session`.
- the companion still strongly hides the remote iframe's left sidebar without broad `[class*="frame"]` CSS that breaks remote plugins.

## P0 script

Command:

```sh
npm run acceptance:p0
# equivalent explicit form
node scripts/acceptance/e2e-win-wsl.mjs --ssh-dest win-wsl

# full repository gate
npm run acceptance:all
```

The script must run non-interactively. It may fail early when key-only SSH is unavailable, but the failure must identify the missing prerequisite.

### P0 setup steps

1. Verify `ssh -o BatchMode=yes <dest> true` succeeds.
2. Verify remote Node.js is version 22 or newer.
3. Initialize remote dsh with `DSH_HOME=~/.dsh-remote-desktop-test`.
4. Install the remote companion into the remote isolated web profile.
5. Install `dsh-better-sidebar` into the remote isolated web profile.
6. Create `/tmp/dsh-remote-desktop-sentinel/remote-only.txt` with content `REMOTE_SENTINEL_WIN_WSL`.
7. Start remote dsh on `127.0.0.1:30800` with `DSH_HOME=~/.dsh-remote-desktop-test`.
8. Verify the remote profile uses the copied local companion artifact and the companion health route answers.
9. Initialize local dsh with `DSH_HOME=.acceptance/local-home`.
10. Install the local `dsh-remote-desktop` package into the local isolated web profile.
11. Start local dsh on an available loopback port.
12. Add and connect the `win-wsl` source through the local management API.
13. Create a remote workspace pointing at `/tmp/dsh-remote-desktop-sentinel` and a remote session in that workspace.
14. Create a local workspace/session in the local isolated home to verify the return-to-local path.

### P0 browser steps

The script must drive a real browser through Playwright or an equivalent browser automation layer.

1. Open the local dsh page.
2. Assert the unified left sidebar shows local project rows and a remote project row with a `win-wsl` host marker.
3. Assert the remote host appears connected in Remote Desktop settings and remote project rows show a host marker.
4. Assert a remote session row is visible under the remote project row with a `win-wsl` host marker.
5. Click the remote project header and assert it does not activate the remote iframe.
6. Click the remote session row.
7. Assert the remote iframe is visible.
8. Assert the iframe origin differs from the local dsh origin.
9. Assert the companion returns a `dsh-remote-desktop/opened` message for the clicked session id.
10. Assert iframe `body[data-dsh-remote-desktop-child="true"]` exists.
11. Assert the remote overlay is a fixed body portal over the local main area while official Settings can still appear above it.
12. Assert the remote iframe's own left sidebar is hidden while the top-level local sidebar remains visible.
13. Assert a remote chat/composer or onboarding main area is visible in the iframe.
14. Assert `dsh-better-sidebar` is mounted inside the iframe.
15. Assert the remote Better Sidebar file path can see `remote-only.txt`.
16. Assert the remote Better Sidebar terminal can run `cat /tmp/dsh-remote-desktop-sentinel/remote-only.txt` and returns `REMOTE_SENTINEL_WIN_WSL`.
17. Click a local session row in the top-level sidebar.
18. Assert the remote iframe is hidden or non-interactive.
19. Assert the local main area is visible again.
20. Assert the local UI does not show `REMOTE_SENTINEL_WIN_WSL` or `remote-only.txt` as local content.
21. Repeat local → remote → local → remote once more to catch stuck overlay or stale active-source state.

### P0 artifacts

The script must write these files under `.acceptance/artifacts/<timestamp>/`:

```text
acceptance-report.json
browser-console.log
local-dsh.log
remote-dsh.log
01-local-ready.png
02-remote-active.png
03-local-restored.png
failure-current.png   # only on failure
```

The JSON report must include one record per acceptance item:

```json
{
  "id": "P0-SWITCH-003",
  "status": "PASS",
  "evidence": "remote iframe display:none after Local click",
  "durationMs": 123
}
```

A failing run must exit non-zero and include the failing item id in stdout.

## P0 acceptance items

### ENV: environment isolation

- **P0-ENV-001 local home isolation**
  PASS: local dsh uses `.acceptance/local-home`; the script does not write to default `~/.dsh`.

- **P0-ENV-002 remote home isolation**
  PASS: remote dsh uses `~/.dsh-remote-desktop-test`; the script does not write to remote default `~/.dsh`.

- **P0-ENV-003 ssh key-only**
  PASS: `ssh -o BatchMode=yes win-wsl true` succeeds.

### BOOT: startup and connection

- **P0-BOOT-001 remote dsh boots**
  PASS: remote `127.0.0.1:30800` answers `host.describe` through the dsh API.

- **P0-BOOT-002 local dsh boots**
  PASS: local dsh page returns 200 and `/remote-desktop/api/sources` returns a success envelope.

- **P0-BOOT-003 tunnel connects**
  PASS: the local management API reports `win-wsl.state === "connected"` and an iframe URL on a loopback origin.

- **P0-BOOT-004 remote companion uses copied local artifact**
  PASS: the remote web profile depends on `link:/tmp/dsh-remote-desktop-companion`, includes `dsh-remote-desktop-companion` in profile bundles, and the running remote DSH process answers the companion health route.

### SIDEBAR: unified left sidebar

- **P0-SIDEBAR-001 source list visible**
  PASS: the top-level left sidebar shows project rows, and remote project rows carry a `win-wsl` host marker.

- **P0-SIDEBAR-002 remote session visible**
  PASS: the remote sentinel workspace/session is visible as a project row with a `win-wsl` host marker.

- **P0-SIDEBAR-003 active source indication**
  PASS: after clicking a remote session row, that remote session row has an active/selected indication; after clicking a local session row, the local session row has an active/selected indication.

- **P0-SIDEBAR-004 project header does not switch active target**
  PASS: clicking a remote project header toggles its sessions only and does not show or activate the remote iframe.

### SWITCH: source switching

- **P0-SWITCH-001 local to remote**
  PASS: clicking the remote session makes the remote iframe visible and places it on the main interaction path.

- **P0-SWITCH-002 remote open command**
  PASS: the companion emits `dsh-remote-desktop/opened` with the clicked remote session id.

- **P0-SWITCH-003 remote to local**
  PASS: clicking a local session row hides or disables interaction with the remote iframe, and the local main area is visible again.

- **P0-SWITCH-004 repeated switching**
  PASS: local → remote → local → remote completes twice without stuck overlays, duplicate iframes on top, or inability to return to Local.

### IFRAME: remote container isolation

- **P0-IFRAME-001 remote origin**
  PASS: the remote iframe origin differs from the local dsh origin.

- **P0-IFRAME-005 remote overlay stacking**
  PASS: the active remote overlay is portalled directly under `document.body`, uses fixed positioning, covers the local main-area viewport probe, and stays below the official Settings modal so Settings remains usable while a remote session is active.

- **P0-IFRAME-006 companion CSS targets only dsh app frame**
  PASS: companion CSS keeps the hidden `sidebarCol` mounted as a zero-width grid item and rewrites only the DSH app frame that directly contains `sidebarCol`; it must not rewrite every class containing `frame`, because that breaks remote plugins such as Better Sidebar right/bottom panels.

- **P0-IFRAME-007 remote overlay follows sidebar resize**
  PASS: after dragging the local sidebar splitter, the active remote overlay left edge follows the sidebar right edge, so the remote iframe resizes with the main interaction area.

- **P0-IFRAME-002 companion marker**
  PASS: the iframe body has `data-dsh-remote-desktop-child="true"`.

- **P0-IFRAME-003 remote left sidebar hidden**
  PASS: the remote iframe's own left sidebar is hidden, and the top-level local sidebar remains visible and usable.

- **P0-IFRAME-004 remote main area visible**
  PASS: a remote chat/composer or onboarding main area is visible inside the iframe.

### PLUGIN: remote plugin compatibility

- **P0-PLUGIN-001 Better Sidebar mounted in iframe**
  PASS: the iframe contains the Better Sidebar host element.

- **P0-PLUGIN-002 Explorer reads remote sentinel**
  PASS: the Better Sidebar file tree or `/sidebar/api/fs.tree` inside the remote iframe origin can see `remote-only.txt` in `/tmp/dsh-remote-desktop-sentinel`.

- **P0-PLUGIN-003 terminal runs remotely**
  PASS: the Better Sidebar terminal WebSocket returns `REMOTE_SENTINEL_WIN_WSL` from `cat /tmp/dsh-remote-desktop-sentinel/remote-only.txt`.

- **P0-PLUGIN-004 local explorer not polluted**
  PASS: after switching back to Local, the top-level local UI does not show `remote-only.txt` or `REMOTE_SENTINEL_WIN_WSL` as local content.

- **P0-PLUGIN-005 Better Sidebar bottom panel toggles in iframe**
  PASS: inside the remote iframe, Better Sidebar bottom panel expands and collapses from its own controls, and its close control is not visible while the bottom panel is closed.

### ARTIFACTS: evidence

- **P0-ARTIFACT-001 screenshots saved**
  PASS: the three required screenshots exist and are referenced from the report.

- **P0-ARTIFACT-002 logs saved**
  PASS: local dsh log, remote dsh log, and browser console log exist.

- **P0-ARTIFACT-003 structured report**
  PASS: `acceptance-report.json` records every P0 item id, status, evidence, and duration.

## P1 acceptance items

### MULTI: two remote sources

- **P1-MULTI-001 two remotes connect**
  PASS: two remote sources are connected at the same time.

- **P1-MULTI-002 iframe origins differ**
  PASS: remote A and remote B have different iframe origins.

- **P1-MULTI-003 tokens do not cross**
  PASS: sending remote A's token to remote B's companion is rejected and opens no session.

- **P1-MULTI-004 explorer does not cross**
  PASS: A's sentinel appears only in A's Better Sidebar Explorer; B's sentinel appears only in B's Explorer.

- **P1-MULTI-005 terminal does not cross**
  PASS: A's terminal returns A's sentinel/hostname; B's terminal returns B's sentinel/hostname.

### RECOVERY: disconnect and reconnect

- **P1-RECOVERY-001 disconnect active remote**
  PASS: disconnecting the active remote selected through a remote session row shows a clear disconnected state.

- **P1-RECOVERY-002 reconnect preserves source**
  PASS: reconnecting allows the same remote session to open again.

- **P1-RECOVERY-003 local remains usable**
  PASS: local sessions remain openable while the remote is disconnected.

### SETTINGS: source management UI

- **P1-SETTINGS-000 host row opens remote native DSH page**
  PASS: a connected host row exposes a native DSH URL that omits iframe mode and opens the same forwarded origin in a new page.

- **P1-SETTINGS-001 ssh config hosts listed in UI**
  PASS: every configured concrete SSH host appears in Remote Desktop settings.

- **P1-SETTINGS-002 connected statuses shown in UI**
  PASS: connected sources show their connected state in their host rows.

- **P1-SETTINGS-003 disconnect host from UI**
  PASS: a host row can disconnect its remote source and updates to the disconnected state.

- **P1-SETTINGS-004 connect host from UI**
  PASS: a host row can reconnect a disconnected source and restore its forwarded iframe origin.

- **P1-SETTINGS-005 manual source form removed**
  PASS: Remote Desktop settings is driven by SSH config host rows and no longer exposes manual source fields.

## P2 acceptance items

- **P2-PERF-001 hidden remote iframe idle CPU**
- **P2-PERF-002 memory with N remotes**
- **P2-COMPAT-001 plugin compatibility matrix**
- **P2-SECURITY-001 proxy rejects arbitrary upstream**
- **P2-SECURITY-002 postMessage origin/token audit**
- **P2-UX-001 mobile/narrow viewport**
- **P2-UX-002 onboarding/modal behavior inside iframe**

## Manual UI checklist

The manual checklist is not required on every run. Run it when changing layout, iframe container styling, sidebar shell behavior, or Better Sidebar visual integration.

Checklist file: `scripts/acceptance/check-ui-manual.md`.

Manual criteria:

1. The local unified sidebar remains the only expanded left sidebar in the top-level page.
2. Remote active state is visually obvious.
3. Local active state is visually obvious after switching back.
4. No remote overlay remains on top of the local main area after switching to Local.
5. The remote iframe does not show a second expanded left sidebar.
6. Remote Better Sidebar is visible, not clipped, and visually belongs to the remote iframe.
7. Local Better Sidebar and remote Better Sidebar cannot be mistaken for the same instance.
8. Remote Desktop settings lists SSH config hosts and connected/not connected status.
9. Failure messages are understandable without reading terminal logs.
