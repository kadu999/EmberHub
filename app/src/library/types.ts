// 自定义资源格式的类型定义（全部 JSON）。
// 详见 docs/REQUIREMENTS.md 第 3 节。

/** 服务器根目录 manifest.json：只表明有几个平台 */
export interface Manifest {
  platforms: string[];
}

/** Roms/<平台>/games.json 里的单个游戏 */
export interface GameMeta {
  title: string;
  file: string;
  cover?: string;
  /** 显式指定媒体目录（相对平台目录，如 media/xxx）；缺省则按标题自动匹配 */
  media?: string;
  developer?: string;
  publisher?: string;
  genre?: string;
  players?: number | string;
  release?: string;
  rating?: number;
  description?: string;
  /** 游戏级启动命令（可选，覆盖平台级） */
  launch?: string;
}

/** Roms/<平台>/games.json */
export interface PlatformGames {
  platform: string;
  name?: string;
  /** 平台级启动命令（可选，含 {file.path} 占位符） */
  launch?: string;
  games: GameMeta[];
}

/** Emulators/<平台>/config.json */
export interface EmulatorConfig {
  platform: string;
  version: string;
  archive: string;
  exe: string;
  args?: string[];
  workdir?: string;
  /** 是否解压 ROM 压缩包（默认 true）。模拟器能直接读压缩包时设为 false。 */
  extract?: boolean;
}

/** Emulators/platforms.json：Roms 平台文件夹 → Emulators 平台文件夹 */
export type PlatformMap = Record<string, string>;
