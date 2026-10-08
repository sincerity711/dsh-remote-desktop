# ui-workspace fork baseline

`dsh-remote-desktop` keeps its sidebar visually aligned with the official workspace browser by treating these files as a vendored fork.

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Commit: `4e84901e6471b79ec0338099867ebb4606d12bb5`
- Package: `packages/client/ui-workspace`
- Local baseline copy: `packages/local/upstream/ui-workspace/baseline/`
- Local patch summary: `packages/local/upstream/ui-workspace/remote-desktop.patch`

Copied files:

```text
src/client/WorkspacePicker.tsx
src/client/contract/slots.ts
src/client/locales.ts
src/client/navigation.ts
src/client/stores.ts
src/client/subagent-lineage.ts
src/client/tree.ts
src/client/rows/Rows.tsx
src/client/rows/Rows.module.css
src/client/rows/WorkspaceBrowser.tsx
src/client/rows/WorkspaceBrowser.module.css
```

Allowed `dsh-remote-desktop` changes are limited to source-aware adapters, source-aware open callbacks, the remote workspace marker, unsupported remote action guards, and routing the official-looking Add workspace affordance to the Local / Remote splitter.

## Rebase procedure

1. Replace `baseline/` with the same files from the new `deepseek-harness` commit.
2. Update the commit hash above.
3. Rebuild the generated upstream section, reapply the changes summarized in `remote-desktop.patch`, and replace `packages/local/src/client/10-official-workspace.part.js`.
4. Run `npm run build && npm run check`.
5. Compare the local sidebar against the official sidebar; only remote workspace markers should differ.

## 0.2.0 compatibility baseline

The browser presentation above retains its original baseline. Navigation now follows
`639ed015397290b3745d163aafe02ffee4aa3f84` (`dsh-v0.2.0-rc.2`), with the exact
upstream source recorded in `compatibility/navigation.ts`. The published compiled
navigation section is embedded in the generated browser factory. Its pin-order
helpers consume the retained presentation's Session membership, and its view
callbacks share the browser's store instance. Current selection is derived from
`retainedBy.mainView`; temporary operations use `sessions.using` references.

The official workspace bundle must remain disabled because its UI entries own
exclusive directory-flow child declarations. Remote Desktop supplies those same
declarations and the navigation service together. This is a compatibility migration,
not a claim that the entire presentation was rebased to the 0.2 visual design.
Icons use the current Regular exports; unified Session status is projected into the
retained presentation's pending-interaction input.
