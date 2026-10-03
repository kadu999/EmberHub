# 网盘接入（WebDAV / OpenList）

EmberHub 采用「直连优先」的存储适配器架构。当前已实现：

- **LocalProvider**：本地文件夹
- **WebDavProvider**：WebDAV（可对接 OpenList、NAS、Nextcloud 等）

推荐用 **OpenList** 把各类网盘统一挂载为 WebDAV，再在 EmberHub 里添加一个 WebDAV 存储源。

---

## 零、一键搭建（推荐）

中转站安装在**项目内**的 `openlist/` 目录（已 gitignore，程序与数据都不进 Git）：

```
EmberHub\                 ← 仓库根（项目）
├─ app\                   ← 应用
├─ openlist\              ← 中转站（脚本安装到这里）
├─ scripts\
├─ docs\
└─ README.md
```

**双击 `scripts\openlist.bat`**，选择「1) 安装 / 更新」即可自动下载并初始化到 `openlist/`。
菜单还提供：启动、停止、打开管理页面、查看状态。

也可以命令行调用：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\openlist.ps1 -Action setup
# -Action: menu | setup | start | stop | restart | open | status
# -Password: 初始管理员密码（默认 EmberHub@2026）
# -Force: 强制重新下载
```

> 脚本会自动尝试多个 GitHub 镜像，适合国内网络。

---

## 一、手动部署 OpenList（Windows 本地）

OpenList 是 AList 的官方继任者，一个绿色小程序，无需数据库。

1. 从 [OpenList Releases](https://github.com/OpenListTeam/OpenList/releases) 下载
   `openlist-windows-amd64-lite.zip`（约 31MB）。
   > 国内网络若无法直连 GitHub，可用镜像，例如在链接前加 `https://gh-proxy.com/`。
2. 解压得到 `openlist.exe`，放到 `EmberHub\openlist` 目录。
3. 设置管理员密码并启动：

   ```powershell
   .\openlist.exe admin set 你的密码
   .\openlist.exe server
   ```

4. 打开管理界面：<http://127.0.0.1:5244/@manage>（账号 `admin`）。
5. WebDAV 地址即为：`http://127.0.0.1:5244/dav`

---

## 二、在 OpenList 里挂载网盘

「管理 → 存储 → 添加」，驱动选择对应网盘。常用对比：

| 驱动 | 登录方式 | 下载方式 | 建议 |
|---|---|---|---|
| **本机存储** | 无 | 本地 | 用来验证链路 / 挂本地游戏目录 |
| **阿里云盘 Open** | 官方开放平台（扫码取 refresh_token） | 支持 302 直链 | 国内首选，速度快 |
| **夸克TV** | 手机扫码 | 302 直链 | 只读场景好用，推荐 |
| **夸克网盘** | Cookie | 仅本地代理（经中转） | 简单，但依赖 OpenList 机器带宽 |
| **夸克网盘 Open** | OAuth2(AppID/SignKey) | 视配置 | 非真正开放接口，不建议 |
| **115 网盘** | Cookie / 分享 | — | 官方 API 已停，稳定性一般 |
| **百度网盘** | OAuth | 代理 | 个人应用目录受限、限速，不建议做主库 |

> 支持 **302 直链**的驱动，客户端直连网盘下载，速度最好；
> **本地代理**的驱动，数据要先经 OpenList 所在机器中转，需要该机器带宽足够。

---

## 三、在 EmberHub 里添加 WebDAV 存储源

「存储源」→ WebDAV：

| 字段 | 示例 |
|---|---|
| 名称 | 我的游戏库 |
| WebDAV 地址 | `http://127.0.0.1:5244/dav` |
| 用户名 | `admin` |
| 密码 | 你的 OpenList 密码 |

点「测试连接」确认后「添加」，再到「游戏库」点「扫描游戏库」。

---

## 四、游戏库目录约定（Pegasus / 天马G 格式）

EmberHub 递归查找元数据文件，文件名需为以下之一：

- `metadata.pegasus.txt`
- `metadata.txt`
- `*.metadata.pegasus.txt` / `*.metadata.txt`

每个游戏目录结构示例：

```
gba/
├─ metadata.pegasus.txt
├─ Advance Wars (USA).gba
└─ media/
   └─ Advance Wars (USA)/
      └─ boxFront.png
```

元数据文件示例：

```
collection: Game Boy Advance
shortname: gba
launch: retroarch.exe -L cores/mgba_libretro.dll "{file.path}"
extensions: gba, gbc, gb

game: Advance Wars
file: Advance Wars (USA).gba
developer: Intelligent Systems
genre: Strategy
players: 4
release: 2001-09-10
rating: 92%
description: 经典的回合制策略游戏。
```

封面查找顺序：

1. 元数据里的 `assets.box_front:` 等显式路径
2. `media/<游戏标题>/boxFront.*`
3. `media/<ROM 文件名>/boxFront.*`

---

## 五、常见问题

**Q：WebDAV 测试连接报 401？**
A：用户名/密码错误。OpenList 默认用 `admin` 账号。

**Q：能连上但扫不到游戏？**
A：确认网盘里存在 `metadata.pegasus.txt`，且其所在目录深度不超过 3 层。

**Q：夸克/115 下载很慢？**
A：这些驱动走本地代理，需 OpenList 所在机器带宽足够；优先用支持 302 的驱动。
