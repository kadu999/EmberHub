// 平台分发：业务层统一从 `platform` 取平台相关能力。
// 详见 docs/PROJECT_LAYOUT.md 第 7 节。
import { detectOs } from "./detect";
import { desktopPlatform } from "./desktop";
import { androidPlatform } from "./android";
import type { Platform } from "./types";

export type { Platform } from "./types";

const os = detectOs();

export const platform: Platform =
  os === "android" || os === "ios" ? androidPlatform : desktopPlatform;
