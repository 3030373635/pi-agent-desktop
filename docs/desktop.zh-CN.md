# macOS App

Pi Web 的桌面版本使用 Tauri（与 Pake 相同的轻量 WebView 技术路线）封装。由于 Pi Web 包含本地 API 和 AgentSession，安装包也会携带 Next.js standalone 服务和当前架构的 Node.js runtime；打开 App 时服务自动启动，退出 App 时自动停止，无需另开终端。

## 要求

- macOS 11 或更新版本
- Node.js 20.9 或更新版本
- Rust 1.85 或更新版本
- Xcode Command Line Tools

## 开发模式

```bash
npm install
npm run desktop:dev
```

这个命令会启动现有的 Next.js dev server，并用原生窗口打开。它不会生成 standalone 服务或修改日常开发使用的 `.next/`。

## 构建 App 与 DMG

```bash
npm install
npm run desktop:build
```

构建脚本会：

1. 在 `.next-desktop/` 生成隔离的 Next.js standalone build。
2. 将服务端资源与当前 Mac 架构的 Node runtime 暂存给 Tauri。
3. 生成 `.app` 和 `.dmg`。

默认产物位于：

```text
src-tauri/target/release/bundle/macos/Pi Web.app
src-tauri/target/release/bundle/dmg/Pi Web_<version>_<arch>.dmg
```

构建结果是当前机器架构的原生应用：Apple Silicon 构建 `aarch64`，Intel Mac 构建 `x86_64`。发布给其他用户前，应使用 Apple Developer ID 签名并公证；本地开发和测试不要求签名。

桌面版会检查 Pi 与 Pi Web 的官方 GitHub Release。检查时间保存在 Pi Agent 数据目录中的 `pi-web-update-check.json`，每个项目最多每 7 天检查一次；有新版本时只显示提醒，不会自动安装更新。

## 运行日志

内置服务的 stdout/stderr 写入：

```text
~/Library/Logs/com.agegr.pi-web/server.log
```

App 会把登录 shell 的 `PATH` 传给内置服务，以便从 Finder 启动时仍能找到用户通过 Homebrew、nvm、Volta 等方式安装的命令行工具。
