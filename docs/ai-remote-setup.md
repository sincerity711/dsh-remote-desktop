# AI-assisted remote setup / AI 辅助远程安装

Use this procedure from an AI coding assistant with local terminal and SSH access. It checks the actual local runtime, pins matching remote versions, preserves existing data, and verifies the running service. The assistant must read this document; a URL pasted into a terminal is not an installer.

## A prompt to give your AI assistant

```text
Set up remote DSH for dsh-ssh-workspace on SSH host <HOST_ALIAS>.
Read https://github.com/sincerity711/dsh-ssh-workspace/blob/main/docs/ai-remote-setup.md
(or docs/ai-remote-setup.md in my checkout) and follow its check/install/verify procedure.
First determine my actual local DSH Desktop or Web runtime version and installed
local dsh-ssh-workspace version. Install that exact DSH version on the remote host
and the matching dsh-ssh-workspace-companion version in the remote Web profile.
Preserve existing sessions, settings and other plugins. Verify the remote service
and report the versions, DSH_HOME, port and connection result.
```

Replace `<HOST_ALIAS>` with a concrete entry from local `~/.ssh/config`. An optional reusable skill is included at `skills/setup-remote/SKILL.md`; install it using your assistant's skill mechanism before invoking `setup-remote` as a skill.

## 1. Identify the local versions

Record these separately:

| Component | Required evidence | Remote target |
| --- | --- | --- |
| Local DSH runtime | Desktop About/app metadata, or version of the CLI actually running local Web | Same exact DSH version |
| Local dsh-ssh-workspace | Plugin page or installed package manifest in the active profile | Same exact companion version |
| Profile | Active local profile and intended remote Web profile home | Install/start against the same remote home |

`dsh --version` reports the CLI on PATH, which may differ from Desktop. On macOS, the installed Desktop version can be read without modifying it:

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' '/Applications/DeepSeek Harness.app/Contents/Info.plist'
```

Read the installed local plugin's `package.json` under the active profile's `node_modules/dsh-ssh-workspace/`, not the repository manifest. Desktop normally uses `~/.dsh/profiles/desktop`; Web normally uses `~/.dsh/profiles/web`. Respect custom homes.

Plugin 0.2.x currently declares DSH `0.2.0-rc.2` compatibility. If the actual local runtime is another version, matching it remotely is necessary but does not establish plugin compatibility. Explain the mismatch and check compatibility before modifying DSH versions. Do not silently upgrade the local Desktop.

## 2. Read-only remote checks

Use the user's configured SSH alias, preserving its SSH configuration. Quote any interpolated values safely. A POSIX remote check can start with:

```sh
ssh <HOST_ALIAS> 'command -v node; command -v npm; command -v dsh; node --version; npm --version; dsh --version'
```

Check the intended remote `DSH_HOME`, `profiles/web/package.json`, installed companion version, registered bundle, running DSH process and port `30800`. Do not print settings files or credentials. Inspect npm's configured registry and connectivity if downloads fail. Report missing commands distinctly from authentication or network failures.

If Node/npm is missing, use the remote OS's supported installation method and satisfy the exact DSH package's `engines` requirements. Prefer a user-level installation; do not assume sudo access or overwrite system Node. If a noninteractive SSH shell cannot find an existing Node/DSH installation, fix the PATH/startup environment rather than installing duplicates.

## 3. Install exact versions

Set `DSH_VERSION` to the verified local runtime version and `PLUGIN_VERSION` to the verified installed local plugin version. They are different version numbers. The following is a remote POSIX-shell example, not a command to run on the local machine:

```sh
DSH_VERSION=0.2.0-rc.2
PLUGIN_VERSION=0.2.5
# Use the user's intended home. Export it for both installation and startup.
export DSH_HOME="$HOME/.dsh"

npm view "@deepseek-ai/dsh@$DSH_VERSION" engines --json --registry=https://registry.npmjs.org/
npm view "dsh-ssh-workspace-companion@$PLUGIN_VERSION" version --registry=https://registry.npmjs.org/
npm install --global "@deepseek-ai/dsh@$DSH_VERSION" --registry=https://registry.npmjs.org/
dsh plugin --profile web add "dsh-ssh-workspace-companion@$PLUGIN_VERSION"
```

The example versions must be replaced with the observed versions. Skip installation when the existing version/profile is already correct. Check registry resolution rather than treating a missing-version error as permission to install `latest`.

For an existing profile, back up its package/configuration files before changing dependencies. If the old `dsh-remote-desktop-companion` bundle is present, replace it with the renamed companion; avoid loading both. Preserve all unrelated bundles and all sessions. Never clear a DSH home or npm cache as a default repair step.

The local Connect action now reconciles exact DSH and user-plugin versions with the active local profile, maps SSH Workspace to its companion, and disables remote-only user plugins. Manual preparation remains useful for prerequisite setup and diagnosis. Supply a custom remote home as the source's absolute `remoteDshHome` in the management API, or make it visible in the SSH environment used by the local plugin; exporting a home only in a one-off setup shell does not configure later connections.

## 4. Start and verify

If port `30800` already belongs to a DSH process, identify its home/version before reusing or restarting it. Do not kill unrelated processes. Use the remote's service manager when available. A foreground smoke check is:

```sh
export DSH_HOME="$HOME/.dsh"
dsh --profile web --host 127.0.0.1 --port 30800 --trusted-host 127.0.0.1:30800
```

Bind to loopback; SSH provides the tunnel. Arrange persistent startup separately, using the same home and version. Verify from another SSH connection:

```sh
ssh <HOST_ALIAS> 'node -e '\''fetch("http://127.0.0.1:30800/remote-desktop-companion/api/health").then(async r => { if (!r.ok) throw Error(`HTTP ${r.status}`); const x = await r.json(); if (x.name !== "dsh-ssh-workspace-companion") throw Error("Unexpected companion"); console.log(x) }).catch(e => { console.error(e.message); process.exit(1) })'\'''
```

For companion versions before 0.2.4, the health name was `dsh-remote-desktop-companion`; prefer updating both plugins to a fixed release. The health endpoint confirms companion activation, not authenticated session access. Finish by connecting through local **Settings → Remote Desktop**, opening a remote workspace/session and switching back to local. If GUI access is unavailable, report that this final user-path check remains outstanding.

Summarize actual local/remote DSH versions, both plugin versions, remote home, port, health result, and GUI connection result. Attach the concrete failed command/error when setup is incomplete.

## 简体中文

把下面这段直接交给能操作终端和 SSH 的 AI，将主机别名替换为你自己的：

```text
请帮我配置 SSH 主机 <HOST_ALIAS> 的远程 DSH。
先阅读 https://github.com/sincerity711/dsh-ssh-workspace/blob/main/docs/ai-remote-setup.md
并按检查、安装、验证流程执行。读取我实际使用的本地 DSH Desktop/Web 版本，
不要用另一个 CLI 的版本替代 Desktop 版本；读取本地已安装的 dsh-ssh-workspace 版本。
远程安装完全相同版本的 DSH，以及与本地插件完全相同版本的 companion。
确认远程 DSH_HOME，安装和启动使用同一个 home，保留现有会话、设置和其他插件。
最后验证 health、本地连接、打开远程会话并切回本地，报告版本和验证结果。
```

注意：DSH 版本和插件版本是两套编号，不能混用；不要默认安装 `latest`。相同 DSH 版本只是必要条件，还要检查插件声明的兼容性。当前插件 0.2.x 面向 DSH `0.2.0-rc.2`。Connect 会按本地实际版本同步 DSH 和用户插件，并停用远端额外的用户插件；不会复制设置或凭据。缺少 Node/npm 时先检查系统、权限和 PATH；不要默认使用 sudo。安装后需要验证实际运行的 profile，而不只是看到 npm 安装成功。手动导出的自定义 home 不会自动传给后续 SSH 连接。
