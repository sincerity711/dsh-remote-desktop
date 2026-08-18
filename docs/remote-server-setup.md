# Remote server setup

The first release expects the remote dsh web profile to already be running on the remote machine and reachable from that machine's loopback interface.

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

The local plugin reads concrete `Host` entries from `~/.ssh/config`, connects with `ssh <alias>`, and creates a local tunnel to `127.0.0.1:<remote-port>` on the remote machine. It does not start or stop the remote dsh process in the first release.

Other remote plugins, such as `dsh-better-sidebar`, stay installed on the remote profile. They run inside the remote iframe and keep using root-relative paths like `/api/*`, `/plugins/*`, and `/sidebar/*`.
