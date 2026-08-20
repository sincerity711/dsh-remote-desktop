# ui-workspace fork baseline

`dsh-remote-desktop` keeps its sidebar visually aligned with the official workspace browser by treating these files as a vendored fork.

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Commit: `141eb6fef83422698aef7a981029e843e8161534`
- Package: `packages/client/ui-workspace`
- Local baseline copy: `packages/local/upstream/ui-workspace/baseline/`
- Local patch summary: `packages/local/upstream/ui-workspace/remote-desktop.patch`

Copied files:

```text
src/client/WorkspaceBrowser.tsx
src/client/WorkspaceBrowser.module.css
src/client/WorkspacePicker.tsx
src/client/contract/slots.ts
src/client/locales.ts
src/client/stores.ts
src/client/tree.ts
src/client/rows/Rows.tsx
src/client/rows/Rows.module.css
```

Allowed `dsh-remote-desktop` changes are limited to source-aware adapters, source-aware open callbacks, the remote workspace marker, unsupported remote action guards, and routing the official-looking Add workspace affordance to the Local / Remote splitter.

## Rebase procedure

1. Replace `baseline/` with the same files from the new `deepseek-harness` commit.
2. Update the commit hash above.
3. Reapply the changes summarized in `remote-desktop.patch` to `packages/local/lib/client.js` or the split client modules when they exist.
4. Run `npm run check`.
5. Compare the local sidebar against the official sidebar; only remote workspace markers should differ.
