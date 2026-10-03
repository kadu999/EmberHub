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

**Early Development** — 目前处于早期规划阶段，欢迎关注和参与。

## 🛠️ 技术选型

- **客户端**：Flutter（一套代码覆盖 Windows / Linux / macOS + Android）
- **状态管理**：Riverpod ｜ **本地库**：Drift (SQLite) ｜ **网络**：Dio
- **存储**：适配器架构，**直连优先**（Local / 阿里云盘 / OneDrive / …），WebDAV / S3 作为兜底

> 详细的模块划分、存储接口与路线图见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 🚀 快速开始

```bash
git clone https://github.com/kadu999/EmberHub.git
cd EmberHub
```

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request。

## 📄 许可证

TBD

---

<p align="center">Made with 🔥 for retro gaming lovers.</p>
