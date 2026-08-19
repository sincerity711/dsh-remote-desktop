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

Install `dsh-remote-desktop-companion` in each remote DSH web profile that this local controller should embed.

## Architecture

See the repository [architecture reference](https://github.com/sincerity711/dsh-remote-desktop/blob/main/docs/architecture.md) for API routes, iframe bridge, sidebar projection, and setup flow.
