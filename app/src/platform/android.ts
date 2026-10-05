// Android 实现：用 Intent + FileProvider 把 ROM 以 content:// 交给目标模拟器 App
// （Kotlin 插件 src-tauri/plugins/android-intent 实现；这里只负责拼参数并调用）。
import { tauri } from "../shared/tauri";
import { detectOs } from "./detect";
import type { Platform } from "./types";

/** ROM 扩展名到 MIME 的映射。查不到时用通配符，交给系统/模拟器自行识别。 */
const MIME_BY_EXT: Record<string, string> = {
  gba: "application/x-gba-rom",
  gbc: "application/x-gameboy-color-rom",
  gb: "application/x-gameboy-rom",
  nds: "application/x-nds-rom",
  iso: "application/octet-stream",
  chd: "application/octet-stream",
  cue: "application/octet-stream",
  bin: "application/octet-stream",
  cso: "application/octet-stream",
  gdi: "application/octet-stream",
  ccd: "application/octet-stream",
  m3u: "application/octet-stream",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
};

function mimeFor(romPath: string, override?: string): string {
  if (override && override.trim() !== "") return override;
  const ext = romPath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "*/*";
}

export const androidPlatform: Platform = {
  os: detectOs(),
  isMobile: true,
  launchEmulator: async (exePath, _args = [], _workdir, opts) => {
    const pkg = (opts?.package ?? exePath).trim();
    if (!pkg) throw new Error("未配置 Android 模拟器包名。");
    const rom = opts?.romPath;
    await tauri.androidLaunchApp(
      pkg,
      rom,
      rom ? mimeFor(rom, opts?.mime) : opts?.mime,
      opts?.component,
      opts?.extras,
    );
    return 0;
  },
};
