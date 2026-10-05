// Android 实现：需通过 Intent + FileProvider 把 ROM 以 content:// 交给目标模拟器，
// 并实现 Kotlin 插件（src-tauri/plugins/）。接入前先给出明确错误。
import { detectOs } from "./detect";
import type { Platform } from "./types";

export const androidPlatform: Platform = {
  os: detectOs(),
  isMobile: true,
  launchEmulator: async () => {
    throw new Error("Android 端启动模拟器尚未实现（需 Intent + FileProvider 插件）");
  },
};
