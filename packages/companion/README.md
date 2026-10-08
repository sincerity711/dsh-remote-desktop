# dsh-ssh-workspace-companion

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
