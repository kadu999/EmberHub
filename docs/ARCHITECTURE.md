# EmberHub 架构设计

> 状态：草案 v0.1 ｜ 最后更新：2026-10-03
> 本文记录 EmberHub 的技术选型、模块划分与存储层设计，作为开发基线。

## 1. 项目定位

EmberHub 是一个面向 **PC + Android** 的开源模拟器管理器 / 前端启动器。
核心目标：**一个入口，装下所有模拟器与游戏；游戏按需下载，想玩哪个下哪个。**

## 2. 技术选型

| 维度 | 选型 | 理由 |
|---|---|---|
| 客户端框架 | **Flutter** | 一套代码覆盖 Windows/Linux/macOS + Android |
| 状态管理 | Riverpod | 类型安全、可测试 |
| 本地数据库 | Drift (SQLite) | 游戏库元数据、下载记录 |
| 网络 | Dio | 拦截器、断点续传 |
| 安全存储 | flutter_secure_storage | 存放 OAuth Token / refresh token |
| 平台交互 | Platform Channel | PC 端拉起模拟器进程；Android 端 Intent 调用 |

> PC 与 Android 共用 ~90% 代码，仅「启动模拟器」这一层平台相关。

## 3. 核心模块

```
┌─────────────────────────────────────────────┐
│                   UI 层                       │
│  游戏库 / 详情页 / 设置 / 下载中心（手柄可导航） │
├─────────────────────────────────────────────┤
│                 领域层                        │
│  Library（元数据·刮削） │ DownloadManager（按需下载·缓存） │
├─────────────────────────────────────────────┤
│              存储抽象层 StorageProvider        │
│  Local │ AliyunDrive │ OneDrive │ WebDAV │ S3 │ ... │
├─────────────────────────────────────────────┤
│              模拟器适配层 EmulatorAdapter       │
│  RetroArch │ Dolphin │ PCSX2 │ MAME │ ...    │
└─────────────────────────────────────────────┘
```

## 4. 存储抽象层（重点）

### 4.1 设计原则

- **直连优先**：直接对接支持官方 API 的网盘，不依赖第三方网关。
- **适配器模式**：统一接口，想加谁加谁；网关（WebDAV/S3）只是其中两个可选适配器。
- **元数据与游戏文件分离**：本地只存游戏目录（名称/封面/远程文件 ID/大小），ROM/ISO 按需下载。
- **认证在客户端**：个人自用，OAuth + PKCE + 本地回环，**无需自建服务器**；Token 存客户端安全存储。

### 4.2 统一接口（草案）

```dart
abstract class StorageProvider {
  String get id;                // 'aliyundrive' / 'onedrive' / 'local' ...
  String get displayName;
  bool get needsAuth;
  bool get isAuthenticated;

  Future<void> authenticate();  // OAuth / 扫码 / 本地路径选择
  Future<void> logout();

  /// 浏览远端目录
  Future<List<RemoteEntry>> list(String path);

  /// 获取下载直链（内部处理时效与鉴权）
  Future<DownloadTicket> getDownloadUrl(String fileId);

  /// 上传（可选，个人备份场景）
  Future<void> upload(String localPath, String remotePath, {void Function(int, int)? onProgress});
}

class RemoteEntry {
  final String id;          // 远端唯一 ID（网盘 file_id）
  final String name;
  final int size;
  final bool isDir;
  final DateTime? modified;
  final String? coverUrl;   // 若网盘能提供缩略图
}

class DownloadTicket {
  final String url;
  final Map<String, String> headers; // 如百度的 User-Agent
  final DateTime expiresAt;          // 直链时效
}
```

### 4.3 Provider 路线图

| 阶段 | Provider | 协议 / 现状 | 优先级 |
|---|---|---|---|
| M1 | **LocalProvider** | 本地文件夹 | ⭐ 先做（0 依赖） |
| M2 | **AliyunDriveProvider** | 阿里云盘开放平台 OpenAPI（官方） | ⭐ 你已有 |
| M3 | **Pan123Provider** | 123 云盘开放平台（官方） | 可选 |
| M4 | **OneDriveProvider** | Microsoft Graph（官方，最标准） | 可选 |
| M5 | **GoogleDriveProvider** | Google Drive API v3 | 可选 |
| M6 | **WebDavProvider / S3Provider** | 兜底：接 OpenList / NAS / R2 | 按需 |

### 4.4 各网盘直连要点

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

## 5. 按需下载流程

```
选游戏 → 查本地缓存
        ├─ 命中 → 直接启动模拟器
        └─ 未命中 → 向 Provider 请求直链
                    → 下载到缓存目录（断点续传 + 进度）
                    → 直链过期则自动重取
                    → 校验大小/哈希
                    → 启动模拟器
玩完 → 缓存按 LRU 策略保留最近 N 个，超出自动清理
```

## 6. 模拟器适配层

```dart
abstract class EmulatorAdapter {
  String get id;              // 'retroarch' / 'dolphin' ...
  List<String> get systems;   // 支持的主机平台
  Future<void> launch(Game game, {required String romPath});
}
```

- **PC**：定位模拟器可执行文件 → `Process.start(exe, args)`。
- **Android**：构造 Intent 调用目标 App，附 ROM 路径。

## 7. 目录结构（规划）

```
EmberHub/
├── docs/
│   └── ARCHITECTURE.md
├── lib/
│   ├── app/                  # 应用入口、路由、主题
│   ├── core/                 # 通用工具、错误、常量
│   ├── data/
│   │   ├── db/               # Drift 数据库
│   │   └── models/           # 领域模型
│   ├── features/
│   │   ├── library/          # 游戏库
│   │   ├── download/         # 下载中心
│   │   ├── settings/         # 设置
│   │   └── emulator/         # 模拟器管理
│   ├── storage/              # 存储抽象层
│   │   ├── storage_provider.dart
│   │   └── providers/        # local / aliyundrive / onedrive ...
│   └── emulators/            # 模拟器适配层
├── pubspec.yaml
└── README.md
```

## 8. 里程碑

- **M1**：Flutter 骨架 + 本地游戏库 + LocalProvider + 启动本地 ROM。
- **M2**：阿里云盘直连 + 按需下载 + 下载中心。
- **M3**：模拟器参数配置、刮削封面、手柄导航。
- **M4**：更多 Provider（123 / OneDrive / WebDAV / S3）。

## 9. 已知风险

| 风险 | 应对 |
|---|---|
| 网盘 API 变动 / 关停（如 115） | 适配器隔离，坏了单独修，不影响整体 |
| 直链时效 | 下载前实时取链，失败自动重取 |
| 封号风控（阿里云盘等） | 规范使用，不公开分享、不多 IP |
| 国内网络访问海外盘 | 视情况加代理或改用国内盘 |
