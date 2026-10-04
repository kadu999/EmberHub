# EmberHub 架构设计

> 状态：草案 v0.2 ｜ 最后更新：2026-10-03
> 本文记录 EmberHub 的技术选型、模块划分与存储层设计，作为开发基线。

## 1. 项目定位

EmberHub 是一个面向 **PC（Windows 优先）+ Android（后续）** 的开源模拟器管理器 / 前端启动器。
核心目标：**一个入口，装下所有模拟器与游戏；游戏按需下载，想玩哪个下哪个。**

## 2. 技术选型

| 维度 | 选型 | 理由 |
|---|---|---|
| 应用壳 | **Tauri 2** | 产物仅几 MB，复用系统 WebView2，Android 官方支持 |
| 主语言 | **TypeScript / JavaScript** | UI 与业务逻辑全用 TS，生态丰富 |
| 前端框架 | React + Vite | 组件生态成熟，适合游戏封面墙等界面 |
| 状态管理 | Zustand | 轻量、TS 友好 |
| 样式 | Tailwind CSS | 快速构建深色霓虹 UI |
| 后端 | **Rust（极薄一层）** | 只做进程启动、文件、下载等系统操作，逻辑尽量放 TS |
| 本地数据库 | SQLite (tauri-plugin-sql 或 SQL.js) | 游戏库元数据、下载记录 |
| 安全存储 | tauri-plugin-stronghold / keyring | 存放 OAuth Token |

> 设计原则：**能用 TS 解决的都放前端**，Rust 只暴露少量命令（启动模拟器、选文件、下载、读写库）。

## 3. 核心模块

```
┌───────────────────────────────────────────────┐
│              Web UI（TypeScript / React）        │
│  游戏库 / 详情页 / 设置 / 下载中心（手柄可导航）    │
├───────────────────────────────────────────────┤
│                 领域层（TS）                      │
│  Library（元数据·刮削） │ DownloadManager（按需下载·缓存）│
├───────────────────────────────────────────────┤
│          存储抽象层 StorageProvider（TS）          │
│  Local │ AliyunDrive │ OneDrive │ WebDAV │ S3 │...│
├───────────────────────────────────────────────┤
│          模拟器适配层 EmulatorAdapter（TS）         │
│  RetroArch │ Dolphin │ PCSX2 │ MAME │ ...        │
├───────────────────────────────────────────────┤
│        Rust 薄壳（Tauri Commands）                 │
│  launch_emulator │ pick_file │ download │ fs      │
└───────────────────────────────────────────────┘
```

## 4. Rust 薄壳暴露的命令（示例）

```rust
#[tauri::command]
fn launch_emulator(exe_path: String, args: Vec<String>) -> Result<u32, String>;

#[tauri::command]
async fn download_file(
    app: tauri::AppHandle,
    url: String,
    dest: String,
    headers: HashMap<String, String>,
) -> Result<(), String>; // 通过事件上报进度

#[tauri::command]
fn list_local_dir(path: String) -> Result<Vec<LocalEntry>, String>;
```

- **PC**：`launch_emulator` 用 `std::process::Command` 拉起模拟器 `.exe` 并传 ROM 路径。
- **Android（后续）**：改为调用 Intent 启动 RetroArch 等 App，上层 TS 接口不变。

## 5. 存储抽象层（重点）

### 5.1 设计原则

- **直连优先**：直接对接支持官方 API 的网盘，不依赖第三方网关。
- **适配器模式**：统一接口，想加谁加谁；网关（WebDAV/S3）只是其中两个可选适配器。
- **元数据与游戏文件分离**：本地只存游戏目录（名称/封面/远程文件 ID/大小），ROM/ISO 按需下载。
- **认证在客户端**：个人自用，OAuth + PKCE + 本地回环，**无需自建服务器**；Token 存客户端安全存储。

### 5.2 统一接口（草案）

```ts
export interface StorageProvider {
  id: string;              // 'aliyundrive' | 'onedrive' | 'local' ...
  displayName: string;
  needsAuth: boolean;
  isAuthenticated(): boolean;

  authenticate(): Promise<void>;
  logout(): Promise<void>;

  list(path: string): Promise<RemoteEntry[]>;
  getDownloadUrl(fileId: string): Promise<DownloadTicket>;
  upload?(localPath: string, remotePath: string, onProgress?: (done: number, total: number) => void): Promise<void>;
}

export interface RemoteEntry {
  id: string;              // 远端唯一 ID（网盘 file_id）
  name: string;
  size: number;
  isDir: boolean;
  modified?: Date;
  coverUrl?: string;
}

export interface DownloadTicket {
  url: string;
  headers: Record<string, string>; // 如百度的 User-Agent
  expiresAt: Date;                 // 直链时效
}
```

### 5.3 Provider 路线图

| 阶段 | Provider | 协议 / 现状 | 优先级 |
|---|---|---|---|
| M1 | ~~LocalProvider~~ | 本地文件夹（已移除，只保留 OpenList/WebDAV） | — |
| M2 | **AliyunDriveProvider** | 阿里云盘开放平台 OpenAPI（官方） | ⭐ 你已有 |
| M3 | **Pan123Provider** | 123 云盘开放平台（官方） | 可选 |
| M4 | **OneDriveProvider** | Microsoft Graph（官方，最标准） | 可选 |
| M5 | **GoogleDriveProvider** | Google Drive API v3 | 可选 |
| M6 | **WebDavProvider / S3Provider** | 兜底：接 OpenList / NAS / R2 | 按需 |

### 5.4 各网盘直连要点

**阿里云盘（开放平台）**
- 建开发者应用拿 AppID/AppSecret → OAuth 拿 refresh_token。
- 列目录：`POST /adrive/v1.0/openFile/list`
- 取直链：`POST /adrive/v1.0/openFile/getDownloadUrl`
- ⚠️ 铁律：**禁止多 IP 访问、禁止公开分享**，否则封号；请规范使用。

**百度网盘**
- 官方开放平台，但个人应用**只能访问 `/apps/你的应用名` 一个目录**，且分享 API 不对个人开放。
- 下载 >20MB 必须带请求头 `User-Agent: pan.baidu.com`。
- 结论：**不作为主存储后端**。

**115**
- 官方 Open API 平台已于 **2026-08-09 暂停服务**，无稳定直连方案。
- 如需接入，只能走 OpenList / Cookie 方式（本期不做）。

**夸克**
- "Open" 并非真正开放接口，且只能本地代理，无会员限速。本期不做。

**OneDrive / Google Drive**
- 官方 API 最标准稳定；国内网络访问受限，视情况使用。

## 6. 按需下载流程

```
选游戏 → 查本地缓存
        ├─ 命中 → 直接启动模拟器
        └─ 未命中 → 向 Provider 请求直链
                    → 调用 Rust download_file 下载到缓存目录（断点续传 + 进度事件）
                    → 直链过期则自动重取
                    → 校验大小/哈希
                    → 启动模拟器
玩完 → 缓存按 LRU 策略保留最近 N 个，超出自动清理
```

## 7. 模拟器适配层

```ts
export interface EmulatorAdapter {
  id: string;              // 'retroarch' | 'dolphin' ...
  systems: string[];       // 支持的主机平台
  launch(game: Game, romPath: string): Promise<void>;
}
```

- **PC**：定位模拟器可执行文件 → 调用 Rust `launch_emulator`。
- **Android（后续）**：构造 Intent 调用目标 App，附 ROM 路径。

## 8. 目录结构

```
EmberHub/                     # 仓库根（项目）
├── app/                      # 应用（Tauri 2 + React + TS）
│   ├── src/                  # 前端 Web UI（TypeScript）
│   │   ├── components/       # 通用组件（封面等）
│   │   ├── features/
│   │   │   ├── library/      # 游戏库页
│   │   │   └── sources/      # 存储源配置页
│   │   ├── storage/          # 存储抽象层
│   │   │   ├── types.ts
│   │   │   └── providers/    # local / webdav / aliyundrive ...
│   │   ├── library/          # Pegasus 解析与库扫描
│   │   ├── lib/              # Tauri invoke 封装、路径工具
│   │   └── main.tsx
│   ├── src-tauri/            # Rust 薄壳（启动/文件/WebDAV 命令）
│   ├── examples/             # 示例 Pegasus 游戏库
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── openlist/                 # 中转站（gitignore，不提交）
├── scripts/                  # 一键脚本
│   ├── dev.ps1 / build.ps1
│   └── openlist.bat / .ps1
├── docs/
└── README.md
```

## 9. 里程碑

- **M1**：Tauri 2 骨架 + 自定义 JSON 游戏库 + WebDAV（OpenList）存储源 + 启动 ROM。
- **M2**：阿里云盘直连 + 按需下载 + 下载中心。
- **M3**：模拟器参数配置、刮削封面、手柄导航。
- **M4**：Android 壳（Capacitor 或 Tauri mobile）+ 更多 Provider。

## 10. 已知风险

| 风险 | 应对 |
|---|---|
| 网盘 API 变动 / 关停（如 115） | 适配器隔离，坏了单独修，不影响整体 |
| 直链时效 | 下载前实时取链，失败自动重取 |
| 封号风控（阿里云盘等） | 规范使用，不公开分享、不多 IP |
| 国内网络访问海外盘 | 视情况加代理或改用国内盘 |
| WebView2 依赖 | Win10+ 通常自带，安装包可引导安装 |
