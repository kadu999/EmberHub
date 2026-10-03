# EmberHub 需求文档

> 状态：**讨论稿 v0.3（待评审）** ｜ 最后更新：2026-10-03
> 标记 ❓ 的条目为**待确认**。
> **全部使用自定义 JSON 格式，不使用天马G / Pegasus 的 txt 格式。**

---

## 1. 概述

EmberHub 是一个**模拟器游戏启动器**。它本身不实现模拟功能，只做两件事：

1. **按需下载**：从资源服务器下载玩家选中的游戏 ROM，以及该平台所需的模拟器
2. **启动游戏**：用下载好的模拟器打开对应 ROM

核心体验：**打开即游戏库；点游戏 → 缺什么下什么 → 启动；全程不需要用户配置模拟器。**

---

## 2. 术语

| 术语 | 含义 |
|---|---|
| 资源服务器 | 存放 `Roms` 与 `Emulators` 的服务器，**仅支持：FTP、OpenList(WebDAV)** |
| Roms | 游戏资源，按平台分文件夹，自定义 JSON |
| Emulators | 模拟器资源，按平台打包，含单独配置文件与压缩包 |
| 平台 | 游戏机种，如 GBA、NES、PS1、街机等 |
| 按需下载 | 只下载玩家当前要玩的游戏及其平台模拟器 |

---

## 3. 资源服务器

### 3.1 支持的协议（仅两种）

| 协议 | 说明 | 状态 |
|---|---|---|
| **OpenList / WebDAV** | PROPFIND 列目录 + GET 下载 | ✅ 已实现 |
| **FTP** | 自建 FTP，**账号密码登录** | ❓ 待实现 |

### 3.2 服务器根目录结构

```
<资源服务器根>/
├─ manifest.json             # 只表明有几个平台
├─ Roms/
│  ├─ GBA/
│  │  ├─ games.json          # 该平台的游戏列表
│  │  ├─ xxx.gba             # ROM 文件
│  │  └─ media/              # 封面/视频等（天马G 目录约定）
│  │     └─ <游戏名>/
│  │        ├─ boxFront.png
│  │        └─ video.mp4
│  └─ NES/...
└─ Emulators/
   ├─ platforms.json         # 平台映射表（Roms 文件夹 → Emulators 文件夹）
   ├─ GBA/
   │  ├─ config.json         # 模拟器配置文件（含版本）
   │  └─ GBA.zip             # 模拟器压缩包
   └─ NES/...
```

### 3.3 根清单 `manifest.json`

只表明有几个平台：

```json
{
  "platforms": ["GBA", "NES", "PS"]
}
```

### 3.4 Roms 平台游戏列表 `Roms/<平台>/games.json`

```json
{
  "platform": "GBA",
  "name": "Game Boy Advance",
  "launch": "retroarch.exe -L cores/mgba_libretro.dll \"{file.path}\"",
  "games": [
    {
      "title": "Advance Wars",
      "file": "Advance Wars (USA).gba",
      "cover": "media/Advance Wars (USA)/boxFront.png",
      "developer": "Intelligent Systems",
      "publisher": "Nintendo",
      "genre": "Strategy",
      "players": 4,
      "release": "2001-09-10",
      "rating": 92,
      "description": "……"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `platform` | 平台标识 |
| `name` | 平台显示名（可选） |
| `launch` | 平台级启动命令（可选，含 `{file.path}` 占位符） |
| `games[].title` | 游戏标题 |
| `games[].file` | ROM 文件名（相对本平台目录） |
| `games[].cover` | 封面路径（可选；不写则按 §3.5 自动查找） |
| `games[].launch` | 游戏级启动命令（可选，覆盖平台级） |
| 其余 | `developer` / `publisher` / `genre` / `players` / `release` / `rating` / `description` 均为可选 |

### 3.5 封面/素材（沿用天马G 目录约定，自动查找）

- 目录：`Roms/<平台>/media/<游戏名>/`
- 约定文件名：`boxFront.*`（封面）、`logo.*`、`video.*`（视频）等，支持 png/jpg/jpeg/webp、mp4/webm
- 查找顺序：① `games.json` 里显式写的 `cover` → ② `media/<title>/` → ③ `media/<文件名(去扩展名)>/`

### 3.6 Emulators 配置 `Emulators/<平台>/config.json`

```json
{
  "platform": "GBA",
  "version": "1.2.0",
  "archive": "GBA.zip",
  "exe": "retroarch.exe",
  "args": ["-L", "cores/mgba_libretro.dll", "{file.path}"],
  "workdir": "."
}
```

| 字段 | 含义 |
|---|---|
| `platform` | 平台标识 |
| `version` | 版本号（判断是否需要更新） |
| `archive` | 压缩包文件名（相对该平台目录） |
| `exe` | 解压后可执行文件路径（相对解压根） |
| `args` | 启动参数数组，支持 `{file.path}` 等占位符 |
| `workdir` | 工作目录（相对解压根，可选） |

### 3.7 平台映射 `Emulators/platforms.json`

键 = Roms 下平台文件夹名，值 = Emulators 下平台文件夹名：

```json
{
  "GBA": "GBA",
  "NES": "NES",
  "PS": "PS1"
}
```

---

## 4. 功能一：按需下载

### 4.1 下载 ROM

- 玩家点开游戏 → 本地没有该 ROM → 从资源服务器下载 → 交给模拟器启动

### 4.2 下载模拟器（按平台）

- 点游戏 → 经 `platforms.json` 得到平台 → 读 `Emulators/<平台>/config.json`
- 未下载 → 下载压缩包并解压
- 已下载 → 比对 `version`，不同则更新

### 4.3 下载目录

- 有**默认目录**，**允许用户修改**
- ❓ 默认目录位置？
- ❓ 下载/解压后的目录结构？

### 4.4 其他

- ❓ 下载进度？断点续传？
- ❓ 完整性校验？
- ❓ 缓存清理策略？
- ❓ ROM 若为压缩包，是否自动解压？

---

## 5. 功能二：启动游戏

### 5.1 启动命令来源（**Roms 优先**）

1. `Roms/<平台>/games.json` 里该游戏的 `launch`（游戏级）
2. 否则 `games.json` 的平台级 `launch`
3. 否则 `Emulators/<平台>/config.json` 的 `exe` + `args`

### 5.2 生命周期

- EmberHub **不管理模拟器生命周期**：拉起进程后即放手
- 不主动关闭、不重启
- ❓ 是否需要复用同一实例？

---

## 6. 界面与交互

- 打开即**游戏库**（全屏，按平台分类）
- **F1** 打开设置（存储源 / 下载目录等），**Esc** 关闭
- ❓ 下载中的界面表现
- ❓ 是否需要手柄导航

---

## 7. 目标平台

- **PC（Windows）优先**
- **Android 以后**
- ❓ Android 端模拟器是 APK 还是压缩包？平台如何区分？

---

## 8. 待确认问题清单

| # | 问题 | 状态 |
|---|---|---|
| 1 | 全部改用自定义 JSON | ✅ 已定 |
| 2 | Roms `games.json` 结构 | ✅ 已定 |
| 3 | 根 `manifest.json`（只列平台） | ✅ 已定 |
| 4 | Emulators `config.json` | ✅ 已定 |
| 5 | 平台映射 `platforms.json` | ✅ 已定 |
| 6 | 封面沿用天马G 目录约定 | ✅ 已定 |
| 7 | 启动命令 Roms 优先 | ✅ 已定 |
| 8 | FTP 账号密码 | ✅ 已定 |
| 9 | 默认下载目录与结构 | ❓ |
| 10 | ROM 是否自动解压 | ❓ |
| 11 | 下载进度 / 断点续传 | ❓ |
| 12 | 缓存清理策略 | ❓ |
| 13 | PC / Android 模拟器差异 | ❓ |

---

## 9. 非功能需求

- 体积小（Tauri 产物几 MB）
- 启动快
- 离线可玩已下载的游戏
- 配置透明、可手动修改
