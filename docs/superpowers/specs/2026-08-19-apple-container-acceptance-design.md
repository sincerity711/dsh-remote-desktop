# Apple Container Acceptance Design

## Goal

Replace the current local acceptance dependency on a developer-configured remote machine with two local Apple container-backed remote hosts on macOS. The Apple container hosts should preserve the real product path: key-only SSH, SSH tunnel creation, remote DSH Web, iframe isolation, the remote companion, and Better Sidebar running against a remote filesystem.

The acceptance environment remains useful after an automated run. The remote containers and their remote DSH processes stay running by default so a developer can continue manual validation without rebuilding or reconnecting the environment.

## Scope

In scope:

- An Apple `container` environment that runs two Linux containers, `remote-a` and `remote-b`.
- Key-only SSH into each container through generated test-only SSH keys and a generated SSH config.
- Remote DSH Web inside each container on loopback port `30800`.
- P0 acceptance against `remote-a`.
- P1 acceptance against both `remote-a` and `remote-b` as separate SSH hosts.
- Default retention of remote containers and remote DSH processes after acceptance runs.
- A manual mode that keeps the local DSH Web process running and prints the browser URL and SSH commands.
- Documentation that makes Apple container the recommended local acceptance path.

Out of scope:

- Linux CI support as a release requirement for this acceptance environment.
- Apple container-specific VM APIs. The implementation uses only Apple container commands.
- Password SSH.
- Production deployment guidance for DSH in containers.
- Reuse of the developer's default `~/.ssh/config`, local `~/.dsh`, or remote `~/.dsh`.

## Approach

Use Apple container to manage two SSH containers. Each container represents a real remote host from the local DSH process's point of view.

```text
macOS + Apple container
  Apple container project
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
    generate .acceptance/container/id_ed25519
    generate .acceptance/container/ssh-config
    ssh -F .acceptance/container/ssh-config remote-a ...
    ssh -F .acceptance/container/ssh-config remote-b ...
```

The local Remote Desktop plugin discovers and connects to the generated SSH aliases, not to the user's real SSH hosts. The containers do not publish remote DSH Web directly to the host. The local plugin must still create SSH tunnels to reach each remote DSH instance.

## Files and commands

Add these files under the repository:

```text
scripts/acceptance/container/
  Dockerfile.remote
  entrypoint.sh
```

Add an Apple container environment helper:

```text
scripts/acceptance/container-env.mjs
```

The helper owns SSH key generation, container CLI invocation, prerequisite checks, generated SSH config, manual-mode process startup, and cleanup.

Add npm scripts:

```json
{
  "acceptance:container:up": "node scripts/acceptance/container-env.mjs up",
  "acceptance:container:p0": "node scripts/acceptance/e2e-win-wsl.mjs --container-remotes",
  "acceptance:container:p1": "node scripts/acceptance/p1-p2-win-wsl.mjs --container-remotes",
  "acceptance:container:all": "npm run acceptance:container:up && npm run check && npm run acceptance:container:p0 && npm run acceptance:container:p1",
  "acceptance:container:manual": "node scripts/acceptance/container-env.mjs manual",
  "acceptance:container:down": "node scripts/acceptance/container-env.mjs down",
  "acceptance:container:clean": "node scripts/acceptance/container-env.mjs clean"
}
```

The existing external-host scripts remain available. Their current names can stay for the first implementation to avoid unnecessary churn, but `--container-remotes` makes them use the generated Apple container SSH aliases and config. A later cleanup may rename the scripts once the Apple container path is stable.

## Container image

The remote image is built with Apple `container build` from `scripts/acceptance/container/Dockerfile.remote`. It uses `mcr.microsoft.com/devcontainers/javascript-node:22-bookworm` because that image already includes Node 22, pnpm/corepack support, Python, and native build tools. Apple container networking in the test environment can pull images but does not provide reliable outbound DNS from running containers, so the helper downloads the required Debian OpenSSH `.deb` files on the macOS host and the Dockerfile installs them offline with `dpkg -i`.

The image includes:

- OpenSSH server and SFTP server,
- Node.js 22,
- Corepack and pnpm,
- native build tools from the devcontainer base,
- a non-root `dsh` user,
- `/usr/local/bin/dsh` shim that points to the `dsh` user's npm global install path.

The entrypoint reads the generated public key from `DSH_AUTHORIZED_KEYS`, installs it as `/home/dsh/.ssh/authorized_keys`, starts `sshd`, and keeps the container alive.

## Apple container environment

`acceptance:container:up` starts two named containers, `dsh-rd-remote-a` and `dsh-rd-remote-b`, from the remote image. It does not rely on Apple container host-port publishing. Instead, generated SSH config entries use `ProxyCommand container exec -i <container> socat - TCP:127.0.0.1:22`. The product and tests still use real `ssh`, including `ssh -L` tunnels, but the transport into each local container uses Apple container exec as the byte pipe.

Remote DSH Web listens only inside each container at `127.0.0.1:30800`. Keeping it unpublished ensures the acceptance run still validates SSH tunnel creation and per-source proxying.

The helper also starts a small host-side HTTP CONNECT proxy during remote package installation. Containers can reach the macOS host gateway but do not have direct outbound internet in this environment, so remote npm/pnpm installs use that proxy.

## SSH identity and host discovery

`acceptance:container:up` creates or refreshes these files:

```text
.acceptance/container/id_ed25519
.acceptance/container/id_ed25519.pub
.acceptance/container/authorized_keys
.acceptance/container/known_hosts
.acceptance/container/ssh-config
```

The generated SSH config contains only Apple container acceptance hosts. Each host uses key-only auth and a ProxyCommand into the matching container:

```sshconfig
Host remote-a
  HostName remote-a
  User dsh
  IdentityFile /absolute/path/.acceptance/container/id_ed25519
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking no
  UserKnownHostsFile /absolute/path/.acceptance/container/known_hosts
  ProxyCommand container exec -i dsh-rd-remote-a socat - TCP:127.0.0.1:22
```

Local DSH Web runs with:

```sh
DSH_REMOTE_DESKTOP_SSH_CONFIG=/absolute/path/.acceptance/container/ssh-config
DSH_REMOTE_DESKTOP_SKIP_SETUP=1
```

The skip-setup flag is used only for this retained local test environment because the scripts already start remote DSH Web inside each container.

This keeps host discovery deterministic and prevents acceptance from reading the developer's normal SSH config.

## P0 flow

With `--container-remotes`, P0 uses `remote-a` as the SSH destination.

The setup phase:

1. Verify Apple `container` is installed and `container system start` succeeds.
2. Verify `acceptance:container:up` has started the two named containers.
3. Verify `ssh -F .acceptance/container/ssh-config remote-a true` succeeds.
4. Reset only the container's test DSH home and sentinel path.
5. Copy the local companion package into `/tmp/dsh-remote-desktop-companion`.
6. Install or update `@deepseek-ai/dsh`, `dsh-better-sidebar`, and the copied companion in the remote test profile.
7. Start remote DSH Web on `127.0.0.1:30800` inside `remote-a`.
8. Start local DSH Web with the generated Apple container SSH config.
9. Connect the `remote-a` source through the existing management API.
10. Run the existing P0 browser assertions.
11. Save artifacts.

The acceptance item names may continue to use their current P0 categories, but evidence should identify `remote-a` instead of `win-wsl`.

## P1 flow

With `--container-remotes`, P1 uses two real SSH destinations:

```text
remote-a -> source id remote-a
remote-b -> source id remote-b
```

Each container uses the same remote web port and source-specific sentinel paths so artifacts can prove which remote produced each result:

```text
remote-a: /tmp/dsh-rd-p1-a -> REMOTE_SENTINEL_A
remote-b: /tmp/dsh-rd-p1-b -> REMOTE_SENTINEL_B
```

This is stronger than the current two-profile setup on one SSH destination. It validates two SSH hosts, two remote filesystems, two remote DSH processes, two tunnel targets, two iframe origins, and token isolation between two independent containers.

## Seeded test data

The Apple container acceptance environment should create realistic test data for both automated checks and manual inspection. The seed data must be deterministic enough for assertions while still making the retained UI useful after a run.

Seeded data includes:

- one local workspace and at least two local sessions with recognizable titles,
- one remote workspace and at least two remote sessions on `remote-a`,
- one remote workspace and at least two remote sessions on `remote-b` for P1 and manual mode,
- sentinel files inside each remote workspace that prove filesystem and terminal operations are executing on the owning container,
- short user/assistant transcript content so the session list and opened chats are visually meaningful during manual validation.

The retained canary requires the developer's local `minicpm-v4.6:1b` model exposed by Ollama on the macOS host. It writes an `ollama` pi-ai provider and the shared default-model selection into the local and remote canary settings. Remote providers reach Ollama through the host proxy that remains alive with the canary process. Startup verifies the model exists and that every created canary session reports it as routable; an unavailable service or missing model fails with a command such as `ollama pull minicpm-v4.6:1b`. P0 and P1 remain independent of Ollama.

Model-backed data is not part of the P0/P1 pass criteria. Automated assertions continue to use stable IDs, sentinel files, source states, iframe origins, and UI markers. The model text is for manual readability and for exercising transcript rendering with a local, keyless model.

Manual mode enables richer seed data by default. It should create a small spread of sessions, for example:

```text
Local
  Local notes - Apple container acceptance overview
  Local debugging checklist

remote-a
  Remote A sentinel walkthrough
  Remote A terminal check

remote-b
  Remote B isolation walkthrough
  Remote B settings check
```

The seed step uses Ollama after the availability check and may fall back to static fixture text when generation itself times out or fails. It must not call any external hosted model provider and must not require `DEEPSEEK_API_KEY`.

## Retained environment and manual validation

Acceptance does not run `container delete` at the end. By default:

- `remote-a` and `remote-b` containers stay running.
- Remote DSH Web processes started by acceptance stay running.
- `.acceptance/container/ssh-config` stays available for manual SSH.
- Artifacts remain under `.acceptance/artifacts/`.
- The local DSH Web process started by automated P0/P1 stops when the script exits.

Add `--keep-local-dsh` to P0 and P1 scripts. When set, the script leaves the local DSH Web process running and prints the local browser URL, SSH commands, remote log locations, and cleanup commands.

`acceptance:container:manual` prepares the same environment without running browser assertions. It starts or verifies both containers, prepares the generated SSH config, starts remote DSH Web in both containers, starts local DSH Web, and prints manual entry points:

```text
Manual environment ready.

Local DSH:
  http://127.0.0.1:<local-port>

SSH:
  ssh -F /absolute/path/.acceptance/container/ssh-config remote-a
  ssh -F /absolute/path/.acceptance/container/ssh-config remote-b

Cleanup:
  npm run acceptance:container:down
```

## Cleanup

`acceptance:container:down` stops and deletes the Apple containers while preserving generated SSH files, local profiles, downloaded image inputs, and artifacts. This is the fast stop command for a developer who wants to recreate the remotes without removing the retained acceptance state.

`acceptance:container:clean` performs a destructive cleanup:

- deletes the named Apple containers,
- deletes `.acceptance/container`,
- deletes Apple container local DSH homes used by acceptance,
- preserves `.acceptance/artifacts` unless the user passes an explicit artifacts flag.

Automated P0/P1 runs reset only the test DSH homes and sentinel directories inside the containers. They do not rebuild or delete containers by default.

## Error handling

The Apple container environment helper should fail early with actionable messages:

- Apple container system unavailable: ask the developer to run `container system start`.
- Apple container unavailable: ask the developer to enable or install Apple container.
- Remote containers missing: ask the developer to run `npm run acceptance:container:up`.
- SSH connection failure: print a diagnostic command using the generated SSH config.
- Remote Node.js too old: treat it as an image/setup bug and identify the container.
- pnpm install failure: save the install log into the current artifact directory.
- Remote DSH boot failure: save remote DSH logs and keep containers for inspection.

Failure paths keep the containers running unless the user explicitly runs `down` or `clean`.

## Documentation updates

Update `docs/acceptance.md` to describe Apple container as the recommended local acceptance path. The existing external SSH-host path remains documented as an advanced path for testing against a real remote host.

Update `README.md` development instructions with the Apple container acceptance commands and the manual validation mode.

Update `AGENTS.md` to say acceptance should prefer the Apple container environment over developer-specific SSH hosts, and that acceptance containers are retained by default.

## Acceptance criteria

The implementation is complete when these facts are proven by scripts or documentation:

- `npm run acceptance:container:up` starts `remote-a` and `remote-b` with Apple container.
- Key-only SSH succeeds for both generated aliases using `.acceptance/container/ssh-config`.
- P0 with `--container-remotes` connects to `remote-a` and passes the existing P0 user path.
- P1 with `--container-remotes` connects to `remote-a` and `remote-b` as separate SSH hosts.
- P1 evidence proves `REMOTE_SENTINEL_A` and `REMOTE_SENTINEL_B` come from different containers.
- Local acceptance does not read the user's default `~/.ssh/config`.
- Remote acceptance does not mutate a remote default `~/.dsh`; it uses only the container test home.
- Automated acceptance leaves the two remote containers running by default.
- `--keep-local-dsh` leaves the local DSH Web process running and prints the browser URL.
- `acceptance:container:manual` prepares a retained manual validation environment.
- `acceptance:container:down` stops the retained environment.
- `acceptance:container:clean` removes containers, volumes, and generated Apple container acceptance state.
- Manual mode creates local and remote seeded sessions with recognizable titles and transcript content.
- Canary sessions use host Ollama `minicpm-v4.6:1b` as their verified default; P0/P1 remain model-independent, and canary seed generation may fall back to static text after model availability succeeds.

## Implementation order

1. Add remote image Dockerfile, entrypoint, and Apple container environment helper.
2. Add generated SSH key/config creation and Apple container prerequisite checks.
3. Add `--container-remotes` to P0 and wire it to `remote-a`.
4. Add `--container-remotes` to P1 and wire it to `remote-a` and `remote-b`.
5. Add `--keep-local-dsh` and `acceptance:container:manual`.
6. Add seeded local and remote session data, with optional host Ollama `minicpm-v4.6:1b` transcript generation.
7. Update `docs/acceptance.md`, `README.md`, and `AGENTS.md`.
8. Validate with `npm run check`, `npm run acceptance:container:up`, `npm run acceptance:container:p0`, and `npm run acceptance:container:p1` on macOS with Apple container.
