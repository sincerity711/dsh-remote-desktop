# dsh-remote-desktop

A dsh plugin pair for connecting remote dsh web instances from an existing local dsh web page.

- Install `dsh-remote-desktop` locally.
- Install `dsh-remote-desktop-companion` on each remote dsh profile.
- Run remote dsh web on the remote machine, reachable on loopback from SSH.
- Define remote machines as concrete `Host` entries in the local `~/.ssh/config`.

The local sidebar is project-first: local and connected remote workspaces appear as project rows in one list. Remote project rows carry a small host badge such as `win-wsl` or `xsn` instead of being grouped under a remote-source header.
