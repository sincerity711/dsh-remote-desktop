# Publishing to npm

`dsh-ssh-workspace` and `dsh-ssh-workspace-companion` publish to https://registry.npmjs.org/. Public npm mirrors sync from that registry; do not publish separately to mirrors.

## First release

1. Create an npm account with two-factor authentication and run `npm login --registry=https://registry.npmjs.org/` locally.
2. Run `npm run check` and inspect both packages with `npm pack --workspace packages/local --dry-run` and `npm pack --workspace packages/companion --dry-run`.
3. Publish both public packages once:

   ```sh
   npm publish --workspace packages/companion --access public --registry=https://registry.npmjs.org/
   npm publish --workspace packages/local --access public --registry=https://registry.npmjs.org/
   ```

4. On npmjs.com, open each package's Settings → Trusted Publisher and configure GitHub Actions with:
   - Organization/user: `sincerity711`
   - Repository: `dsh-ssh-workspace`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
   - Permission: `npm publish` (direct publishing)
5. In GitHub repository Settings → Environments, create the `npm` environment. Optional required reviewers let you review each publication before it runs.

The workflow uses npm Trusted Publishing (OIDC), not a saved npm token. The runner uses the latest Node 24 and explicitly installs npm 12.2.0 for publishing. Do not push a release tag until both packages' trusted publishers are configured.

## Subsequent releases

Update both package versions together, commit the changes and push the commit, then create and push the matching tag:

```sh
git tag v0.2.1
git push origin v0.2.1
```

Use the actual new version in place of `0.2.1`. The `v*` tag triggers `.github/workflows/publish.yml`, verifies both versions match the tag, runs the static and unit checks, inspects package contents and publishes the companion followed by the local package with provenance. A rerun skips versions already published so a partial release can be resumed. Published versions cannot be overwritten; fixes require a new version.

A tag workflow publishes code from the tagged commit. Standard GitHub-hosted runners are free for public repositories; private repositories use the account's included Actions allowance. Public npm package publication is free.

## Existing local installations

The npm package names are new; host/client module IDs match the new package names; iframe protocol and isolated test homes retain their existing names. Remove the old locally installed bundle from the relevant DSH profile before adding the renamed package, so both bundles do not load together. Restart DSH after replacing packages.

## Direct and staged permissions

Both trusted publishers must grant `npm publish` for this workflow's direct publication. No interactive security-key approval is required during an authorized OIDC run. A publisher granting only `npm stage publish` requires changing the workflow to `npm stage publish` and approving each staged version with a security key after automated review finishes.

If a tag run failed before publishing, the workflow can also be dispatched from `main` with the matching version input. No tag needs to be moved. Package READMEs are English first, followed by Simplified Chinese, and update on npm with each published version.
