# Upstream ui-workspace sync design

## Goal

Update the vendored `ui-workspace` baseline in `dsh-remote-desktop` from the
stale recorded commit `9f8359451a6f8df17f65bc2c398810ac19bdfc8a` to the latest
`deepseek-ai/deepseek-harness` `master` commit available at implementation time:
`141eb6fef83422698aef7a981029e843e8161534`.

The remote desktop behavior must continue to provide the source-aware local
and remote workspace sidebar, remote session routing, remote mutations, and
the local/remote workspace splitter on top of the updated official files.

## Scope and approach

1. Read the eight tracked `packages/client/ui-workspace` files from the pinned
   upstream commit and replace the vendored `baseline/` copy.
2. Update `UPSTREAM.md` with the upstream repository, commit, copied files,
   and the maintained remote desktop delta.
3. Compare the current remote desktop client against the new baseline and
   adapt only code affected by upstream changes. Preserve the existing
   source-qualified ids, remote routing, iframe isolation, and action guards.
4. Run the smallest relevant static checks and unit tests first. If those
   expose compatibility failures, fix the remote desktop implementation and
   its tests. Run the documented acceptance path when the local environment
   supports it.

The sibling `deepseek-harness` checkout is read-only for this task. Its local
uncommitted files and local-only commits are not included; only the public
remote commit above is used as the source.

## Validation

- `npm run check`
- Focused `packages/local/tests` tests covering the changed behavior
- Relevant container acceptance checks when available
- `git diff --check`

The update is complete only when the upstream record matches the copied
baseline and the relevant checks pass, or any environment-only limitation is
reported explicitly.
