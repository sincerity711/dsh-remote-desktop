# dsh-remote-desktop acceptance standard

This document defines the acceptance standard for `dsh-remote-desktop`. The goal is to prevent ad-hoc verification that proves only transport reachability while missing the user-facing switching, iframe isolation, and remote-plugin behavior.

## Acceptance levels

### P0: required after every implementation change

P0 is the hard gate for the first release. It uses one remote destination, `win-wsl`, but covers the complete user path:

1. Prepare isolated local and remote dsh homes.
2. Connect the local dsh page to the remote dsh instance through SSH.
3. Show Local and `Remote: win-wsl` in the unified left sidebar.
4. Switch from local to a remote session.
5. Prove the remote iframe is visible, isolated, controlled by the companion, and rendering the remote dsh main area.
6. Prove `dsh-better-sidebar` inside the remote iframe reads and executes on the remote machine.
7. Switch back from remote to local and prove the remote iframe no longer owns the interaction path.
8. Save screenshots, logs, and a structured report.

P0 must be automated by `scripts/acceptance/e2e-win-wsl.mjs` and exposed as `pnpm acceptance:p0`.

### P1: required before release and after large interaction changes

P1 covers multi-remote isolation, reconnect behavior, and Settings CRUD. These checks may be separate scripts or an extended mode of the P0 script.

### P2: long-term product quality

P2 covers performance, broader plugin compatibility, security hardening, and layout polish. These checks do not block the first release unless the touched code changes that area.

## Environment rules

Acceptance must not use or mutate the developer's default dsh homes.

Local acceptance state:

```text
.acceptance/local-home/
.acceptance/artifacts/
```

Remote `win-wsl` acceptance state:

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

## P0 script

Command:

```sh
pnpm acceptance:p0
# equivalent explicit form
node scripts/acceptance/e2e-win-wsl.mjs --ssh-dest win-wsl
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
8. Initialize local dsh with `DSH_HOME=.acceptance/local-home`.
9. Install the local `dsh-remote-desktop` package into the local isolated web profile.
10. Start local dsh on an available loopback port.
11. Add and connect the `win-wsl` source through the local management API.
12. Create a remote workspace pointing at `/tmp/dsh-remote-desktop-sentinel` and a remote session in that workspace.
13. Create a local workspace/session in the local isolated home to verify the return-to-local path.

### P0 browser steps

The script must drive a real browser through Playwright or an equivalent browser automation layer.

1. Open the local dsh page.
2. Assert the unified left sidebar shows both `Local` and `Remote: win-wsl`.
3. Assert the remote source shows as connected.
4. Assert a remote session row is visible under `Remote: win-wsl`.
5. Click the remote session.
6. Assert the remote iframe is visible.
7. Assert the iframe origin differs from the local dsh origin.
8. Assert the companion returns a `dsh-remote-desktop/opened` message for the clicked session id.
9. Assert iframe `body[data-dsh-remote-desktop-child="true"]` exists.
10. Assert the remote iframe's own left sidebar is hidden while the top-level local sidebar remains visible.
11. Assert a remote chat/composer or onboarding main area is visible in the iframe.
12. Assert `dsh-better-sidebar` is mounted inside the iframe.
13. Assert the remote Better Sidebar file path can see `remote-only.txt`.
14. Assert the remote Better Sidebar terminal can run `cat /tmp/dsh-remote-desktop-sentinel/remote-only.txt` and returns `REMOTE_SENTINEL_WIN_WSL`.
15. Click `Local` in the top-level sidebar.
16. Assert the remote iframe is hidden or non-interactive.
17. Assert the local main area is visible again.
18. Assert the local UI does not show `REMOTE_SENTINEL_WIN_WSL` or `remote-only.txt` as local content.
19. Repeat local → remote → local → remote once more to catch stuck overlay or stale active-source state.

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

### SIDEBAR: unified left sidebar

- **P0-SIDEBAR-001 source list visible**
  PASS: the top-level left sidebar shows `Local` and `Remote: win-wsl`.

- **P0-SIDEBAR-002 remote session visible**
  PASS: the remote sentinel workspace/session is visible under `Remote: win-wsl`.

- **P0-SIDEBAR-003 active source indication**
  PASS: after clicking a remote session, `win-wsl` has an active/selected indication; after clicking Local, Local has an active/selected indication.

### SWITCH: source switching

- **P0-SWITCH-001 local to remote**
  PASS: clicking the remote session makes the remote iframe visible and places it on the main interaction path.

- **P0-SWITCH-002 remote open command**
  PASS: the companion emits `dsh-remote-desktop/opened` with the clicked remote session id.

- **P0-SWITCH-003 remote to local**
  PASS: clicking Local hides or disables interaction with the remote iframe, and the local main area is visible again.

- **P0-SWITCH-004 repeated switching**
  PASS: local → remote → local → remote completes twice without stuck overlays, duplicate iframes on top, or inability to return to Local.

### IFRAME: remote container isolation

- **P0-IFRAME-001 remote origin**
  PASS: the remote iframe origin differs from the local dsh origin.

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
  PASS: disconnecting the active remote shows a clear disconnected overlay.

- **P1-RECOVERY-002 reconnect preserves source**
  PASS: reconnecting allows the same remote session to open again.

- **P1-RECOVERY-003 local remains usable**
  PASS: local sessions remain openable while the remote is disconnected.

### SETTINGS: source management UI

- **P1-SETTINGS-001 create source from UI**
- **P1-SETTINGS-002 edit source from UI**
- **P1-SETTINGS-003 disconnect source from UI**
- **P1-SETTINGS-004 delete source from UI**
- **P1-SETTINGS-005 validation errors shown**

Each Settings item passes only when the UI action changes the underlying management API state and the user-visible status reflects the outcome.

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
8. Settings copy explains that remote dsh must already be running and the companion must be installed remotely.
9. Failure messages are understandable without reading terminal logs.
