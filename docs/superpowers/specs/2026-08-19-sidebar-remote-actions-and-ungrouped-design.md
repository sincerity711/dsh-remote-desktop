# Sidebar Remote Actions and Source-Aware Ungrouped Design

## Goal

Make the official-style workspace sidebar fully source-aware after remote workspaces and sessions are merged into the local tree. Every visible sidebar action must either run locally for local rows or forward to the owning remote DSH host for remote rows. The Add workspace button in the sidebar header must open the Remote Desktop Local / Remote splitter directly. Ungrouped sessions must be split by source, with a per-source action to archive every session in that Ungrouped bucket.

## Scope

This design covers the left sidebar workspace/session browser and the Add workspace entry points owned or adapted by `packages/local/lib/client.js`.

In scope:

- sidebar header Add workspace button;
- workspace picker footer Add workspace entry;
- local and remote workspace row actions;
- local and remote session row actions;
- start-session buttons;
- drag reorder paths;
- search and sort behavior over combined local and remote data;
- source-aware Ungrouped groups and per-source bulk archive;
- tests and documentation for the action matrix.

Out of scope:

- changing remote SSH/proxy lifecycle;
- changing the iframe origin/token protocol;
- redesigning Settings;
- hard-deleting session logs;
- adding cross-source drag and drop.

## Current problems

The sidebar currently merges local and remote data, but several UI paths still behave like the official single-instance sidebar. The top-right Add workspace icon can enter the official picker path instead of immediately showing Remote Desktop's Local / Remote choice. Remote action support was added incrementally, so every button and menu needs an explicit audit. Ungrouped is currently one fallback bucket from the official model; after deleting a workspace, sessions from different machines can appear under the same Ungrouped group, which makes bulk actions ambiguous.

## Chosen approach

Use a source-aware adapter around the official workspace browser fork.

The adapter continues to feed official-looking workspace and session rows into the fork, but it assigns every row a source identity before rendering. Local rows use source id `local`. Remote rows use the connected host id and source-qualified row ids such as `remote::<sourceId>::<rawId>`. The official row components stay visually close to upstream, while the adapter owns decoding, forwarding, and source grouping.

This approach keeps the UI rebaseable because source logic remains concentrated in the Remote Desktop adapter instead of being scattered through official row rendering. It also makes failures safer: unsupported cross-source operations can be rejected before any local or remote API receives the wrong id.

## Add workspace behavior

The sidebar header Add workspace button must open `WorkspaceAddSplitter` directly.

Expected behavior:

1. User clicks the rightmost Add workspace icon in the Workspaces header.
2. The UI shows a modal/popover with exactly the Remote Desktop first choice: Local workspace or Remote workspace.
3. Choosing Local delegates to the official current-instance directory flow and then creates a local workspace through `ctx.workspaces.create`.
4. Choosing Remote opens the Remote Desktop host/path flow, calls remote `workspace.create`, refreshes that host snapshot, creates or reuses a session, and opens the remote iframe.

The header button must not first open the official single-instance workspace picker. Existing picker surfaces may still list existing workspaces when that is the intended control, but their footer Add workspace entry must route to the same splitter.

## Action matrix

Every sidebar operation must follow this table.

| UI operation | Local row | Remote row | Cross-source case |
| --- | --- | --- | --- |
| Open session | `ctx.sessions.open(sessionId)` and hide remote overlay | set active remote target and post `open-session` to that host iframe | not applicable |
| Start session in workspace | `ctx.workspaces.startSession(workspaceId)` | remote `session.create` or reuse a blank session in that remote workspace, then open iframe | not applicable |
| Rename workspace | `ctx.workspaces.rename(workspaceId, title)` | remote `workspace.rename` | reject |
| Delete workspace | `ctx.workspaces.delete(workspaceId)` | remote `workspace.delete`; refresh that host snapshot | reject |
| Reorder workspace | `ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)` | remote `workspace.insertBefore` on same host | reject |
| Rename session | bound local session rename | remote `session.rename` | reject |
| Fork session | `ctx.sessions.fork`, then open child locally | remote `session.fork`, then open child in that host iframe | reject |
| Archive session | `ctx.workspaces.archiveSession(sessionId)` | remote `workspace.archiveSession` | reject |
| Reorder session | `ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)` | remote `workspace.insertSessionBefore` on same host | reject |
| Content search | local `ctx.sessions.search` | remote `session.search` for each connected host | merge source-qualified results |
| Sort by last updated | local and remote `updatedAt` in one derived list | local and remote `updatedAt` in one derived list | no mutation |
| Manual ordering | local store/order for local ids | remote reorder only inside same host/workspace bucket | reject |

All remote mutations refresh only the owning host snapshot after success. Remote mutation errors surface in the same UI affordance used by the official sidebar where possible. No remote id may be passed to a local `ctx.workspaces` or `ctx.sessions` mutation.

## Source-aware Ungrouped groups

Ungrouped is split by source before the official tree receives group rows.

Groups:

- local loose sessions render as `Ungrouped` with local source id `local`;
- each connected remote host with loose sessions renders its own Ungrouped group, visually aligned with remote workspace rows and carrying the same compact host marker;
- remote Ungrouped labels may remain `Ungrouped` because the host marker disambiguates the source; accessible text includes the host label.

A session is loose for a source when it is visible, not archived, and not present in any workspace `sessionIds` for that same source. Loose-session detection must never compare raw local ids with raw remote ids from another source.

## Archive all sessions for Ungrouped

Each source-specific Ungrouped row gets a row menu item named `Archive all sessions`.

Behavior:

- local Ungrouped archives every local loose session through `ctx.workspaces.archiveSession(sessionId)`;
- remote Ungrouped archives every loose session for that host through remote `workspace.archiveSession` calls;
- after remote success, refresh only that host snapshot;
- after local success, rely on local workspace/session subscriptions to update the sidebar;
- if one archive call fails, report the failure and leave remaining sessions untouched unless they were already archived by earlier calls;
- when the bucket is empty, the group is not rendered and no bulk action is visible.

The operation is archive-only. It keeps session logs and matches the existing single-session Archive action semantics.

## Search and sort rules

Search runs over the unified list but preserves source identity.

- Title filtering uses the combined derived local/remote rows.
- Content search calls local `ctx.sessions.search` and remote `session.search` on every connected host.
- Remote results must source-qualify returned `sessionId` values before merging.
- Selecting a remote search result opens the owning remote iframe, not the local session API.

Sorting uses the same source-aware row metadata. `updatedAt` ordering can interleave local and remote sessions. Manual ordering remains source-local because there is no meaningful remote API for moving rows between hosts.

## Tests

Update or add focused tests that verify the implementation by behavior and by the maintained fork seams:

- header Add workspace button invokes `WorkspaceAddSplitter` directly;
- footer Add workspace entry also routes to the splitter;
- every operation in the action matrix has a local route and a remote forwarding route where applicable;
- cross-source reorder paths reject before local or remote mutation calls;
- remote search calls `session.search` and source-qualifies results;
- source-aware Ungrouped creates separate local and per-host buckets;
- `Archive all sessions` for local Ungrouped calls local archive for local loose sessions only;
- `Archive all sessions` for remote Ungrouped calls remote archive for that host's loose sessions only.

Run `npm run check` after implementation. Because the work changes sidebar behavior, use the manual checklist in `scripts/acceptance/check-ui-manual.md` when visually validating a running DSH web profile.

## Rollout notes

`packages/local/lib/client.js` is a shipped JavaScript bundle. A running DSH web page will not automatically pick up edits. After implementation, refresh the browser page; if the bundle is cached or the plugin process already loaded old code, restart the local DSH web process. Remote iframe behavior can also require refreshing or restarting the remote DSH web profile if companion code changed.
