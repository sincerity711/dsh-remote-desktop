# dsh-ssh-workspace-companion

[English](#english) · [简体中文](#简体中文)

## English

The remote companion for [dsh-ssh-workspace](https://www.npmjs.com/package/dsh-ssh-workspace). Install it in each remote DeepSeek Harness (DSH) Web profile so the local plugin can open and operate that machine's workspaces and sessions.

### Where to install

- Install `dsh-ssh-workspace` on the local machine.
- Install this package, `dsh-ssh-workspace-companion`, on every remote machine.

Use this package together with the local plugin.

### Compatibility

Plugin 0.2.x targets **DSH 0.2.0-rc.2** and does not support DSH 0.1.x. Keep the local plugin and all remote companions on the same version and restart DSH after updating.

### Remote installation

```sh
dsh plugin --profile web add dsh-ssh-workspace-companion
```

Bind the remote Web service to loopback:

```sh
dsh --profile web --host 127.0.0.1 --port 30800 --trusted-host 127.0.0.1:30800
```

The local plugin connects through an SSH tunnel. If you use a custom `DSH_HOME`, installation, startup and the remote profile path in local Remote Desktop settings must refer to the same directory.

Install the main plugin on the local machine, then connect the SSH host in **Settings → Remote Desktop**:

```sh
dsh plugin --profile web add dsh-ssh-workspace
```

### How it works

The companion validates the parent origin and connection token inside the remote iframe opened by the local plugin. It forwards official DSH Controller state and actions through a dedicated MessageChannel and hides the embedded remote sidebar. Remote business data continues to use the remote DSH authenticated services.

### Documentation and development

- [Project and full instructions](https://github.com/sincerity711/dsh-ssh-workspace)
- [Remote server setup](https://github.com/sincerity711/dsh-ssh-workspace/blob/main/docs/remote-server-setup.md)
- [Report an issue](https://github.com/sincerity711/dsh-ssh-workspace/issues)

Edit `packages/companion/src/client.js`, then run `npm run build` and `npm run check` from the repository root.

## 简体中文

[dsh-ssh-workspace](https://www.npmjs.com/package/dsh-ssh-workspace) 的远程配套插件。安装在每台远程机器的 DeepSeek Harness（DSH）Web profile 中，让本地插件可以打开和操作该机器的工作区与会话。

## 安装位置

- 本地机器安装 `dsh-ssh-workspace`。
- 每台远程机器安装本包 `dsh-ssh-workspace-companion`。

本包需要配合本地插件使用。

## 兼容性

插件 0.2.x 面向 **DSH 0.2.0-rc.2**，不支持 DSH 0.1.x。本地插件与所有远程 companion 应使用相同版本，更新后重启 DSH。

## 远程机器安装

```sh
dsh plugin --profile web add dsh-ssh-workspace-companion
```

远程 Web 服务应绑定 loopback：

```sh
dsh --profile web --host 127.0.0.1 --port 30800 --trusted-host 127.0.0.1:30800
```

本地插件通过 SSH 隧道连接该服务。如果使用自定义 `DSH_HOME`，安装、启动和本地 Remote Desktop 设置中的远程 profile 路径必须对应同一个目录。

随后在本地机器安装主插件，并在 **Settings → Remote Desktop** 中连接 SSH 主机：

```sh
dsh plugin --profile web add dsh-ssh-workspace
```

## 工作方式

companion 在本地插件打开的远程 iframe 中验证父页面来源和连接 token，通过专用 MessageChannel 转发 DSH 官方 Controller 状态与操作，并隐藏 iframe 中的远程侧栏。远程业务数据继续由远程 DSH 的认证服务处理。

## 文档与反馈

- [项目与完整使用说明](https://github.com/sincerity711/dsh-ssh-workspace)
- [远程服务器配置](https://github.com/sincerity711/dsh-ssh-workspace/blob/main/docs/remote-server-setup.md)
- [问题反馈](https://github.com/sincerity711/dsh-ssh-workspace/issues)

开发时修改 `packages/companion/src/client.js`，再在仓库根目录执行 `npm run build` 和 `npm run check`。
