// 自定义资源格式的类型定义（全部 JSON）。
// 详见 docs/REQUIREMENTS.md 第 3 节。

/** 媒体文件的「文件名关键字 / 扩展名」约定 */
export interface MediaPickSpec {
  /** 文件名关键字（按优先级，越靠前越优先） */
  names?: string[];
  /** 允许的扩展名（小写，不带点） */
  exts?: string[];
}

/** 服务器根目录名约定 */
export interface ManifestDirs {
  roms?: string;
  emulators?: string;
}

/** 服务器上的配置文件命名约定 */
export interface ManifestFiles {
  /** 平台游戏列表，默认 games.json */
  games?: string;
  /** 运行平台模拟器配置，默认 emulators.json */
  emulators?: string;
  /** 旧式单模拟器配置，默认 config.json */
  emulatorConfig?: string;
  /** 旧式平台映射，默认 platforms.json */
  platformMap?: string;
}

/** 媒体目录与文件名约定 */
export interface ManifestMedia {
  /** 媒体目录名，默认 media */
  dir?: string;
  cover?: MediaPickSpec;
  video?: MediaPickSpec;
}

/** 扫描行为约定 */
export interface ManifestScan {
  /** 扫描平台文件时递归的子目录层数，默认 2 */
  fileDepth?: number;
}

/** 服务器根目录 manifest.json */
export interface Manifest {
  platforms: string[];
  /** 媒体变体后缀（可选）：匹配媒体时去掉，让 HACK/汉化版 等变体复用基础版封面 */
  mediaVariants?: string[];
  /** 运行平台 → 服务器文件夹名（可选），如 { "windows": "Windows" } */
  osFolders?: Record<string, string>;
  /** 目录名约定 */
  dirs?: ManifestDirs;
  /** 配置文件命名约定 */
  files?: ManifestFiles;
  /** 媒体约定 */
  media?: ManifestMedia;
  /** 需要解压的压缩包扩展名（可选），默认 ["zip","7z"] */
  archives?: string[];
  /** 扫描约定 */
  scan?: ManifestScan;
  /** 评分满分（可选）：games.json 里 rating > 1 时按此归一化，默认 100 */
  ratingScale?: number;
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
  /** 是否解压该游戏文件（压缩包 ROM）。默认 true；仅在使用 Roms 级 launch 时有意义。 */
  extract?: boolean;
}

/** Roms/<平台>/games.json */
export interface PlatformGames {
  platform: string;
  name?: string;
  /** 平台级启动命令（可选，含 {file.path} 占位符） */
  launch?: string;
  /** 平台级是否解压 ROM 压缩包（默认 true；游戏级可覆盖） */
  extract?: boolean;
  games: GameMeta[];
}

/** 模拟器安装后要预置的文件（配置驱动：App 不感知具体模拟器）。 */
export interface EmulatorFile {
  /** 目标路径，相对模拟器安装目录（如 inis/PCSX2.ini） */
  to: string;
  /** 服务器上相对该模拟器目录的源文件；与 content 二选一 */
  from?: string;
  /** 内联文本内容；支持 {install.dir} / {download.dir} / {roms.dir} 占位符；与 from 二选一 */
  content?: string;
}

/** 单个模拟器配置（Emulators/<OS>/emulators.json 里的 emulators[<平台>]） */
export interface EmulatorConfig {
  platform: string;
  version: string;
  archive: string;
  exe: string;
  args?: string[];
  workdir?: string;
  /** 是否解压 ROM 压缩包（默认 true）。模拟器能直接读压缩包时设为 false。 */
  extract?: boolean;
  /** 解压后要写入/覆盖到模拟器安装目录的配置文件（可选） */
  configs?: EmulatorFile[];
  /** Android：目标 App 包名（可选；缺省用 exe 作为包名） */
  package?: string;
  /** Android：交给 Intent 的 MIME 类型（可选；缺省按 ROM 扩展名推断） */
  mime?: string;
}

/** Emulators/platforms.json：Roms 平台文件夹 → Emulators 平台文件夹 */
export type PlatformMap = Record<string, string>;
