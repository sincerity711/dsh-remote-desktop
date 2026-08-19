# dsh-remote-desktop

Local controller plugin for Remote Desktop on DeepSeek Harness Web.

It discovers SSH hosts, creates loopback tunnels/proxies, contributes the Remote Desktop Settings section, and replaces the workspace sidebar with a unified local/remote workspace browser.

## Install

```sh
dsh plugin --profile web add dsh-remote-desktop
```

Before npm publication, install from a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-remote-desktop/packages/local
```

Remote hosts that already have `dsh` and `dsh-remote-desktop-companion` installed in the web profile connect automatically. The Settings Connect action runs `dsh plugin --profile web add dsh-remote-desktop-companion` over SSH, starts the remote web profile on the configured loopback port when needed, then connects.

## Architecture

See the repository [architecture reference](https://github.com/sincerity711/dsh-remote-desktop/blob/main/docs/architecture.md) for API routes, iframe bridge, sidebar projection, and setup flow.
