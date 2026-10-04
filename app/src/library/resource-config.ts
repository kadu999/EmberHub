// 资源约定（来自资源服务器根的 manifest.json）。
// 目标：客户端不写死任何「服务器目录结构 / 媒体命名 / 压缩包格式」约定，
// 全部可由 manifest.json 覆盖，其余用 DEFAULT_RESOURCE_CONFIG 兜底。
import type { StorageProvider } from "../storage/types";
import { parseManifest } from "./parse";
import type { Manifest } from "./types";

/** 媒体文件名 / 扩展名约定（已解析为可用配置）。 */
export interface MediaConfig {
  /** 每个平台下的媒体目录名 */
  dir: string;
  /** 封面文件名关键字（按优先级） */
  coverNames: string[];
  /** 视频文件名关键字 */
  videoNames: string[];
  /** 图片扩展名（小写，不带点） */
  imageExts: string[];
  /** 视频扩展名（小写，不带点） */
  videoExts: string[];
}

/** 服务器目录 / 文件命名约定。 */
export interface FileNames {
  /** 平台游戏列表 */
  games: string;
  /** 运行平台模拟器配置 */
  emulators: string;
  /** 旧式单模拟器配置 */
  emulatorConfig: string;
  /** 旧式平台映射 */
  platformMap: string;
  /** 根清单 */
  manifest: string;
}

export interface ResourceConfig {
  /** 平台列表（= Roms 下的文件夹名，来自 manifest.json） */
  platforms: string[];
  /** 服务器 / 本地 Roms 目录名 */
  romsDir: string;
  /** 服务器 Emulators 目录名（本地安装目录同用） */
  emulatorsDir: string;
  media: MediaConfig;
  /** 需要解压的压缩包扩展名 */
  archives: string[];
  /** 扫描平台文件时递归的子目录层数 */
  fileDepth: number;
  /** 评分满分（rating > 1 时按此归一化） */
  ratingScale: number;
  /** 媒体变体后缀（空数组 = 使用内置默认表） */
  mediaVariants: string[];
  /** 运行平台 → Emulators 文件夹名 */
  osFolders: Record<string, string>;
  /** 文件名约定 */
  files: FileNames;
}

/** 内置兜底：manifest.json 未提供时使用。 */
export const DEFAULT_RESOURCE_CONFIG: ResourceConfig = {
  platforms: [],
  romsDir: "Roms",
  emulatorsDir: "Emulators",
  media: {
    dir: "media",
    coverNames: [
      "boxfront",
      "box_front",
      "box2dfront",
      "cover",
      "front",
      "tile",
      "banner",
      "logo",
      "screenshot",
      "titlescreen",
    ],
    videoNames: ["video"],
    imageExts: ["png", "jpg", "jpeg", "webp"],
    videoExts: ["mp4", "webm", "avi", "mkv"],
  },
  archives: ["zip", "7z"],
  fileDepth: 2,
  ratingScale: 100,
  mediaVariants: [],
  osFolders: {},
  files: {
    games: "games.json",
    emulators: "emulators.json",
    emulatorConfig: "config.json",
    platformMap: "platforms.json",
    manifest: "manifest.json",
  },
};

/** 由 manifest.json 合并出完整资源约定。 */
export function resourceConfigFromManifest(m?: Manifest | null): ResourceConfig {
  const d = DEFAULT_RESOURCE_CONFIG;
  if (!m) return d;
  const cover = m.media?.cover;
  const video = m.media?.video;
  return {
    platforms: m.platforms ?? d.platforms,
    romsDir: m.dirs?.roms ?? d.romsDir,
    emulatorsDir: m.dirs?.emulators ?? d.emulatorsDir,
    media: {
      dir: m.media?.dir ?? d.media.dir,
      coverNames: cover?.names ?? d.media.coverNames,
      videoNames: video?.names ?? d.media.videoNames,
      imageExts: cover?.exts ?? d.media.imageExts,
      videoExts: video?.exts ?? d.media.videoExts,
    },
    archives: m.archives ?? d.archives,
    fileDepth: m.scan?.fileDepth ?? d.fileDepth,
    ratingScale: m.ratingScale ?? d.ratingScale,
    mediaVariants: m.mediaVariants ?? d.mediaVariants,
    osFolders: m.osFolders ?? d.osFolders,
    files: {
      games: m.files?.games ?? d.files.games,
      emulators: m.files?.emulators ?? d.files.emulators,
      emulatorConfig: m.files?.emulatorConfig ?? d.files.emulatorConfig,
      platformMap: m.files?.platformMap ?? d.files.platformMap,
      manifest: d.files.manifest,
    },
  };
}

// 当前生效的资源约定（扫描时写入；媒体文件名识别等使用）。
let active: ResourceConfig = DEFAULT_RESOURCE_CONFIG;

export function getActiveResourceConfig(): ResourceConfig {
  return active;
}

export function setActiveResourceConfig(cfg: ResourceConfig): void {
  active = cfg;
}

// 每个资源源只读一次 manifest.json（切换源 / 重新扫描时清缓存）。
const cache = new Map<string, Promise<ResourceConfig>>();

export function clearResourceConfigCache(): void {
  cache.clear();
}

/**
 * 读取并缓存资源约定。
 * @param required true 时读不到 manifest.json 会抛错（扫描入口用，便于提示用户）；
 *                 false 时静默回退内置默认（下载/启动等次要路径用）。
 */
export function loadResourceConfig(
  provider: StorageProvider,
  required = false,
): Promise<ResourceConfig> {
  const hit = cache.get(provider.key);
  if (hit) return hit;

  const task = provider
    .readText("manifest.json")
    .then((text) => resourceConfigFromManifest(parseManifest(text)));
  const safe = task.catch((e) => {
    cache.delete(provider.key);
    if (required) throw e;
    return DEFAULT_RESOURCE_CONFIG;
  });
  cache.set(provider.key, safe);
  return safe;
}
