# EmberHub 目录规范

> 状态：草案 v0.1 ｜ 最后更新：2026-10-05
> 本文是仓库目录结构与整理的执行基线，配合 [ARCHITECTURE.md](ARCHITECTURE.md) 使用。
> 执行进度：**阶段 1–4 已完成**；阶段 5 已完成 `mobile_entry_point` 归位、`launch_emulator` 拆分、`gen` 忽略规则调整、前端 `platform/` 缝；Android 工程（`gen/android`）待执行 `tauri android init`。
> 落地细节与勾选状态见第 6 节。

## 1. 设计原则

1. **四类分离**：源码（`app/`、`scripts/`）、文档（`docs/`）、本地运行时数据（`data/`）、发布产物（`release/`）各归其位。
2. **桌面与移动共享一套应用**：Android 是 `app/` 的**附加编译目标**，不 fork 成两个 app；平台差异收口在 `platform/` 层。
3. **本地产物集中**：脚本生成的报告、密钥统一进 `data/`（整体 gitignore），源码树保持可读。
4. **发布物与编译缓存解耦**：Cargo 的 `target/` 保持默认位置，构建后把安装包**导出**到 `release/`。

## 2. 目标结构

```
EmberHub/
├─ app/                                 # 应用（Tauri 2 + React + TS）
│  ├─ src/                              # 唯一一套前端源码
│  │  ├─ main.tsx                       # Vite 入口（保留在根）
│  │  ├─ App.tsx  App.css               # 应用壳
│  │  ├─ vite-env.d.ts
│  │  ├─ config/                        # 应用配置（← 原 src/config.ts + config.json）
│  │  │  ├─ config.ts
│  │  │  └─ config.json
│  │  ├─ state/                         # 全局状态（← 原 src/store.ts）
│  │  │  └─ store.ts
│  │  ├─ shared/                        # 平台无关：类型、utils、媒体匹配（← 原 src/lib/）
│  │  │  ├─ media.ts  path.ts  useGamepad.ts
│  │  │  └─ tauri.ts                    #   invoke 封装（平台分发的收口点）
│  │  ├─ components/                    # 通用 UI 组件
│  │  │  ├─ Cover.tsx
│  │  │  └─ VirtualGrid.tsx
│  │  ├─ features/                      # 页面 / 功能
│  │  │  ├─ library/LibraryPage.tsx
│  │  │  ├─ sources/SourcesPage.tsx
│  │  │  └─ emulators/EmulatorsPage.tsx
│  │  ├─ domain/                        # 领域逻辑（← 原 src/library/，改名去歧义）
│  │  │  ├─ parse.ts  scan.ts  ensure.ts  launch.ts
│  │  │  ├─ resource-config.ts  media-cache.ts  media-match.ts
│  │  │  ├─ emulator/                   # ★ 模拟器适配层：接口 + 分平台实现
│  │  │  │  ├─ adapter.ts  desktop.ts  android.ts
│  │  │  └─ types.ts
│  │  └─ platform/                      # ★ 平台差异的唯一出口（见第 7 节）
│  │     ├─ index.ts                    #   按 host_os() 选择实现
│  │     ├─ desktop.ts
│  │     ├─ android.ts
│  │     └─ types.ts
│  ├─ src-tauri/                        # Rust 薄壳
│  │  ├─ src/
│  │  │  ├─ main.rs                     # 桌面入口
│  │  │  ├─ lib.rs                      # 共享入口 + mobile_entry_point
│  │  │  ├─ commands/                   # 共享命令：webdav / download / fs / archive
│  │  │  └─ platform/                   # ★ cfg 分平台
│  │  │     ├─ mod.rs
│  │  │     ├─ desktop.rs               # launch_emulator (std::process::Command)
│  │  │     └─ android.rs               # 转发到 Kotlin 插件
│  │  ├─ plugins/                       # ★ 本地移动插件（Cargo 成员）
│  │  │  └─ android-intent/             #   Kotlin：Intent + FileProvider
│  │  ├─ capabilities/
│  │  │  ├─ default.json                # 桌面能力
│  │  │  └─ mobile.json                 # ★ 移动端能力 / 权限
│  │  ├─ gen/                           # ← 不再整体 ignore（见第 7 节）
│  │  │  ├─ android/                    #   提交；内部自带 .gitignore 忽略 build 产物
│  │  │  └─ schemas/                    # (ignored) 自动生成的能力 schema
│  │  ├─ icons/  build.rs  Cargo.toml  Cargo.lock  tauri.conf.json
│  │  └─ target/                        # (ignored) 编译缓存 + 安装包原始落点
│  ├─ public/  index.html  package.json  pnpm-lock.yaml
│  ├─ dist/                             # (ignored) Vite 产物
│  └─ vite.config.ts  tsconfig.json  tsconfig.node.json
├─ docs/
│  ├─ ARCHITECTURE.md  CLOUD_DRIVE.md  REQUIREMENTS.md
│  └─ PROJECT_LAYOUT.md                 # 本文
├─ scripts/
│  ├─ dev.ps1  build.ps1                # 应用开发 / 构建（桌面）
│  ├─ android/                          # ★ android init / dev / build / 签名
│  ├─ openlist/                         # 中转站运维
│  │  ├─ openlist.bat
│  │  └─ openlist.ps1
│  └─ media/                            # 内容流水线
│     ├─ check-media.mjs  check-resources.mjs
│     ├─ fix-media-video.mjs  pack-media.mjs
│     ├─ pegasus-to-json.mjs  baidu_token.py
│     ├─ config.example.json
│     ├─ config.json                    # (ignored) 手改配置，贴脚本放
│     └─ lib/
│        ├─ config.mjs
│        └─ media-match.mjs
├─ data/                                # (ignored) 本地运行时数据
│  ├─ reports/                          #   media-report-*.txt / resource-report-*.txt
│  └─ secrets/                          #   baidu_token.json
├─ release/                             # (ignored) 导出的发布产物
│  ├─ desktop/                          #   .exe / .msi
│  └─ android/                          #   ★ .apk / .aab
├─ openlist/                            # (ignored) 中转站程序 + data
├─ .gitignore
├─ README.md
└─ LICENSE                              # TBD，建议补
```

图例：`★` 表示移动端扩展相关；`←` 表示由现状改名/移动而来；`(ignored)` 表示不入 Git。

## 3. 各目录职责

| 路径 | 职责 | 说明 |
|---|---|---|
| `app/` | 应用本体 | 前端 `src/` 与 Rust `src-tauri/` 同属一个 Tauri 应用 |
| `app/src/shared/` | 平台无关代码 | 原 `src/lib/`，改名以避免与 `domain/`、`features/library/` 语义撞车 |
| `app/src/domain/` | 领域逻辑 | 原 `src/library/`；解析、扫描、下载调度、模拟器适配 |
| `app/src/platform/` | 平台差异出口 | 唯一按 OS 分叉的地方，见第 7 节 |
| `scripts/` | 本仓库辅助脚本 | 按用途分子目录：构建 / Android / 中转站 / 内容流水线 |
| `data/` | 本地运行时数据 | 报告与密钥，整体 gitignore，可随时清理 |
| `release/` | 导出发布产物 | 与 `target/` 编译缓存分离 |
| `openlist/` | 中转站程序 | gitignore，仅脚本入库 |

## 4. 相对现状的变更摘要

| 区域 | 现状 | 目标 |
|---|---|---|
| 仓库根 | 6 个 `*-report-*.txt` + `baidu_token.json` 裸放 | 收进 `data/` |
| 发布物 | 深埋 `app/src-tauri/target/release/bundle/` | 构建后导出到 `release/` |
| `scripts/` | 构建 / OpenList / 内容流水线混放 | 拆为根 + `openlist/` + `media/`（+ `android/`） |
| `app/src/` | `lib/` 与 `library/` 近名；根散落 `store/config` | `shared/`（工具）+ `domain/`（领域）+ `state/`、`config/` |

> Git 跟踪层面：根目录当前只跟踪 `.gitignore` 与 `README.md`，本次整理不动已跟踪的根文件，主要影响被忽略的产物与 `scripts/`。

## 5. 必须同步的改动

以下路径在脚本中被写死或相对解析，本次整理已**同步修改**（迁移前后对照）：

| 位置 | 迁移前 | 迁移后 |
|---|---|---|
| `scripts/check-media.mjs:138` | `media-report-${target}.txt`（相对 cwd） | 仓库根 `data/reports/`，并 `mkdirSync` |
| `scripts/check-resources.mjs:306` | `resource-report-${target}.txt`（相对 cwd） | 仓库根 `data/reports/`，并 `mkdirSync` |
| `scripts/baidu_token.py:241` | `open("baidu_token.json","w")` | `data/secrets/`，并确保目录存在 |
| `scripts/openlist.ps1:25` | `Split-Path $PSScriptRoot -Parent` 取仓库根 | 上两级（脚本移入 `scripts/openlist/`） |
| `scripts/openlist.bat` | 调用 `openlist.ps1` 的相对路径 | 同步 |
| `scripts/media/lib/config.mjs:18` | `../config.json` | 不变（`lib/` 与 `config.json` 一起进 `media/`） |
| `scripts/build.ps1` | 只打包 | 末尾增加导出 `bundle/**` → `release/desktop/` |
| `app/src/**` | 原 import 路径 | `shared/domain/state/config` 重命名后全部更新（建议配 `@/` 别名） |
| `README.md`、`docs/ARCHITECTURE.md §8` | 旧目录图 | 与本文件对齐 |

## 6. 分阶段执行清单

> 建议按序分次提交，每阶段可独立验收。

- [x] **阶段 1 — 根目录清零**
  - [x] `.gitignore`：以 `/data/`、`/release/` 替换分散的报告/密钥规则；`/scripts/config.json` → `/scripts/media/config.json`
  - [x] 新建 `data/reports/`、`data/secrets/`，移动现有报告与 `baidu_token.json`
  - [x] 改 3 处脚本路径（见第 5 节）
- [x] **阶段 2 — 拆分 `scripts/`**
  - [x] `git mv` 出 `scripts/openlist/`、`scripts/media/`
  - [x] 修 `openlist.ps1` / `openlist.bat` 的仓库根解析
- [x] **阶段 3 — 导出发布产物**
  - [x] `build.ps1` 增加拷贝 `src-tauri/target/release/bundle/**` → `release/desktop/`
- [x] **阶段 4 — 前端源码重排（方案 B）**
  - [x] `lib → shared`、`library → domain`、`store → state/`、`config.* → config/`
  - [x] 更新所有 import（采用相对路径，未引入 `@/` 别名）
  - [x] 同步 `README.md` 与 `docs/ARCHITECTURE.md §8`
- [ ] **阶段 5 — 移动端预留（可选，见第 7 节）**
  - [x] 修 `mobile_entry_point` 位置；拆分 `launch_emulator` 到 `src-tauri/src/platform/`
  - [x] 调整 `src-tauri/.gitignore` 的 `gen` 规则（`/gen/` → `/gen/schemas`）
  - [x] 建 `app/src/platform/` 前端缝，并接入 `domain/launch.ts` 的启动路径
  - [ ] `tauri android init` 生成并提交 `gen/android`（需 JDK + Android SDK/NDK）

## 7. 移动端（Android）扩展点

Tauri 2 的模型是**一套前端 + 一份 `src-tauri`**：桌面走 `main.rs`，移动走 `lib.rs` 的 `mobile_entry_point`。因此 Android 是附加编译目标，**不应**拆成 `apps/desktop` + `apps/mobile`。为让未来加 Android 成为纯加法，需预留以下边界。

### 7.1 当前已知的适配点

1. **`mobile_entry_point` 属性位置**：`app/src-tauri/src/lib.rs:522` 目前把它标在 `host_os()` 上，应移到 `pub fn run()`。桌面端因 `mobile` cfg 不成立而无影响，Android 编译/启动会出问题。
2. **`gen/` 的忽略规则**：`app/src-tauri/.gitignore` 现为 `/gen/`，会连 `gen/android` 一起忽略。Tauri 的 Android 工程位于 `src-tauri/gen/android`，官方约定**需提交**（其内部自带 `.gitignore` 排除 build 产物、keystore 等）。应改成仅忽略 `/gen/schemas`。
3. **`launch_emulator` 是桌面专属**：`lib.rs:42-59` 用 `std::process::Command` 拉起 exe。Android 需改用 Intent + `FileProvider` 把 ROM 以 `content://` 暴露给目标模拟器，并实现 Kotlin 本地插件。这是桌面/移动最主要的逻辑分叉。

> 其余 Rust 命令（`webdav_*`、`webdav_download`、fs、`extract_archive`）平台无关，可在 Android 复用；`default_download_dir` 在 Android 上会回退到 `app_local_data_dir`，基本可用。

### 7.2 三条"缝"

- **前端 `platform/` 缝**：`shared` / `domain` 只写业务，凡涉及系统的操作（启动模拟器、下载目录、路径规则）统一从 `platform/` 取实现；`shared/tauri.ts` 是现成的 invoke 收口点。
- **Rust `platform/` 缝**：`launch_emulator` 移入 `src-tauri/src/platform/desktop.rs`，`android.rs` 改调插件；其余命令共享。
- **`plugins/` 缝**：Android 的 Intent / FileProvider 用 Kotlin 写本地 Tauri 插件，置于 `src-tauri/plugins/`，并让 `src-tauri` 成为 Cargo workspace 成员。

这套缝同样是**选型保险**：若未来 Tauri mobile 限制过多而改用 Capacitor 壳，业务逻辑仍在 TS，只需补一个 JS 版 `platform/android.ts`，`shared` / `domain` 可整块复用。

### 7.3 存储与权限

- 按需下载写入 App 私有目录：复用现有 Rust 下载/解压即可。
- 扫描用户已有的 ROM 目录：Android 需 SAF（推荐）或 `MANAGE_EXTERNAL_STORAGE`（上架 Play 受限），需重新定义"游戏目录"的语义。

### 7.4 构建与发布

前置（本机一次性）：

1. JDK 17+、Android SDK（设 `ANDROID_HOME`）、Android NDK（设 `NDK_HOME`）；
2. `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`；
3. 在 `app/` 执行 `pnpm tauri android init`，生成 `src-tauri/gen/android`（**需提交**）。

日常命令：

- 开发到设备 / 模拟器：`powershell -ExecutionPolicy Bypass -File scripts/android/dev.ps1`
- 打包：`powershell -ExecutionPolicy Bypass -File scripts/android/build.ps1`，APK/AAB 自动导出到 `release/android/`
- 产物原始路径：`src-tauri/gen/android/app/build/outputs/{apk,bundle}/...`
- 签名 keystore **不入库**（生成的 Android 工程自带 ignore 规则）
- CI：桌面与 Android 分两个 workflow，共享同一份前端构建

### 7.5 动手前的检查项

- [ ] 逐个体检所用 Tauri 插件在 Android 的支持情况（如 `tauri-plugin-opener`；但"启动外部模拟器并传 ROM"需自研 intent 插件）。
- [ ] 确认 `zip`、`sevenz-rust2` 等依赖能交叉编译到 Android。
- [ ] 明确移动端 UI 的输入方案（手柄 / 触屏 / D-pad）。

## 8. `.gitignore` 目标

**仓库根 `.gitignore`**

```gitignore
# 中转站（OpenList）：只提交脚本，不提交程序与数据
/openlist/

# 本地运行时数据（报告 / 密钥）
/data/

# 导出的发布产物
/release/

# 压缩包 / 存档
*.zip
*.7z
*.sav

# 系统文件
.DS_Store
Thumbs.db

# 脚本本地配置（含账号，复制 config.example.json 后使用）
/scripts/media/config.json

# Python
__pycache__/
*.pyc
```

**`app/src-tauri/.gitignore`**

```gitignore
# Generated by Cargo
/target/

# Generated by Tauri：仅忽略自动生成的 schema，gen/android 需提交
/gen/schemas
```
