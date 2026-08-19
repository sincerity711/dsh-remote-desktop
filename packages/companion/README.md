# dsh-remote-desktop-companion

Remote companion plugin for `dsh-remote-desktop`.

Install it in each remote DSH web profile that should be embedded by the local Remote Desktop controller. It runs only in `?dshRemoteDesktop=1` iframe mode, validates parent origin/token messages, opens requested remote sessions, and hides the embedded remote left sidebar.

## Install

```sh
dsh plugin --profile web add dsh-remote-desktop-companion
```

Before npm publication, install from a local checkout on the remote machine/profile:

```sh
dsh plugin --profile web add /path/to/dsh-remote-desktop/packages/companion
```

## Architecture

See the repository [architecture reference](https://github.com/sincerity711/dsh-remote-desktop/blob/main/docs/architecture.md) for iframe bridge, token validation, and companion behavior.
