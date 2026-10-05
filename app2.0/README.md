# EmberHub 2.0（app2.0）

统一的 2.0 应用壳，与仓库根 `app/`（Tauri 版）**并存、互不影响**：

| 平台 | 壳 | 目录 |
|---|---|---|
| Windows | **Electron** | `electron/` |
| Android | **Capacitor 8** | `android/` |
| 浏览器（调试） | Web | `src/platform/` 兜底 |

**一套前端 + 一套业务逻辑，多个壳**。`dist/` 只构建一次：Electron 加载它，`cap sync` 把它拷进 Android。

## 当前能力

- **窗口 / 全屏**：Electron（`BrowserWindow.setFullScreen`）/ Capacitor（`FullscreenPlugin`）/ Web（Fullscreen API）
- **WebDAV**：列目录（PROPFIND）、读文本、下载 —— Electron 走主进程 Node `http`，绕过 CORS
- **本地文件系统**：目录/文件读写、递归列举、大小统计 —— Electron 主进程 Node `fs`
- **游戏库**：连接 OpenList → `scanLibrary()` 扫描 → 平台 chips + **虚拟滚动**封面网格
- **库缓存**：`manifest.json` 每次都取；其 `version` 变化时才重新拉各平台 `games.json`；网络失败回退本地旧缓存（按源隔离，存 `<下载目录>/.cache/library/`）
- **详情面板**：封面/视频预览、开发商/类型/人数/发行/评分/简介、已下载/未上传徽标
- **搜索与交互**：单选选中、双击启动、启动进度覆盖层、**手柄导航**
- **设置页**：获取资源源 / 测试连接 / 保存、下载目录、媒体缓存占用与清理
- **模拟器页**：列出 / 下载 / 更新 / 删除 / 打开模拟器
- **封面/视频**：本地缓存，经 `emberhub-media://` 自定义协议加载
- **下载（断点续传 + 进度）**：流式 `.part` + `Range` 续传 + 进度事件
- **ROM 解压**：`7za` 解压 zip/7z（`7zip-bin` 内置）
- **启动游戏**：点击 → 确保 ROM/模拟器就位 → `child_process.spawn`
- **持久化**：资源源、下载目录、全屏状态、上次选中的游戏

> 浏览器（`pnpm dev`）没有文件系统/原生网络，部分功能会提示「当前运行环境未实现」。

## 结构

```
app2.0/
├─ src/
│  ├─ App.tsx  main.tsx  styles.css       # 共享 UI
│  ├─ shared/                             # path / media / dto / native（统一原生入口）
│  ├─ domain/                             # parse / scan / resource-config / media-match …（纯 TS）
│  ├─ storage/                            # StorageProvider（含 WebDavProvider）
│  └─ platform/window.ts                  # 全屏抽象（Electron / Capacitor / Web）
├─ electron/                              # Windows 壳
│  ├─ main.cjs                            # 建窗口 + IPC + 冒烟测试
│  ├─ preload.cjs                         # contextBridge → window.emberhub
│  ├─ dav.cjs                             # WebDAV（PROPFIND / GET）
│  └─ fs.cjs                              # 文件系统
├─ android/                               # Capacitor 生成（Kotlin 插件 FullscreenPlugin）
├─ capacitor.config.ts
└─ vite.config.ts  index.html  package.json
```

`src/shared/native.ts` 是业务层唯一的原生入口（对应 1.0 的 `shared/tauri.ts`）：
Electron 走 `window.emberhub`，Capacitor 走插件，Web 兜底。

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
pnpm open:android    # Android Studio 打开 android/

# —— Android（Capacitor）——
pnpm build && pnpm sync
cd android
$env:JAVA_HOME="$env:USERPROFILE\.jdks\jdk-21.0.2"; $env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat assembleDebug     # 产物：android/app/build/outputs/apk/debug/app-debug.apk

# —— 浏览器预览 ——
pnpm dev
```

### 打包（便携版，解压即运行）

```powershell
cd app2.0
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm pack:win
```

产物：`release/EmberHub-0.1.0-win.zip`（约 150MB）——**解压后双击 `EmberHub.exe` 即用**，无需安装。

- **便携数据**：打包后下载目录 = `EmberHub.exe` 同级的 `downloads/`（绿色版）；开发时用用户数据目录。
- 只打 **zip**，不打安装器；`electron-winstaller` 已在 `pnpm-workspace.yaml` 显式忽略。
- 用 7za 解压：打包后在 `resources/app.asar.unpacked/...`，代码里已把 `app.asar` 路径替换为 `app.asar.unpacked`。

### 冒烟测试

自动跑「加载 → 全屏 IPC → WebDAV（列根目录 / 读 manifest / 读某平台 games.json）」并退出：

```powershell
cd app2.0
$env:EMBERHUB_SMOKE="1"
$env:EMBERHUB_DAV_ROOT="http://127.0.0.1:5244/dav/EmberHub_Baidu"
$env:EMBERHUB_DAV_USER="admin"
$env:EMBERHUB_DAV_PASS="12345"
.\node_modules\.bin\electron.cmd .
```

> 可选：`$env:EMBERHUB_PREPARE="GBA"` 会走真实链路下载模拟器（RetroArch ~226MB）+ ROM 并解压；
> `$env:EMBERHUB_LAUNCH="GBA"` 会真正启动模拟器，跑 6 秒确认存活后杀掉。

> **Electron 二进制没装成功时**：`node node_modules/electron/install.js`（配合 `.npmrc` 的镜像）。
> pnpm 10+ 默认不跑依赖构建脚本，本仓库用 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies: [electron]` 声明；若仍被跳过，手动执行上面这句即可。

## 与 1.0 的关系

`app/`（Tauri 版）保持不动。`domain/`、`shared/`、`storage/` 的纯 TS 部分从 1.0 逐步移植过来
（目前已有解析/扫描/资源约定/媒体匹配），平台相关部分由各自的壳实现。
