# OrbStack Docker Acceptance Design

## Goal

Replace the current local acceptance dependency on a developer-configured remote machine with two local Docker-backed remote hosts on macOS with OrbStack. The Docker hosts should preserve the real product path: key-only SSH, SSH tunnel creation, remote DSH Web, iframe isolation, the remote companion, and Better Sidebar running against a remote filesystem.

The acceptance environment remains useful after an automated run. The remote containers and their remote DSH processes stay running by default so a developer can continue manual validation without rebuilding or reconnecting the environment.

## Scope

In scope:

- A standard Docker Compose environment that runs two Linux containers, `remote-a` and `remote-b`, under OrbStack.
- Key-only SSH into each container through generated test-only SSH keys and a generated SSH config.
- Remote DSH Web inside each container on loopback port `30800`.
- P0 acceptance against `remote-a`.
- P1 acceptance against both `remote-a` and `remote-b` as separate SSH hosts.
- Default retention of remote containers and remote DSH processes after acceptance runs.
- A manual mode that keeps the local DSH Web process running and prints the browser URL and SSH commands.
- Documentation that makes Docker/OrbStack the recommended local acceptance path.

Out of scope:

- Linux CI support as a release requirement for this acceptance environment.
- OrbStack-specific VM APIs. The implementation uses only Docker and Docker Compose commands.
- Password SSH.
- Production deployment guidance for DSH in containers.
- Reuse of the developer's default `~/.ssh/config`, local `~/.dsh`, or remote `~/.dsh`.

## Approach

Use Docker Compose to manage two SSH containers. Each container represents a real remote host from the local DSH process's point of view.

```text
macOS + OrbStack
  Docker Compose project
    remote-a container
      sshd on container port 22
      Node.js 22 and pnpm
      DSH_HOME=/home/dsh/.dsh-remote-desktop-test
      dsh web --host 127.0.0.1 --port 30800
    remote-b container
      sshd on container port 22
      Node.js 22 and pnpm
      DSH_HOME=/home/dsh/.dsh-remote-desktop-test
      dsh web --host 127.0.0.1 --port 30800

  acceptance scripts
    generate .acceptance/docker/id_ed25519
    generate .acceptance/docker/ssh-config
    ssh -F .acceptance/docker/ssh-config remote-a ...
    ssh -F .acceptance/docker/ssh-config remote-b ...
```

The local Remote Desktop plugin discovers and connects to the generated SSH aliases, not to the user's real SSH hosts. The containers do not publish remote DSH Web directly to the host. The local plugin must still create SSH tunnels to reach each remote DSH instance.

## Files and commands

Add these files under the repository:

```text
scripts/acceptance/docker/
  Dockerfile.remote
  compose.yml
  entrypoint.sh
```

Add a Docker environment helper:

```text
scripts/acceptance/docker-env.mjs
```

The helper owns SSH key generation, Compose invocation, prerequisite checks, generated SSH config, manual-mode process startup, and cleanup.

Add npm scripts:

```json
{
  "acceptance:docker:up": "node scripts/acceptance/docker-env.mjs up",
  "acceptance:docker:p0": "node scripts/acceptance/e2e-win-wsl.mjs --docker-remotes",
  "acceptance:docker:p1": "node scripts/acceptance/p1-p2-win-wsl.mjs --docker-remotes",
  "acceptance:docker:all": "npm run acceptance:docker:up && npm run check && npm run acceptance:docker:p0 && npm run acceptance:docker:p1",
  "acceptance:docker:manual": "node scripts/acceptance/docker-env.mjs manual",
  "acceptance:docker:down": "node scripts/acceptance/docker-env.mjs down",
  "acceptance:docker:clean": "node scripts/acceptance/docker-env.mjs clean"
}
```

The existing external-host scripts remain available. Their current names can stay for the first implementation to avoid unnecessary churn, but `--docker-remotes` makes them use the generated Docker SSH aliases and config. A later cleanup may rename the scripts once the Docker path is stable.

## Container image

Use a small stable Linux base that supports native Node package builds reliably on OrbStack. `ubuntu:24.04` is preferred over Alpine because DSH dependencies and Better Sidebar dependencies are closer to the current Linux host assumptions.

The image includes:

- `openssh-server`
- `bash`
- `curl`
- `git`
- `ca-certificates`
- `build-essential`
- `python3`
- Node.js 22
- Corepack and pnpm
- a non-root `dsh` user

The image does not include credentials, the generated SSH key, the local plugin package, or the companion package. Acceptance scripts copy the current companion package into the container and install it in the remote test profile, preserving the existing requirement that acceptance validates the local artifact under test.

The entrypoint reads `/acceptance/authorized_keys`, installs it as `/home/dsh/.ssh/authorized_keys`, starts `sshd`, and keeps the container alive. If the key file is missing or empty, the container exits with a clear message.

## Compose environment

`compose.yml` defines two services with separate home volumes and loopback-only SSH port bindings:

```yaml
services:
  remote-a:
    build:
      context: ../../..
      dockerfile: scripts/acceptance/docker/Dockerfile.remote
    ports:
      - "127.0.0.1:${DSH_RD_REMOTE_A_SSH_PORT:-30221}:22"
    volumes:
      - ../../../.acceptance/docker/authorized_keys:/acceptance/authorized_keys:ro
      - remote-a-home:/home/dsh
    environment:
      DSH_REMOTE_ID: remote-a

  remote-b:
    build:
      context: ../../..
      dockerfile: scripts/acceptance/docker/Dockerfile.remote
    ports:
      - "127.0.0.1:${DSH_RD_REMOTE_B_SSH_PORT:-30222}:22"
    volumes:
      - ../../../.acceptance/docker/authorized_keys:/acceptance/authorized_keys:ro
      - remote-b-home:/home/dsh
    environment:
      DSH_REMOTE_ID: remote-b
```

Default host ports are `30221` for `remote-a` and `30222` for `remote-b`. They can be overridden with `DSH_RD_REMOTE_A_SSH_PORT` and `DSH_RD_REMOTE_B_SSH_PORT` when a port is occupied.

Remote DSH Web listens only inside each container at `127.0.0.1:30800`. Keeping it unpublished ensures the acceptance run still validates SSH tunnel creation and per-source proxying.

## SSH identity and host discovery

`acceptance:docker:up` creates or refreshes these files:

```text
.acceptance/docker/id_ed25519
.acceptance/docker/id_ed25519.pub
.acceptance/docker/authorized_keys
.acceptance/docker/known_hosts
.acceptance/docker/ssh-config
```

The generated SSH config contains only Docker acceptance hosts:

```sshconfig
Host remote-a
  HostName 127.0.0.1
  Port 30221
  User dsh
  IdentityFile /absolute/path/.acceptance/docker/id_ed25519
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking no
  UserKnownHostsFile /absolute/path/.acceptance/docker/known_hosts

Host remote-b
  HostName 127.0.0.1
  Port 30222
  User dsh
  IdentityFile /absolute/path/.acceptance/docker/id_ed25519
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking no
  UserKnownHostsFile /absolute/path/.acceptance/docker/known_hosts
```

Local DSH Web runs with:

```sh
DSH_REMOTE_DESKTOP_SSH_CONFIG=/absolute/path/.acceptance/docker/ssh-config
```

This keeps host discovery deterministic and prevents acceptance from reading the developer's normal SSH config.

## P0 flow

With `--docker-remotes`, P0 uses `remote-a` as the SSH destination.

The setup phase:

1. Verify Docker and Docker Compose are available.
2. Verify the Compose project is running, or fail with an instruction to run `npm run acceptance:docker:up`.
3. Verify `ssh -F .acceptance/docker/ssh-config remote-a true` succeeds.
4. Reset only the container's test DSH home and sentinel path.
5. Copy the local companion package into `/tmp/dsh-remote-desktop-companion`.
6. Install or update `@deepseek-ai/dsh`, `dsh-better-sidebar`, and the copied companion in the remote test profile.
7. Start remote DSH Web on `127.0.0.1:30800` inside `remote-a`.
8. Start local DSH Web with the generated Docker SSH config.
9. Connect the `remote-a` source through the existing management API.
10. Run the existing P0 browser assertions.
11. Save artifacts.

The acceptance item names may continue to use their current P0 categories, but evidence should identify `remote-a` instead of `win-wsl`.

## P1 flow

With `--docker-remotes`, P1 uses two real SSH destinations:

```text
remote-a -> source id remote-a
remote-b -> source id remote-b
```

Each container can use the same remote web port and the same remote test paths because their filesystems and process namespaces are separate. Sentinel contents still differ so artifacts can prove which remote produced each result:

```text
remote-a: REMOTE_SENTINEL_A
remote-b: REMOTE_SENTINEL_B
```

This is stronger than the current two-profile setup on one SSH destination. It validates two SSH hosts, two remote filesystems, two remote DSH processes, two tunnel targets, two iframe origins, and token isolation between two independent containers.

## Retained environment and manual validation

Acceptance does not run `docker compose down` at the end. By default:

- `remote-a` and `remote-b` containers stay running.
- Remote DSH Web processes started by acceptance stay running.
- `.acceptance/docker/ssh-config` stays available for manual SSH.
- Artifacts remain under `.acceptance/artifacts/`.
- The local DSH Web process started by automated P0/P1 stops when the script exits.

Add `--keep-local-dsh` to P0 and P1 scripts. When set, the script leaves the local DSH Web process running and prints the local browser URL, SSH commands, remote log locations, and cleanup commands.

`acceptance:docker:manual` prepares the same environment without running browser assertions. It starts or verifies both containers, prepares the generated SSH config, starts remote DSH Web in both containers, starts local DSH Web, and prints manual entry points:

```text
Manual environment ready.

Local DSH:
  http://127.0.0.1:<local-port>

SSH:
  ssh -F /absolute/path/.acceptance/docker/ssh-config remote-a
  ssh -F /absolute/path/.acceptance/docker/ssh-config remote-b

Cleanup:
  npm run acceptance:docker:down
```

## Cleanup

`acceptance:docker:down` stops and deletes the Compose containers and network while preserving named volumes, generated SSH files, and artifacts. This is the fast stop command for a developer who wants to resume later.

`acceptance:docker:clean` performs a destructive cleanup:

- runs Compose down with volumes removed,
- deletes `.acceptance/docker`,
- deletes Docker local DSH homes used by acceptance,
- preserves `.acceptance/artifacts` unless the user passes an explicit artifacts flag.

Automated P0/P1 runs reset only the test DSH homes and sentinel directories inside the containers. They do not rebuild or delete containers by default.

## Error handling

The Docker environment helper should fail early with actionable messages:

- Docker daemon unavailable: ask the developer to start OrbStack.
- Docker Compose unavailable: ask the developer to enable or install Docker Compose.
- SSH port occupied: name the port and the override variable.
- Compose project not running: ask the developer to run `npm run acceptance:docker:up`.
- SSH connection failure: print a diagnostic command using the generated SSH config.
- Remote Node.js too old: treat it as an image/setup bug and identify the container.
- pnpm install failure: save the install log into the current artifact directory.
- Remote DSH boot failure: save remote DSH logs and keep containers for inspection.

Failure paths keep the containers running unless the user explicitly runs `down` or `clean`.

## Documentation updates

Update `docs/acceptance.md` to describe Docker/OrbStack as the recommended local acceptance path. The existing external SSH-host path remains documented as an advanced path for testing against a real remote host.

Update `README.md` development instructions with the Docker acceptance commands and the manual validation mode.

Update `AGENTS.md` to say acceptance should prefer the Docker/OrbStack environment over developer-specific SSH hosts, and that acceptance containers are retained by default.

## Acceptance criteria

The implementation is complete when these facts are proven by scripts or documentation:

- `npm run acceptance:docker:up` starts `remote-a` and `remote-b` under Docker Compose.
- Key-only SSH succeeds for both generated aliases using `.acceptance/docker/ssh-config`.
- P0 with `--docker-remotes` connects to `remote-a` and passes the existing P0 user path.
- P1 with `--docker-remotes` connects to `remote-a` and `remote-b` as separate SSH hosts.
- P1 evidence proves `REMOTE_SENTINEL_A` and `REMOTE_SENTINEL_B` come from different containers.
- Local acceptance does not read the user's default `~/.ssh/config`.
- Remote acceptance does not mutate a remote default `~/.dsh`; it uses only the container test home.
- Automated acceptance leaves the two remote containers running by default.
- `--keep-local-dsh` leaves the local DSH Web process running and prints the browser URL.
- `acceptance:docker:manual` prepares a retained manual validation environment.
- `acceptance:docker:down` stops the retained environment.
- `acceptance:docker:clean` removes containers, volumes, and generated Docker acceptance state.

## Implementation order

1. Add Dockerfile, entrypoint, Compose file, and Docker environment helper.
2. Add generated SSH key/config creation and Docker prerequisite checks.
3. Add `--docker-remotes` to P0 and wire it to `remote-a`.
4. Add `--docker-remotes` to P1 and wire it to `remote-a` and `remote-b`.
5. Add `--keep-local-dsh` and `acceptance:docker:manual`.
6. Update `docs/acceptance.md`, `README.md`, and `AGENTS.md`.
7. Validate with `npm run check`, `npm run acceptance:docker:up`, `npm run acceptance:docker:p0`, and `npm run acceptance:docker:p1` on macOS with OrbStack.
