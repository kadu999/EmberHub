// 确保资源就位：模拟器（按平台，带版本比对）与 ROM（断点续传 + 自动解压）。
import { tauri } from "../lib/tauri";
import { basename, dirname, extname, joinPath, stripExt } from "../lib/path";
import { useStore } from "../store";
import type { SourceConfig, StorageProvider } from "../storage/types";
import { parseEmulatorConfig, parseManifest, parsePlatformMap } from "./parse";
import type { EmulatorConfig } from "./types";
import type { Game } from "./scan";

const ARCHIVE_EXTS = ["zip", "7z"];

/** 默认下载目录只解析一次（Rust 侧也会缓存，这里避免重复 invoke）。 */
let defaultDirPromise: Promise<string> | null = null;
function defaultDownloadDir(): Promise<string> {
  if (!defaultDirPromise) {
    defaultDirPromise = tauri.defaultDownloadDir().catch((e) => {
      defaultDirPromise = null;
      throw e;
    });
  }
  return defaultDirPromise;
}

/** 下载目录：全局设置优先，其次存储源设置，最后程序/用户数据目录。 */
export async function getDownloadDir(source?: SourceConfig): Promise<string> {
  const global = useStore.getState().downloadDir;
  if (global && global.trim() !== "") return global.trim();
  if (source?.downloadDir && source.downloadDir.trim() !== "") return source.downloadDir.trim();
  return defaultDownloadDir();
}

/** 资源源的短标识（隔离各源的媒体缓存，避免切换资源源时串源）。 */
function sourceSlug(provider: StorageProvider): string {
  let h = 5381;
  for (let i = 0; i < provider.key.length; i++) {
    h = ((h << 5) + h + provider.key.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/** 媒体缓存根目录（所有资源源共用这一层，下面按源标识分目录）。 */
export async function mediaCacheRoot(): Promise<string> {
  return joinPath(await getDownloadDir(), ".cache", "media");
}

/** 默认运行平台 → 文件夹名（可在 manifest.json 的 osFolders 里覆盖）。 */
const DEFAULT_OS_FOLDERS: Record<string, string> = {
  windows: "Windows",
  android: "Android",
  linux: "Linux",
  macos: "MacOS",
  ios: "iOS",
};

function osFolder(os: string, map?: Record<string, string>): string {
  const m = map ?? DEFAULT_OS_FOLDERS;
  if (m[os]) return m[os];
  return os ? os[0].toUpperCase() + os.slice(1) : "Windows";
}

export interface EmulatorInstall {
  /** 本地模拟器目录 */
  dir: string;
  config: EmulatorConfig;
}

/** 确保某平台的模拟器已下载并解压；版本不同则更新。 */
export async function ensureEmulator(
  provider: StorageProvider,
  source: SourceConfig,
  platform: string,
  onStatus?: (s: string) => void,
): Promise<EmulatorInstall> {
  const emuRoot = (source.emulatorsPath ?? "Emulators").trim() || "Emulators";
  // 运行平台文件夹名：manifest.json 的 osFolders 可覆盖
  let osFolders: Record<string, string> | undefined;
  try {
    osFolders = parseManifest(await provider.readText("manifest.json")).osFolders;
  } catch {
    // 忽略
  }
  const hostOs = osFolder(await tauri.hostOs(), osFolders);
  const osRoot = joinPath(emuRoot, hostOs);

  // 平台映射（该运行平台目录下的 platforms.json；无则同名）
  let emuPlatform = platform;
  try {
    const map = parsePlatformMap(await provider.readText(joinPath(osRoot, "platforms.json")));
    emuPlatform = map[platform] ?? platform;
  } catch {
    // 忽略
  }

  // 服务器结构：Emulators/<运行平台>/<游戏平台>/
  const emuBase = joinPath(osRoot, emuPlatform);
  const config = parseEmulatorConfig(await provider.readText(joinPath(emuBase, "config.json")));

  const dl = await getDownloadDir(source);
  const localDir = joinPath(dl, "Emulators", emuPlatform);
  const stampPath = joinPath(localDir, ".installed.json");

  // 版本比对：已安装且版本一致则直接用
  if (await tauri.pathExists(stampPath)) {
    try {
      const stamp = JSON.parse(await tauri.readTextFile(stampPath)) as { version?: string };
      if (stamp.version === config.version) {
        onStatus?.(`模拟器已就绪（${config.version}）`);
        return { dir: localDir, config };
      }
    } catch {
      // 记录损坏，重新安装
    }
  }

  // 取得压缩包的本地路径（远程下载 / 本地源直接用）
  const remoteArchive = joinPath(emuBase, config.archive);
  let localArchive: string;
  if (provider.absolute) {
    const abs = provider.absolute(remoteArchive);
    if (!abs) throw new Error("无法解析模拟器压缩包的本地路径。");
    localArchive = abs;
  } else if (provider.downloadTo) {
    const cacheDir = joinPath(dl, ".cache", "Emulators", emuPlatform);
    await tauri.ensureDir(cacheDir);
    localArchive = joinPath(cacheDir, basename(config.archive));
    onStatus?.(`下载模拟器 ${emuPlatform} ${config.version}…`);
    await provider.downloadTo(remoteArchive, localArchive);
  } else {
    throw new Error("该存储源不支持下载模拟器。");
  }

  onStatus?.("解压模拟器…");
  await tauri.removePath(localDir);
  await tauri.ensureDir(localDir);
  await tauri.extractArchive(localArchive, localDir);
  await tauri.writeTextFile(stampPath, JSON.stringify({ version: config.version }));
  return { dir: localDir, config };
}

/** 确保 ROM 在本地；返回本地绝对路径（压缩包会自动解压）。 */
export async function ensureRom(
  provider: StorageProvider,
  source: SourceConfig,
  game: Game,
  onStatus?: (s: string) => void,
  extract = true,
): Promise<string> {
  const romRel = game.files[0];
  if (!romRel) throw new Error("该游戏没有指定文件。");

  // 本地源：直接绝对路径
  if (provider.absolute) {
    const abs = provider.absolute(romRel);
    if (!abs) throw new Error("无法解析 ROM 的本地路径。");
    return abs;
  }
  if (!provider.downloadTo) throw new Error("该存储源不支持下载。");

  const dl = await getDownloadDir(source);
  const dest = joinPath(dl, "Roms", game.collection, basename(romRel));

  if (await tauri.fileExists(dest)) {
    onStatus?.("已下载，直接启动");
  } else {
    onStatus?.(`开始下载 ${basename(romRel)}`);
    await provider.downloadTo(romRel, dest);
    onStatus?.("下载完成");
  }

  return extract ? maybeExtract(dest, onStatus) : dest;
}

/** 若文件是压缩包则解压，返回内部 ROM 路径。 */
async function maybeExtract(file: string, onStatus?: (s: string) => void): Promise<string> {
  const ext = extname(file);
  if (!ARCHIVE_EXTS.includes(ext)) return file;
  const dir = joinPath(dirname(file), stripExt(basename(file)));
  onStatus?.("解压中…");
  await tauri.removePath(dir);
  await tauri.ensureDir(dir);
  await tauri.extractArchive(file, dir);
  return (await firstRomFile(dir)) ?? file;
}

/** 在目录里递归找第一个非压缩包文件。 */
async function firstRomFile(dir: string): Promise<string | undefined> {
  const entries = await tauri.listLocalDir(dir);
  for (const e of entries) {
    if (!e.is_dir && !ARCHIVE_EXTS.includes(extname(e.name))) return e.path;
  }
  for (const e of entries) {
    if (e.is_dir) {
      const inner = await firstRomFile(e.path);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** 在途下载去重：同一目标只下载一次 */
const inFlight = new Map<string, Promise<string>>();

/** 确保媒体文件（封面/视频）在本地；返回本地绝对路径。 */
export async function ensureLocalMedia(
  provider: StorageProvider,
  relPath: string,
): Promise<string> {
  const local = provider.absolute?.(relPath);
  if (local) return local;
  if (!provider.downloadTo) throw new Error("该存储源不支持下载。");

  const dl = await getDownloadDir();
  // 媒体缓存：<下载目录>/.cache/media/<源标识>/<镜像路径>
  // 带上源标识，切换到另一个资源源时不会命中旧源的缓存。
  const dest = joinPath(dl, ".cache", "media", sourceSlug(provider), relPath);
  if (await tauri.fileExists(dest)) return dest;

  const running = inFlight.get(dest);
  if (running) return running;

  const task = provider
    .downloadTo(relPath, dest)
    .then(() => dest)
    .finally(() => {
      inFlight.delete(dest);
    });
  inFlight.set(dest, task);
  return task;
}
