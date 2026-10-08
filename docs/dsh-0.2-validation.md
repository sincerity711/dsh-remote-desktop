# DSH 0.2 compatibility validation

Validated on 2026-10-08 against npm `latest` = `0.2.0-rc.2` on the local CLI and both Apple Container remotes. Both Remote Desktop packages are version `0.2.0`; the remote plugin baseline is Better Sidebar `0.24.1`. This release requires upgrading both controller and companions; it drops the previous DSH 0.1 API contract.

## Gates

- `npm run check`: generated artifacts, syntax/static gates and 45 unit tests passed. Lifecycle tests execute companion commands, including unselected rename, cancelled open and temporary reference cleanup.
- `npm run acceptance:container:p0`: full P0 passed. Evidence: `.acceptance/artifacts/2026-10-08T07-23-33-746Z`.
- `npm run acceptance:container:p1`: multi-remote, recovery, Settings and P2 subset passed. Evidence: `.acceptance/artifacts/p1-2026-10-08T07-28-24-124Z`.
- `git diff --check`: passed.

Tests use isolated homes. Terminal acceptance executes the published Controller over each forwarded browser origin; its temporary Context instrumentation exists only in the test response, not in the shipped plugin. The bottom panel assertion measures its visible box rather than requiring the panel container itself to intercept pointer events.

## UI review

Reviewed P0 local/remote/restored screenshots and P1 multi-remote/Settings screenshots using `scripts/acceptance/check-ui-manual.md`. The top-level unified sidebar remains singular; project rows, host markers and selected-session styling are readable; remote content fills the main area, with no second expanded sidebar or overlay after returning local. P0 also exercises resize and Better Sidebar bottom-panel open/close inside the iframe. Settings preserves the official modal and rail, lists both hosts with connection states, and opens native remote DSH without an iframe token.

The checklist's older Settings Host switcher describes an earlier UI: current Settings exposes host rows and native-page actions, which P1 validates. This run does not claim a complete manual review of every failure-message variant, browser size, or third-party plugin. External Windows SSH hosts were not tested.

## Remaining upstream coupling

Source federation still needs the unified sidebar adapter and isolated iframe/companion bridge. The sidebar presentation retains its recorded older upstream baseline; only navigation is migrated to the current release policy. Experimental Mods do not replace the multi-host session integration. The exact tested DSH peer version is intentional; future upstream releases need another compatibility review.
