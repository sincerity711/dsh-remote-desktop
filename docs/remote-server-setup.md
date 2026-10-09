# Remote server setup

For version-pinned AI-assisted setup, follow [the check/install/verify procedure](ai-remote-setup.md).

The local controller auto-connects SSH hosts whose remote web profile already has `dsh` and `dsh-ssh-workspace-companion` installed and reachable from that machine's loopback interface. Explicit Settings Connect first synchronizes the remote environment over SSH:

- DSH matches the exact version of the running local Desktop/Web installation. Missing or different DSH is installed under the remote user's `DSH_HOME/remote-desktop/managed/runtime/<version>`, without changing system Node or the global npm prefix.
- User plugins match the active local profile's installed versions and enabled states. `dsh-ssh-workspace` maps to the same-version companion. Local/file/private plugins are transferred as package archives; registry packages use exact versions. Incompatible remote-Web plugins fail with an actionable error.
- Remote-only user plugins are disabled, retaining package files. Sessions, settings, plugin configuration and credentials stay intact. Profile metadata is backed up before changes.
- Only a verified, integration-owned DSH service for the same home/port is restarted. Actual runtime/companion versions and health are verified before connection succeeds. Settings shows preparation stages and failures.

Remote Node.js 22+ and npm must already be available in the noninteractive SSH environment; the DSH plugin manager also needs pnpm. Connect reports missing prerequisites and does not assume sudo. Registry connectivity and access to exact versions are required. Custom remote homes can be supplied as an absolute `remoteDshHome` on the management API source, or exported in the SSH environment consistently for later connections; Settings does not add a separate home-path form.

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
dsh plugin --profile web add dsh-ssh-workspace-companion
```

Configure the local machine with a concrete SSH alias:

```sshconfig
Host win-wsl
  HostName win-wsl
  User your-user
```

The local plugin reads concrete `Host` entries from `~/.ssh/config`, connects with `ssh <alias>`, and creates a local tunnel to `127.0.0.1:<remote-port>` on the remote machine. Automatic startup only connects already prepared profiles and can reuse the user-owned managed DSH executable; explicit Connect is the environment synchronization path.

Other remote plugins, such as `dsh-better-sidebar`, stay installed on the remote profile. They run inside the remote iframe and keep using root-relative paths like `/api/*`, `/plugins/*`, and `/sidebar/*`.
