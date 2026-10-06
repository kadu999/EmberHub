// 应用偏好（可改 config.json，无需动代码）。
// 注意：与「资源约定」区分开——服务器目录/媒体命名等在 manifest.json 里配置，
// 见 library/resource-config.ts。
import raw from "./config.json";

export interface OpenListDefaults {
  server: string;
  username: string;
  password: string;
  /** 默认资源源（OpenList 挂载路径），固定使用、不让用户选 */
  mountPath: string;
}

export interface GridConfig {
  /** 最小列宽（px） */
  minColWidth: number;
  /** 卡片高宽比（height / width） */
  aspect: number;
  /** 卡片封面之外的高度（标题 + 间距） */
  extraHeight: number;
  /** 网格间距 */
  gap: number;
  /** 视口外多渲染几行 */
  overscan: number;
}

export interface GamepadConfig {
  /** 离散按键索引 → 动作名 */
  buttons: Record<string, string>;
  /** 十字键索引 → 动作名 */
  dpad: Record<string, string>;
  axisDeadzone: number;
  repeatFirstMs: number;
  repeatEveryMs: number;
}

export interface AppConfig {
  openlist: OpenListDefaults;
  grid: GridConfig;
  /** 选中游戏后延迟多久加载视频预览（ms） */
  videoPreviewDebounceMs: number;
  defaults: {
    /** 游戏目录默认名（服务器 Roms 目录） */
    romsPath: string;
    /** 模拟器目录默认名（服务器 Emulators 目录） */
    emulatorsPath: string;
  };
  gamepad: GamepadConfig;
}

export const APP_CONFIG = raw as AppConfig;
