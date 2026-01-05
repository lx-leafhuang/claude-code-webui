# 安卓客户端（apk）

该目录包含基于 Kotlin 的原生 Android 客户端，用 WebView 直接加载 Claude Code Web UI，保留网页端的全部功能。启动页提供 IP/Host 与端口输入，并可切换 HTTP/HTTPS。

## 功能概述
- 启动页输入服务器地址（支持 `http(s)://` 全地址或仅填 IP/域名 + 端口），本地持久化，方便下次直接使用。
- 一键切换 HTTPS，默认端口 8080，可自动解析输入中的端口/路径。
- 内置 WebView，启用 JS、DOM Storage、文件访问、混合内容兼容；支持下拉刷新、进度条、返回导航、文件选择。
- 允许明文流量，便于连接本地开发环境。

## 开发/构建
1. 准备好 Android SDK（Android Studio 推荐）。
2. 在仓库根目录执行：
   ```bash
   cd apk
   ./gradlew assembleDebug
   ```
   生成的安装包位于 `app/build/outputs/apk/debug/app-debug.apk`。

> 已内置 Gradle Wrapper（Gradle 8.6 / AGP 8.3.2），首次执行会自动下载依赖。

## 使用说明
1. 启动后在首屏输入后端地址：
   - `服务器 IP / Host`：可输入 `127.0.0.1`、`example.com`、`http://192.168.1.10:8080/ui` 等；若已包含协议和端口会自动解析。
   - `端口`：可为空，默认 8080，或手动指定 1-65535。
   - `使用 HTTPS`：切换协议。
2. 点击“连接”进入 WebView，即加载 `http(s)://host:port`（保留可选路径）。
3. 页面内支持下拉刷新与文件选择；返回键优先返回 WebView 历史，无法后退时退出到启动页。

## 目录结构
- `app/src/main/java/com/claudecode/webui/LaunchActivity.kt`：启动页逻辑、地址校验与跳转。
- `app/src/main/java/com/claudecode/webui/WebViewActivity.kt`：WebView 配置、文件选择、刷新/导航处理。
- `app/src/main/res/layout/`：启动页与 WebView 页面布局。
- 其他：清单、主题、图标、Gradle 配置等。
