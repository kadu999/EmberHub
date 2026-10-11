# 游戏附加内容包（mod）

> 状态：草案 ｜ 最后更新：2026-10-12
> 用于给单个游戏自动附加「汉化补丁 / LayeredFS mod」等，做到**下载游戏 → 启动即生效**。

## 1. 设计

- **游戏级**：`Roms/<平台>/games.json` 的某个游戏可带 `mod` 字段，指向本平台目录下的文件（单个或数组）：
  ```json
  { "title": "迷托邦", "file": "迷托邦.3ds", "mod": "mods/0004000000178800.zip" }
  { "title": "真女神转生4 - Final", "mod": ["mods/0000000166b00.zip", "dlc/0004000000166b00.cia"] }
  ```
  - `.zip`：**解压**到模拟器 mods 目录（LayeredFS，如 3DS 汉化 Update 补丁）。
  - `.cia`：交给模拟器**安装**（如 Azahar 的 `--install`，用于 DLC 类汉化）。
- **模拟器级**：`Emulators/<运行平台>/emulators.json` 里该模拟器：
  - `modsRoot`：zip 解压落点（相对安装目录），如 Azahar 的 `user`。
  - `installArgs`：`.cia` 的安装命令参数（含 `{file.path}`），如 `["--install", "{file.path}"]`。
- **启动流程**（桌面端）：`ensureEmulator` → `ensureRom` → `ensureGameMod`（下载并按类型解压/安装）→ 启动。
  - 已应用过则跳过（安装目录下 `.emberhub-mods.json` 记录；删除该文件可强制重装）。
  - Android 暂不支持。

## 2. Azahar（3DS）示例

`Emulators/Windows/emulators.json`：
```json
"3DS": {
  "exe": "azahar-windows-mxe-2126.1.2/azahar.exe",
  "args": ["{file.path}"],
  "extract": true,
  "modsRoot": "azahar-windows-mxe-2126.1.2/user",
  "installArgs": ["--install", "{file.path}"],
  "configs": [
    { "to": "azahar-windows-mxe-2126.1.2/portable.ini", "content": "" }
  ]
}
```

- Azahar 靠**存在 `user/` 目录**触发便携模式（`ensureGameMod` 会创建它）；之后：
  - `.zip`（LayeredFS）解压到 `user/load/mods/<基础 TitleID>/{romfs,exefs}/…`，启动时自动合并；
  - `.cia` 用 `azahar --install` 安装进 `user/nand/`，启动时自动应用（DLC / 更新）。

mod 包内部结构：
```
load/mods/<基础TitleID>/romfs/...
load/mods/<基础TitleID>/exefs/...   （可选）
```

## 3. 生成 mod 包（3DS 汉化补丁 CIA）

```bash
pip install pyctr
python scripts/media/cia-to-mod.py <CIA文件或目录> <输出目录>
# 输出：<基础TitleID>.zip → 上传到 Roms/3DS/mods/
```

- 补丁是「更新/追加标题」（TitleID 形如 `0004000E…` / `0004008C…`），脚本会换算成
  **基础游戏 TitleID**（`00040000…`）作为 mod 目录名。
- **仅支持未加密（no_crypto）的 CIA**。加密 CIA 需要真实 3DS 密钥（`boot9.bin`），
  本脚本不内置、也不提供任何密钥。

## 4. 已知限制

- 一个基础 TitleID 只应放**一个** mod 包（同游戏多个补丁版本需择一）。
- 仅桌面端生效。
- 需要模拟器本身支持 LayeredFS（Azahar/Citra 支持）。
