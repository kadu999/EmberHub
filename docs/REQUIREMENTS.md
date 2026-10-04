# EmberHub 需求文档

> 状态：**v1.0（已评审）** ｜ 最后更新：2026-10-03
> 标记 ❓ 的条目为**待确认**（非阻塞，可边做边定）。
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
| 资源服务器 | 存放 `Roms` 与 `Emulators` 的服务器，**仅支持：OpenList(WebDAV)** |
| Roms | 游戏资源，按平台分文件夹，自定义 JSON |
| Emulators | 模拟器资源，按平台打包，含单独配置文件与压缩包 |
| 平台 | 游戏机种，如 GBA、NES、PS1、街机等 |
| 按需下载 | 只下载玩家当前要玩的游戏及其平台模拟器 |

---

## 3. 资源服务器

### 3.1 支持的协议

| 协议 | 说明 | 状态 |
|---|---|---|
| **OpenList / WebDAV** | PROPFIND 列目录 + GET 下载 | ✅ 已实现 |

### 3.2 服务器根目录结构

```
<资源服务器根>/
├─ manifest.json             # 只表明有几个平台
├─ Roms/                     # 游戏资源（不分运行平台）
│  ├─ GBA/
│  │  ├─ games.json          # 该平台的游戏列表
│  │  ├─ xxx.gba             # ROM 文件
│  │  └─ media/              # 封面/视频等（天马G 目录约定）
│  │     └─ <游戏名>/
│  │        ├─ boxFront.png
│  │        └─ video.mp4
│  └─ NES/...
└─ Emulators/                # 模拟器按「运行平台」分（客户端只下自己系统的）
   ├─ Windows/
   │  ├─ emulators.json      # 平台映射 + 各模拟器配置（合并，见 3.6）
   │  ├─ GBA/
   │  │  └─ GBA.zip          # 模拟器压缩包
   │  └─ NES/...
   └─ Android/
      ├─ emulators.json
      └─ GBA/...
```

### 3.3 根清单 `manifest.json`

平台列表 + 可选全局设置：

```json
{
  "platforms": ["GBA", "NES", "PS"],
  "mediaVariants": ["HACK", "改版", "汉化版", "英文版", "日文版", "震动版"],
  "osFolders": { "windows": "Windows", "android": "Android", "linux": "Linux", "macos": "MacOS" }
}
```

| 字段 | 含义 |
|---|---|
| `platforms` | 平台列表（= `Roms/` 下的文件夹名） |
| `mediaVariants` | 可选。媒体变体后缀：匹配时去掉，让 HACK/汉化版 等复用基础版封面；缺省用内置默认表 |
| `osFolders` | 可选。运行平台 → `Emulators/` 下的文件夹名；缺省 `windows→Windows` 等 |

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
- 媒体目录匹配优先级：① `games.json` 的 `media` 字段 → ② 按标题自动匹配（会先去掉 `mediaVariants` 后缀再匹配）

**显式指定媒体目录**（标题与目录名对不上时用）：在 `games.json` 的单个游戏里写 `"media": "media/目录名"`：

```json
{
  "title": "恶魔城历代记 HACK",
  "file": "恶魔城历代记 HACK.chd",
  "media": "media/恶魔城年代记 汉化版"
}
```

### 3.6 Emulators 配置 `Emulators/<运行平台>/emulators.json`

每个运行平台**一个文件**，包含「平台映射」+「各模拟器配置」：

```json
{
  "platforms": {
    "GBA": "GBA",
    "PS": "PS1"
  },
  "emulators": {
    "GBA": {
      "platform": "GBA",
      "version": "1.2.0",
      "archive": "GBA.zip",
      "exe": "retroarch.exe",
      "args": ["-L", "cores/mgba_libretro.dll", "{file.path}"],
      "workdir": ".",
      "extract": true
    }
  }
}
```

- **`platforms`**：键 = Roms 下平台文件夹名，值 = Emulators 下游戏平台文件夹名（缺省同名）。
- **`emulators`**：键 = 模拟器平台文件夹名，值 = 该模拟器配置：

| 字段 | 含义 |
|---|---|
| `version` | 版本号（判断是否需要更新） |
| `archive` | 压缩包文件名（相对该平台目录） |
| `exe` | 解压后可执行文件路径（相对解压根） |
| `args` | 启动参数数组，支持 `{file.path}` 等占位符 |
| `workdir` | 工作目录（相对解压根，可选） |
| `extract` | 是否解压 ROM 压缩包（默认 `true`）。模拟器能直接读压缩包时设为 `false`（如 mGBA 读 zip） |

---

## 4. 功能一：按需下载

### 4.1 下载 ROM

- 玩家点开游戏 → 本地没有该 ROM → 从资源服务器下载 → 交给模拟器启动

### 4.2 下载模拟器（按平台）

- 点游戏 → 经 `emulators.json` 的 `platforms` 得到平台 → 读 `emulators.json` 的 `emulators[平台]`
- 未下载 → 下载压缩包并解压
- 已下载 → 比对 `version`，不同则更新

### 4.3 下载目录

- 默认：**程序所在目录**（exe 同级，其下创建 `Roms/` 与 `Emulators/`），**允许用户修改**
- 目录结构（镜像服务器）：

```
<下载目录>/
├─ Roms/<平台>/...        # 下载的 ROM（解压后）
├─ Emulators/<平台>/...   # 解压后的模拟器
└─ .cache/                # 断点续传的临时文件
```

### 4.4 其他

- **断点续传**：大文件下载中断后可继续
- **ROM 自动解压**：zip / 7z 等压缩包下载后自动解压，再交给模拟器
- **不自动清理**：已下载内容长期保留，不设容量上限

---

## 5. 功能二：启动游戏

### 5.1 启动命令来源（**Roms 优先**）

1. `Roms/<平台>/games.json` 里该游戏的 `launch`（游戏级）
2. 否则 `games.json` 的平台级 `launch`
3. 否则 `emulators.json` 里该平台的 `exe` + `args`

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
| 4 | Emulators 合并配置 `emulators.json`（平台映射 + 各模拟器） | ✅ 已定 |
| 5 | 封面沿用天马G 目录约定 | ✅ 已定 |
| 6 | 启动命令 Roms 优先 | ✅ 已定 |
| 7 | OpenList/WebDAV 账号密码 | ✅ 已定 |
| 8 | 默认下载目录（程序数据目录）与结构 | ✅ 已定 |
| 9 | ROM 自动解压 | ✅ 已定 |
| 10 | 断点续传 | ✅ 已定 |
| 11 | 不自动清理 | ✅ 已定 |
| 12 | PC / Android 模拟器差异 | ❓ 非阻塞（Android 阶段再定） |

---

## 9. 非功能需求

- 体积小（Tauri 产物几 MB）
- 启动快
- 离线可玩已下载的游戏
- 配置透明、可手动修改
