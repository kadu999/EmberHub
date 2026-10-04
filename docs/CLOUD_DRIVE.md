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
# -Action: menu | setup | update | start | stop | restart | open | status
# -Password: 初始管理员密码（默认 12345）
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

## 三、在 EmberHub 里添加 OpenList 存储源

「存储源」→ OpenList：

| 字段 | 示例 |
|---|---|
| 名称 | 我的游戏库 |
| OpenList 地址 | `127.0.0.1:5244`（只填 IP:端口） |
| 用户名 | `admin` |
| 密码 | 你的 OpenList 密码 |
| 资源源 | 点「获取资源源」后从下拉里选一个挂载（如 `EmberHub_Baidu`） |

填好地址后点「获取资源源」，EmberHub 会从 OpenList 拉取挂载列表（`/dav/` 根目录）；选中一个后「测试连接」确认，再点「保存」即可（EmberHub 只保留一个资源源，OpenList 与本地文件夹二选一）。

---

## 四、资源目录约定（自定义 JSON）

资源服务器根目录：

```
<服务器根>/
├─ manifest.json            # 只列平台
├─ Roms/
│  └─ GBA/
│     ├─ games.json         # 该平台游戏列表
│     ├─ Advance Wars (USA).gba
│     └─ media/             # 封面/视频（天马G 目录约定）
│        └─ Advance Wars (USA)/boxFront.png
└─ Emulators/
   ├─ platforms.json        # 平台映射（Roms 文件夹 → Emulators 文件夹）
   └─ GBA/
      ├─ config.json        # 模拟器配置（含 version）
      └─ GBA.zip            # 模拟器压缩包
```

`manifest.json`：

```json
{ "platforms": ["GBA", "NES"] }
```

`Roms/GBA/games.json`：

```json
{
  "platform": "GBA",
  "name": "Game Boy Advance",
  "launch": "retroarch.exe -L cores/mgba_libretro.dll \"{file.path}\"",
  "games": [
    {
      "title": "Advance Wars",
      "file": "Advance Wars (USA).gba",
      "developer": "Intelligent Systems",
      "genre": "Strategy",
      "players": 4,
      "release": "2001-09-10",
      "rating": 92,
      "description": "经典的回合制策略游戏。"
    }
  ]
}
```

封面：`Roms/<平台>/media/<游戏名>/boxFront.*`（也可在游戏对象里写 `cover` 指定）。

完整格式见 [`REQUIREMENTS.md`](REQUIREMENTS.md) 第 3 节。

---

## 五、常见问题

**Q：WebDAV 测试连接报 401？**
A：用户名/密码错误。OpenList 默认用 `admin` 账号。

**Q：能连上但扫不到游戏？**
A：确认服务器根目录有 `manifest.json`，且 `Roms/<平台>/games.json` 存在、格式正确。

**Q：夸克/115 下载很慢？**
A：这些驱动走本地代理，需 OpenList 所在机器带宽足够；优先用支持 302 的驱动。
