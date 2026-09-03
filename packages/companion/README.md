# dsh-remote-desktop-companion

Remote companion plugin for `dsh-remote-desktop`.

Install it in each remote DSH web profile that should be embedded by the local Remote Desktop controller. It exposes only a transitional local health endpoint, runs only in `?dshRemoteDesktop=1` iframe mode, validates parent origin/token messages, forwards official Client Controller state and commands over a versioned `MessageChannel`, opens requested remote sessions, and hides the embedded remote left sidebar.

The companion does not expose Session/Workspace snapshot or RPC Host APIs. The authenticated remote DSH Gateway and its official `ctx.sessions` / `ctx.workspaces` services remain the only business-data path.

## Install

```sh
dsh plugin --profile web add dsh-remote-desktop-companion
```

Before npm publication, install from a local checkout on the remote machine/profile:

```sh
dsh plugin --profile web add /path/to/dsh-remote-desktop/packages/companion
```

The iframe client source is `src/client.js`; `lib/client.js` is generated with
the repository-level `npm run build` command.

## Architecture

See the repository [architecture reference](https://github.com/sincerity711/dsh-remote-desktop/blob/main/docs/architecture.md) for iframe bridge, token validation, and companion behavior.
