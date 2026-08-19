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
npm run check           # static gate for runtime files and acceptance scripts
npm run acceptance:p0   # one win-wsl remote, full user path
npm run acceptance:p1   # multi-remote/recovery/settings plus automated P2 subset
npm run acceptance:all  # check + P0 + P1
```

Run the smallest command that proves the change. Do not run acceptance commands unless the needed `win-wsl` SSH/browser prerequisites are available.

## Stable test homes

Use isolated, repeatable DSH homes for every manual or automated local/remote run. Never point tests at the developer's default `~/.dsh` on the local machine or on any SSH host.

- Local manual web profile: `.acceptance/dev-home-30888` with port `30888`.
- Local automated acceptance profile: `.acceptance/local-home`.
- Remote DSH profile on each SSH host: `$HOME/.dsh-remote-desktop-test` with remote web port `30800`.
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
