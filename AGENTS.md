# AGENTS.md

Keep this guide small. Load the linked docs only when the task touches that area.

## Project

`dsh-remote-desktop` is a two-plugin DSH add-on:

- `packages/local`: local web plugin; manages SSH-connected remote sources, local proxy APIs, and the unified local/remote sidebar.
- `packages/companion`: remote web plugin; runs inside the remote iframe, validates parent messages, opens remote sessions, and hides the embedded remote sidebar.

## On-demand docs

- Acceptance scope and evidence requirements: `docs/acceptance.md`.
- Remote profile setup and first-release assumptions: `docs/remote-server-setup.md`.
- Manual layout checklist: `scripts/acceptance/check-ui-manual.md`.

## Commands

```sh
npm run check                    # static gate for runtime files and acceptance scripts
npm run acceptance:container:up     # build/start two local Apple Container remotes
npm run acceptance:container:p0     # one Apple container remote, full user path
npm run acceptance:container:p1     # two Apple container remotes plus recovery/settings/P2 subset
npm run acceptance:container:canary # retained local UI + two remotes for manual play
npm run acceptance:container:down   # stop retained containers
npm run acceptance:p0            # external win-wsl remote, full user path
npm run acceptance:p1            # external multi-remote/recovery/settings path
```

Run the smallest command that proves the change. Prefer the Apple container acceptance commands for local validation; use the external `win-wsl` commands only when intentionally testing a real SSH host.

## Stable test homes

Use isolated, repeatable DSH homes for every manual or automated local/remote run. Never point tests at the developer's default `~/.dsh` on the local machine or on any SSH host.

- Local manual web profile: `.acceptance/dev-home-30888` with port `30888`.
- Local automated acceptance profile: `.acceptance/local-home`.
- Local Apple container canary profile: `.acceptance/canary-local-home`.
- Apple container SSH config and generated key: `.acceptance/container/`.
- Apple container remote DSH profiles: `/home/dsh/.dsh-remote-desktop-test`, `/home/dsh/.dsh-remote-desktop-p1`, or `/home/dsh/.dsh-remote-desktop-canary` with remote web port `30800`.
- External remote DSH profile on each SSH host: `$HOME/.dsh-remote-desktop-test` with remote web port `30800`.
- Remote fixture data on each SSH host: `/tmp/dsh-remote-desktop-sentinel`.
- If two test profiles must run on the same remote host at once, suffix both remote paths with the SSH host id, for example `$HOME/.dsh-remote-desktop-test-win-wsl` and `/tmp/dsh-remote-desktop-sentinel-win-wsl`.

Manual local launch example:

```sh
DSH_HOME=$PWD/.acceptance/dev-home-30888 \
  DSH_TELEMETRY_DISABLED=1 \
  dsh --profile web --host 127.0.0.1 --port 30888 --trusted-host 127.0.0.1:30888
```

## Conventions

- Keep files ESM and dependency-light; packages currently ship `lib/` JavaScript directly.
- Do not mutate default DSH homes in tests or scripts. Use `.acceptance/*` locally and the documented isolated remote homes.
- Preserve iframe isolation: source tokens must not cross, iframe origins should differ, and the companion must validate origin and token before opening sessions.
- Preserve remote plugin compatibility: companion CSS must target the DSH app frame narrowly and must not use broad `[class*=frame]` rewrites.
- When changing layout, iframe styling, sidebar behavior, or Better Sidebar integration, use the manual checklist in addition to the relevant automated gate.
