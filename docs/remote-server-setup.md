# Remote server setup

The local controller auto-connects SSH hosts whose remote web profile already has `dsh` and `dsh-remote-desktop-companion` installed and reachable from that machine's loopback interface. The Settings Connect action installs the companion over SSH, starts the remote web profile on the configured loopback port when needed, then connects.

Example remote command:

```sh
DSH_HOME=$HOME/.dsh-remote-desktop-test \
  dsh --profile web \
  --host 127.0.0.1 \
  --port 30800 \
  --trusted-host 127.0.0.1:30800
```

Install the companion on the remote profile:

```sh
dsh plugin --profile web add dsh-remote-desktop-companion
```

Configure the local machine with a concrete SSH alias:

```sshconfig
Host win-wsl
  HostName win-wsl
  User your-user
```

The local plugin reads concrete `Host` entries from `~/.ssh/config`, connects with `ssh <alias>`, and creates a local tunnel to `127.0.0.1:<remote-port>` on the remote machine. Automatic startup only connects already prepared profiles; the explicit Connect action is the setup path for installing the companion and starting remote DSH.

Other remote plugins, such as `dsh-better-sidebar`, stay installed on the remote profile. They run inside the remote iframe and keep using root-relative paths like `/api/*`, `/plugins/*`, and `/sidebar/*`.
