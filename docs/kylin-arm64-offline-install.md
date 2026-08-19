# 银河麒麟 ARM64 内网离线安装

本文适用于银河麒麟桌面操作系统 V10 SP1、`aarch64` 架构和无法访问互联网的软件安装环境。

麒麟专用包不使用 Tauri WebView，因此不依赖系统缺少的 `libwebkit2gtk-4.1-0`，也不会把 AppIndicator 或可选字体包声明为安装依赖。应用启动本机服务后，使用系统默认浏览器打开界面。安装包已经包含 Node.js、Playwright CLI 和对应的 Chromium，不会在运行时下载浏览器。

## 在联网电脑上生成安装包

1. 把包含本功能的分支推送到自己的 GitHub 仓库。
2. 进入仓库的 **Actions** 页面。
3. 选择 **Build Kylin ARM64 offline package**。
4. 点击 **Run workflow**，等待任务全部通过。
5. 下载产物 `pi-agent-kylin-arm64` 并解压，得到类似下面的文件：

```text
Pi-Agent_0.3.2_kylin_arm64.deb
```

通过单位允许的移动介质或内网文件交换方式，把 `.deb` 文件传到麒麟电脑。安装阶段不需要执行 `apt update`。

## 安装

先确认机器架构：

```bash
uname -m
```

必须输出：

```text
aarch64
```

进入安装包所在目录并执行：

```bash
sudo dpkg -i Pi-Agent_0.3.2_kylin_arm64.deb
```

验证安装状态和依赖字段：

```bash
dpkg -s pi-agent | grep -E '^(Status|Architecture|Depends):'
```

预期结果包含：

```text
Status: install ok installed
Architecture: arm64
Depends: libc6 (>= 2.28), libstdc++6, libgcc-s1
```

这三个包是麒麟系统提供的基础 C/C++ 运行库。这里不应该再出现 `libwebkit2gtk-4.1-0`、AppIndicator 或字体依赖。

## 启动和停止

可从应用菜单点击 **Pi Agent**，也可以使用命令启动：

```bash
pi-agent-desktop open
```

应用只监听 `127.0.0.1`，并尝试通过 `xdg-open` 或 `gio open` 调用默认浏览器。若系统无法自动打开浏览器，命令会打印本地访问地址，手动复制到浏览器即可。

查看运行状态：

```bash
pi-agent-desktop status
```

显示日志文件路径：

```bash
pi-agent-desktop logs
```

停止后台服务：

```bash
pi-agent-desktop stop
```

重复执行 `open` 会复用已经验证过的服务实例，不会重复启动多个服务。

## 验证内置 Playwright CLI

以下命令不会访问外网：

```bash
pi-agent-playwright open about:blank
pi-agent-playwright snapshot
pi-agent-playwright close
```

`pi-agent-playwright` 始终使用安装包中的 Node.js、Playwright CLI 和 Chromium，浏览器资源位于：

```text
/opt/pi-agent/resources/playwright-browsers
```

## 内网运行说明

- Pi Agent 界面、本地会话、文件浏览和 Playwright 浏览器不需要访问互联网。
- 模型请求仍然需要连接你配置的模型服务。内网环境应配置可达的内部模型网关或代理。
- 浏览器模式没有 Tauri 原生目录选择框、托盘菜单、原生完成通知和自动更新功能。
- 文件下载使用浏览器自身的下载能力。
- 更新时需要在联网电脑重新运行 GitHub Actions，再把新的 `.deb` 文件转移到内网覆盖安装。

## 故障诊断

### 浏览器没有自动打开

先检查服务状态：

```bash
pi-agent-desktop status
```

如果状态正常，把输出中的 `http://127.0.0.1:<端口>` 地址复制到麒麟自带浏览器。

### 本地服务启动失败

查看最近日志：

```bash
tail -n 200 "$(pi-agent-desktop logs)"
```

确认安装文件存在：

```bash
ls -l /opt/pi-agent/resources/node/node
ls -l /opt/pi-agent/resources/server/desktop-server.cjs
```

### Playwright Chromium 提示缺少动态库

先找到 Chromium 并查看缺失项：

```bash
find /opt/pi-agent/resources/playwright-browsers -type f -name chrome -exec ldd {} \;
```

重点检查输出中带有 `not found` 的条目。只需要在另一台软件源版本相同、同为 ARM64 的麒麟机器上下载对应依赖包及其依赖，再通过批准的离线流程导入。不要混装 Ubuntu 24.04 的 WebKitGTK 或覆盖麒麟系统基础库。

### 清理陈旧状态

正常情况下启动器会自动验证 PID 和实例标识并清理陈旧记录。如果异常关机后仍无法启动，可先运行：

```bash
pi-agent-desktop stop
pi-agent-desktop open
```

## 卸载

先停止服务，再卸载：

```bash
pi-agent-desktop stop
sudo dpkg -r pi-agent
```

卸载不会删除用户的 `~/.pi/agent/` 会话、模型和认证配置。
