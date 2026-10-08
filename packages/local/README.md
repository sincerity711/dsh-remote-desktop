# dsh-ssh-workspace

在一个本地 DeepSeek Harness（DSH）Web 页面中，通过 SSH 使用远程机器的工作区和会话。

本地与远程工作区显示在同一个侧栏中，远程项目带有主机标记。点击远程会话后，会在独立 iframe 中打开对应机器的 DSH 页面。

## 功能

- 从本机 `~/.ssh/config` 发现 SSH 主机。
- 通过 SSH 隧道连接远程 DSH，无需把远程 Web 端口暴露到公网。
- 在统一侧栏中打开、创建、搜索、重命名、分叉和归档会话。
- 浏览远程目录并添加远程工作区。
- 在 Settings → Remote Desktop 中管理连接。

![本地与远程工作区侧栏示意图](https://raw.githubusercontent.com/sincerity711/dsh-ssh-workspace/main/docs/assets/remote-desktop-unified-sidebar.svg)

上图为使用匿名示例数据绘制的界面示意图。

## 兼容性与前提

插件 0.2.x 面向 **DSH 0.2.0-rc.2**，不支持 DSH 0.1.x。请让本地插件和所有远程 companion 使用相同版本，更新后重启对应的 DSH 进程。

本地机器需要 SSH 客户端；远程机器需要 SSH 服务和可运行的 DSH。先确认 `ssh <主机别名>` 可以连接，并且远程 SSH 环境能执行 `dsh`。

## 安装

在本地机器的 DSH Web profile 安装：

```sh
dsh plugin --profile web add dsh-ssh-workspace
```

在每台远程机器的 DSH Web profile 安装配套插件：

```sh
dsh plugin --profile web add dsh-ssh-workspace-companion
```

如果使用自定义 `DSH_HOME`，安装和启动时都要指定同一个目录；本地 Remote Desktop 设置中的远程 profile 路径也应与远程安装一致。

## 连接远程工作区

1. 在本机 `~/.ssh/config` 添加明确的主机别名，例如：

   ```sshconfig
   Host my-server
     HostName server.example.com
     User your-user
   ```

2. 确认远程 DSH 和 companion 已准备好。远程 Web 服务应绑定 loopback，例如：

   ```sh
   dsh --profile web --host 127.0.0.1 --port 30800 --trusted-host 127.0.0.1:30800
   ```

3. 重启本地 DSH Web，打开 **Settings → Remote Desktop**，选择主机并连接。
4. 在统一侧栏中打开远程工作区或会话。

显式点击 Connect 时，插件会尝试通过 SSH 安装 companion，并在需要时启动远程 DSH。自动重连只使用已准备好的远程 profile。

## 文档与反馈

- [项目与完整使用说明](https://github.com/sincerity711/dsh-ssh-workspace)
- [远程服务器配置](https://github.com/sincerity711/dsh-ssh-workspace/blob/main/docs/remote-server-setup.md)
- [架构说明](https://github.com/sincerity711/dsh-ssh-workspace/blob/main/docs/architecture.md)
- [问题反馈](https://github.com/sincerity711/dsh-ssh-workspace/issues)

开发时修改仓库中的 `packages/local/src/client/`，再在仓库根目录执行 `npm run build` 和 `npm run check`。发布包包含生成后的 `lib/` 文件。
