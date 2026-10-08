---
name: setup-remote
description: Check and install matching DSH and dsh-ssh-workspace-companion versions on an SSH host for dsh-ssh-workspace.
---

# Set up a remote DSH workspace

Use the check → install → verify procedure below. Extended examples and bilingual prompts are available in [the setup guide](https://github.com/sincerity711/dsh-ssh-workspace/blob/main/docs/ai-remote-setup.md).

Collect the SSH alias, actual local DSH runtime version, installed local dsh-ssh-workspace version, and intended remote DSH home before installing. Do not infer the Desktop version from the separately installed CLI. Pin remote DSH to the actual local runtime version and companion to the installed local plugin version. Never use `latest` as a substitute for either.

Begin with read-only checks. Report a version/profile matrix. When the user requested installation, install missing or mismatched components within that scope and verify the result. Preserve remote sessions, settings and unrelated plugins. Do not run tests against the user's normal DSH home. Report failures with evidence; a successful npm installation alone is not successful setup.

## Procedure

1. Read local Desktop About/app metadata or the CLI version actually running local Web. Read the installed local plugin manifest from the active profile. Current plugin 0.2.x declares DSH `0.2.0-rc.2` compatibility; matching another runtime remotely does not itself establish compatibility.
2. Through the configured SSH alias, inspect Node/npm/DSH versions, noninteractive PATH, remote home, Web profile, companion dependency/bundle and port 30800. Check `npm view @deepseek-ai/dsh@<exact-version> engines` before choosing Node. Use user-level installation when possible.
3. In the intended remote home, install `@deepseek-ai/dsh@<local-runtime-version>` using npm, then run `DSH_HOME=<remote-home> dsh plugin --profile web add dsh-ssh-workspace-companion@<local-plugin-version>`. Skip components already correct. Back up existing profile configuration and replace an old companion bundle instead of loading both.
4. Start or reuse DSH Web bound to `127.0.0.1:30800`, with `--trusted-host 127.0.0.1:30800`, from that same home. Identify an existing process before restarting it. Verify `/remote-desktop-companion/api/health` returns success and the expected companion name. For 0.2.4 onward that name is `dsh-ssh-workspace-companion`.
5. Verify the local Remote Desktop connection, open a remote session and switch back to local. Report any GUI check you could not perform. Summarize versions, profile home, port and results.

A one-off exported custom home does not configure later SSH connections. The current local Connect action can install an unpinned companion; recheck versions after using it. Report unavailable versions and repeated install failures rather than substituting latest or repeatedly retrying unchanged commands.
