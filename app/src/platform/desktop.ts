// 桌面实现：通过 Rust 命令拉起模拟器可执行文件。
import { tauri } from "../shared/tauri";
import { detectOs } from "./detect";
import type { Platform } from "./types";

export const desktopPlatform: Platform = {
  os: detectOs(),
  isMobile: false,
  launchEmulator: (exePath, args = [], workdir, _opts) =>
    tauri.launchEmulator(exePath, args, workdir),
};
