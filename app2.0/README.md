# EmberHub 2.0（app2.0）

统一的 2.0 应用壳，与仓库根 `app/`（Tauri 版）**并存、互不影响**：

| 平台 | 壳 | 目录 |
|---|---|---|
| Windows | **Electron** | `electron/` |
| Android | **Capacitor 8** | `android/` |
| 浏览器（调试） | Web | `src/platform/` 兜底 |

**一套前端 + 一套业务逻辑，多个壳**。`dist/` 只构建一次：Electron 加载它，`cap sync` 把它拷进 Android。

本次只完成第一步：**窗口 / 全屏**（对应 1.0 的 `getCurrentWindow().setFullscreen`）。

## 结构

```
app2.0/
├─ src/
│  ├─ App.tsx  main.tsx  styles.css      # 共享 UI
│  └─ platform/window.ts                 # 全屏抽象（Electron / Capacitor / Web 三选一）
├─ electron/                             # Windows 壳（主进程 + preload）
├─ android/                              # Capacitor 生成（含 Kotlin 插件 FullscreenPlugin）
├─ capacitor.config.ts
└─ vite.config.ts  index.html  package.json
```

`src/platform/window.ts` 按运行时选择实现：
- 有 `window.emberhub`（Electron preload 注入）→ 主进程 `BrowserWindow.setFullScreen`
- `Capacitor.isNativePlatform()` → 本地 `Fullscreen` 插件
- 否则 → 标准 Fullscreen API

## 环境要求

- Node 22+、pnpm
- Android 构建需要 **JDK 21**（Capacitor 7/8 的 android 模块要求）
- Electron 二进制走国内镜像（见 `.npmrc`）

## 常用命令

```bash
cd app2.0
pnpm install

# —— Windows（Electron）——
pnpm electron        # 构建 dist 并启动 Electron
pnpm electron:dev    # Vite dev server + Electron（HMR）
# 冒烟测试（加载 + 全屏 IPC，跑完自动退出）：
#   PowerShell: $env:EMBERHUB_SMOKE="1"; .\node_modules\.bin\electron.cmd .

# —— Android（Capacitor）——
pnpm build && pnpm sync
cd android
$env:JAVA_HOME="$env:USERPROFILE\.jdks\jdk-21.0.2"; $env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat assembleDebug     # 产物：android/app/build/outputs/apk/debug/app-debug.apk

# 浏览器预览（标准 Fullscreen API）
pnpm dev
```

> **Electron 二进制没装成功时**：`node node_modules/electron/install.js`
> （配合 `.npmrc` 里的 `electron_mirror`）。pnpm 10+ 默认不跑依赖构建脚本，本仓库用
> `pnpm-workspace.yaml` 的 `onlyBuiltDependencies: [electron]` 声明；若仍被跳过，手动执行上面这句即可。

## 与 1.0 的关系

`app/`（Tauri 版）保持不动。后续会把 `app/src/domain`、`shared` 等纯 TS 逻辑逐步移植到
`app2.0`，平台相关部分走各自的壳（Electron IPC / Capacitor 插件）。
