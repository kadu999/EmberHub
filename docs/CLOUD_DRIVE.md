# 网盘接入（WebDAV / OpenList）

EmberHub 采用「直连优先」的存储适配器架构。当前已实现：

- **WebDavProvider**：WebDAV（对接 OpenList）
- **HttpProvider**：HTTP（纯静态服务器，`python -m http.server` / nginx autoindex 等）

推荐用 **OpenList** 把各类网盘统一挂载为 WebDAV，再在 EmberHub 里添加一个 WebDAV 存储源；
若游戏库就在本机 / 局域网 / 远端（或已用任意静态服务器托管），也可直接用「HTTP」存储源。

---

## 零、一键搭建（推荐）

中转站安装在**项目内**的 `openlist/` 目录（已 gitignore，程序与数据都不进 Git）：

```
EmberHub\                 ← 仓库根（项目）
├─ app\                   ← 应用
├─ openlist\              ← 中转站程序与数据（openlist.exe 装到这里）
├─ scripts\               ← PC / Android / OpenList 脚本（平铺）+ media\
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
| OpenList 地址 | `http://127.0.0.1:5244`（协议可省略） |
| 用户名 | `admin` |
| 密码 | 你的 OpenList 密码 |
| 资源源 | 点「获取资源源」后从下拉里选一个挂载（如 `EmberHub_Baidu`） |

填好地址后点「获取资源源」，EmberHub 会从 OpenList 拉取挂载列表（`/dav/` 根目录）；选中一个后「测试连接」确认，再点「保存」即可（EmberHub 只保留一个资源源）。

---

## 三·五、HTTP（纯静态服务器，可选）

如果游戏库就在本机（或已用 nginx 等托管），不想装 OpenList，可以直接用**纯静态 HTTP 服务器**：

**一键启动（推荐）**：双击 `scripts\http-server.bat` 打开 GUI（Python + Tk）：

1. 「浏览…」选择资源目录（需含 `manifest.json` / `Roms` / `Emulators`）；
2. 端口默认 `8000`；「外网」默认**已勾选**，允许局域网 / 其它设备访问（取消勾选则仅本机 `127.0.0.1`）；
3. 点「启动」。勾选外网后会显示完整的可用 IP（如 `http://192.168.1.147:8000/`），可「打开网页」或「复制」。

也可以命令行运行（同样是 GUI）：

```powershell
python scripts\http-server.py
```

**用现成的静态服务器**：任何能列目录的静态服务器都行，例如：

```powershell
# Python（默认开启目录列表）
python -m http.server 8000 --directory D:\EmberHub-Server
```

```nginx
# nginx：必须开启目录列表
location / {
    root D:\EmberHub-Server;
    autoindex on;          # 关键：EmberHub 靠它列目录
}
```

**在 EmberHub 里连接**：「设置 → 资源源 → 类型选「HTTP」」，填：

| 字段 | 示例 |
|---|---|
| HTTP 地址 | `http://127.0.0.1:8000`（协议可省略） |

> **资源根 = 服务器根**（即你在脚本里选择的那个目录）；EmberHub 只做普通 GET 读取，**无需账号密码**。

> ⚠️ 目录结构必须与 OpenList 上**完全一致**（`manifest.json` + `Roms/<平台>/games.json` + `media/`）。
> 服务器**必须能列目录**：nginx 记得 `autoindex on`；`python -m http.server` 默认已开启。

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
   ├─ Windows/
   │  ├─ emulators.json     # 平台映射 + 各模拟器配置（合并）
   │  ├─ GBA/
   │  │  └─ GBA.zip         # 模拟器压缩包
   │  └─ ...
   └─ Android/
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

---

## 六、维护脚本（可选）

`scripts/media/` 下有若干资源维护脚本。**默认参数统一放在 `scripts/media/config.json`**（也可继续用命令行参数覆盖），键：`server` / `user` / `pass` / `mount` / `romsDir` / `ffmpeg` / `ffprobe`。

> 首次使用先复制模板：`copy scripts\media\config.example.json scripts\media\config.json`（该文件已被 gitignore，不会提交账号）。

| 脚本 | 作用 |
|---|---|
| `check-resources.mjs <平台\|all> [--fix\|--add\|--prune\|--reconcile]` | 审计 / 对齐 ROM 文件与 `games.json` |
| `check-media.mjs <平台\|all>` | 审计媒体（封面）匹配情况 |
| `fix-media-video.mjs <平台...> [--apply]` | 把 WebView2 不支持编码的视频转 H.264 |
| `pack-media.mjs <源目录> <输出目录>` | 整理天马风格媒体包为 EmberHub 目录结构 |
| `pegasus-to-json.mjs <metadata.pegasus.txt> <平台> <games.json>` | 天马 metadata → games.json |

媒体匹配算法在 `scripts/media/lib/media-match.mjs`，与 app 侧（`app/src/domain/media-match.ts`）规则一致。
