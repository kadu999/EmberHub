# 🔥 EmberHub

> 让每一款老游戏，重新燃烧。
> *Revive every classic.*

**EmberHub** 是一个开源的模拟器管理器 / 前端启动器，目标是用一个统一入口，装下你所有的模拟器与游戏库。像天马 G（Pegasus）一样，但更现代、更简洁。

---

## ✨ 特性（规划中）

- 🎮 **统一入口** — 集中管理 RetroArch、Dolphin、PCSX2、MAME 等各类模拟器
- 🗂️ **游戏库刮削** — 自动匹配封面、简介、发行信息
- 🕹️ **手柄友好** — 全手柄 UI 导航，适合掌机 / 客厅大屏
- 🎨 **主题系统** — 深色霓虹 + 暖橙点缀，可自由换肤
- ⚡ **一键启动** — 自动识别核心与 ROM 目录
- 🧩 **跨平台** — Windows / Linux / macOS / Android

## 🚧 项目状态

**Early Development** — 已实现：

- ✅ Tauri 2 桌面应用骨架（Windows）
- ✅ 存储源配置（OpenList / WebDAV）
- ✅ 自定义 JSON 资源解析与游戏库浏览（封面、筛选、详情）

规划中：模拟器配置与启动、按需下载、刮削、手柄导航、Android 端。

## 🎮 使用

- 打开即进入**游戏库**（主机前端式交互）
- 资源格式为**自定义 JSON**：服务器根 `manifest.json` + `Roms/<平台>/games.json`，封面按 `media/` 约定
- **按 `F1`** 打开设置（配置存储源 / 游戏目录），`Esc` 关闭
- 存储源通过 OpenList（WebDAV）接入

## 🛠️ 技术选型

- **应用壳**：Tauri 2（产物仅几 MB，复用系统 WebView2，Windows 优先、Android 后续）
- **主语言**：TypeScript / React + Vite ｜ **状态管理**：Zustand
- **本地库**：SQLite ｜ **后端**：Rust（极薄一层，仅做进程启动、文件、下载）
- **存储**：适配器架构，**直连优先**（Local / 阿里云盘 / OneDrive / …），WebDAV / S3 作为兜底

> 详细的模块划分、存储接口与路线图见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
> 网盘接入（OpenList / WebDAV）与天马G 元数据格式见 [`docs/CLOUD_DRIVE.md`](docs/CLOUD_DRIVE.md)。
> 目录结构与整理规范见 [`docs/PROJECT_LAYOUT.md`](docs/PROJECT_LAYOUT.md)。

## 🚀 快速开始

### 环境要求

- Node.js 18+ 与 pnpm
- [Rust](https://rustup.rs) 工具链
- Windows 需要：Visual Studio 的 **C++ 生成工具**（MSVC 链接器）+ **Windows SDK** + WebView2（Win10+ 通常自带）

### 目录结构

```
EmberHub/                 # 仓库根（项目）
├─ app/                   # 应用（Tauri 2 + React + TS）
├─ docs/                  # 设计与目录规范
├─ scripts/               # 一键脚本
│  ├─ dev.ps1 / build.ps1     # 应用开发 / 打包（自动加载 VS 环境）
│  ├─ openlist/               # 中转站一键管理（openlist.bat / .ps1）
│  └─ media/                  # 资源内容流水线（检测 / 打包 / 转换）
├─ data/                  # 本地运行时数据：报告 / 密钥（已 gitignore）
├─ release/               # 导出的安装包（已 gitignore）
├─ openlist/              # 中转站（OpenList，已 gitignore，不提交）
└─ README.md
```

### 开发

```bash
git clone https://github.com/kadu999/EmberHub.git
cd EmberHub/app
pnpm install
pnpm tauri dev      # 启动桌面应用
```

> **Windows 提示**：Rust 的 MSVC 工具链链接时需要 `link.exe` 与 Windows SDK 环境，
> 普通终端里可能报 ``linker `link.exe` not found``。可直接用仓库自带脚本（会自动进入 `app/` 并加载 VS 环境）：
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File scripts/dev.ps1     # 开发
> powershell -ExecutionPolicy Bypass -File scripts/build.ps1   # 打包
> ```

### 构建

```bash
cd app
pnpm tauri build    # 打包安装包
```

## ☁️ 中转站（网盘，可选）

要接入阿里云盘/夸克等网盘，可用 OpenList 作为中转站。它安装在**项目内**的 `openlist/` 目录，
程序与数据均已 gitignore（不进 Git），仓库只提交管理脚本：

```
EmberHub/
├─ app/
├─ openlist/              ← 中转站（gitignore）
└─ scripts/openlist/      ← 管理脚本
```

**双击 `scripts\openlist\openlist.bat`** 即可一键安装/启动/停止。

详见 [`docs/CLOUD_DRIVE.md`](docs/CLOUD_DRIVE.md)。

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request。

## 📄 许可证

TBD

---

<p align="center">Made with 🔥 for retro gaming lovers.</p>
