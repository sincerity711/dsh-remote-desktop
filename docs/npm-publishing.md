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
5. In GitHub repository Settings → Environments, create the `npm` environment. Optional required reviewers let you review each publication before it runs.

The workflow uses npm Trusted Publishing (OIDC), not a saved npm token. The runner uses Node 24 with an npm version supporting Trusted Publishing (npm 11.5.1 or newer). Do not push a release tag until both packages' trusted publishers are configured.

## Subsequent releases

Update both package versions together, commit the changes and push the commit, then create and push the matching tag:

```sh
git tag v0.2.1
git push origin v0.2.1
```

Use the actual new version in place of `0.2.1`. The `v*` tag triggers `.github/workflows/publish.yml`, verifies both versions match the tag, runs the static and unit checks, inspects package contents and publishes the companion followed by the local package with provenance. A rerun skips versions already published so a partial release can be resumed. Published versions cannot be overwritten; fixes require a new version.

A tag workflow publishes code from the tagged commit. Standard GitHub-hosted runners are free for public repositories; private repositories use the account's included Actions allowance. Public npm package publication is free.

## Existing local installations

The npm package names are new; internal plugin IDs, iframe protocol and isolated test homes retain their existing names. Remove the old locally installed bundle from the relevant DSH profile before adding the renamed package, so both bundles do not load together. Restart DSH after replacing packages.
