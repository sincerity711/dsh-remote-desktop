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

## Conventions

- Keep files ESM and dependency-light; packages currently ship `lib/` JavaScript directly.
- Do not mutate default DSH homes in tests or scripts. Use `.acceptance/*` locally and the documented isolated remote homes.
- Preserve iframe isolation: source tokens must not cross, iframe origins should differ, and the companion must validate origin and token before opening sessions.
- Preserve remote plugin compatibility: companion CSS must target the DSH app frame narrowly and must not use broad `[class*=frame]` rewrites.
- When changing layout, iframe styling, sidebar behavior, or Better Sidebar integration, use the manual checklist in addition to the relevant automated gate.
