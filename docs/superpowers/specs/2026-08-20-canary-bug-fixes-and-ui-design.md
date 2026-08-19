# Canary Bug Fixes and Remote Desktop UI Design

## Scope

Fix the four issues observed in the Apple Container canary without changing the official Workspace tree structure or the main DSH conversation UI.

## Session titles

Remote session summaries must preserve the Host `blank` field. A blank session uses the official localized New Session label even when its cwd or an earlier persisted title is present. After the first prompt makes the session non-blank, the normal projected title is shown. Missing non-blank titles may retain the existing cwd and session-id fallbacks.

The canary seed creates one named non-blank session per source for navigation checks. Sessions created manually from a Workspace remain blank until used and must therefore appear as New Session.

## Ollama credentials

The canary writes the same non-secret dummy API key for the local and remote Ollama provider profiles. The key exists only under isolated `.acceptance` DSH homes. It is not read from or written to the developer's default DSH home and is never presented as a production credential.

Canary startup continues to prove that the configured Ollama model is the routable default on the local Host and both remote Hosts.

## Settings and remote frames

The remote iframe overlay remains active only while a remote session is the selected conversation surface. Opening the official Settings dialog suppresses all remote frames; closing Settings restores the selected remote frame without changing the selected session.

Suppression is driven by the Remote Desktop settings integration's mounted state or an authoritative settings-shell signal available at runtime. It must not depend on a timing delay or a z-index larger than the official Settings layer.

## Plugin-owned UI

The official Workspace tree and Settings shell remain unchanged. Remote Desktop owns and updates these surfaces:

- the Remote Desktop settings section;
- remote Host rows and connection actions;
- the Local or Remote workspace choice;
- the remote directory picker.

These surfaces use DSH UI primitives and existing `--dsw-*` theme tokens. Typography follows the official settings sections: 16/24 section titles, 14/22 body and controls, and 12/18 supporting text. Containers use 12px radii and `border-l2` hairlines; controls use the official capsule buttons and hover/focus states. Host state is communicated with `StateDot` plus text, not color alone. Layout remains usable in the official 800px Settings panel and collapses cleanly on narrow viewports.

No new decorative imagery, gradients, independent navigation, or replacement app shell is introduced.

## Failure behavior

Connect and disconnect actions expose a pending state, prevent duplicate requests, and keep the last actionable error beside the relevant surface. A missing SSH Host list or a disconnected Host uses a concise official-style empty state. The remote directory picker retains retry behavior and disables creation until a usable path is loaded.

## Verification

Automated coverage proves:

- remote blank summaries stay blank and render through the official New Session path;
- canary settings contain the dummy Ollama credential for local and remote profiles;
- Settings suppresses the iframe overlay and restores it on close;
- plugin-owned UI uses primitives and theme tokens without raw light-theme colors.

Run `npm run check` and `npm run acceptance:container:p1`. Then restart the retained canary and use the in-app browser to verify desktop and narrow layouts, New Session naming, Ollama availability, Settings over a selected remote session, Host actions, and the remote directory picker. Keep the canary running for user testing after the final push.
