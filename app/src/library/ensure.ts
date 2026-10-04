// 确保资源就位：模拟器（按平台，带版本比对）与 ROM（断点续传 + 自动解压）。
import { tauri } from "../lib/tauri";
import { basename, dirname, extname, isAbsolute, joinPath, nativePath, stripExt } from "../lib/path";
import { useStore } from "../store";
import type { SourceConfig, StorageProvider } from "../storage/types";
import { parseEmulatorConfig, parseEmulators, parseManifest, parsePlatformMap } from "./parse";
import type { EmulatorsFile } from "./parse";
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

/** Emulators/<运行平台> 目录（相对存储源根）。 */
async function emulatorOsRoot(provider: StorageProvider, source: SourceConfig): Promise<string> {
  const emuRoot = (source.emulatorsPath ?? "Emulators").trim() || "Emulators";
  let osFolders: Record<string, string> | undefined;
  try {
    osFolders = parseManifest(await provider.readText("manifest.json")).osFolders;
  } catch {
    // 忽略
  }
  return joinPath(emuRoot, osFolder(await tauri.hostOs(), osFolders));
}

/** 读取该运行平台的模拟器配置：优先合并文件 emulators.json，否则回退旧的 platforms.json + 各 config.json。 */
async function loadEmulators(provider: StorageProvider, osRoot: string): Promise<EmulatorsFile> {
  try {
    return parseEmulators(await provider.readText(joinPath(osRoot, "emulators.json")));
  } catch {
    const platforms: Record<string, string> = {};
    try {
      Object.assign(platforms, parsePlatformMap(await provider.readText(joinPath(osRoot, "platforms.json"))));
    } catch {
      // 没有 platforms.json
    }
    return { platforms, emulators: {} };
  }
}

/** 本地模拟器安装目录 + 版本戳路径。 */
async function emulatorLocal(source: SourceConfig, platform: string) {
  const dl = await getDownloadDir(source);
  const dir = joinPath(dl, "Emulators", platform);
  return { dir, stampPath: joinPath(dir, ".installed.json") };
}

async function installedVersion(stampPath: string): Promise<string | undefined> {
  if (!(await tauri.pathExists(stampPath))) return undefined;
  try {
    return (JSON.parse(await tauri.readTextFile(stampPath)) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** 模拟器信息（服务器配置 + 本地安装状态）。 */
export interface EmulatorInfo {
  /** 模拟器平台（Emulators/<OS>/ 下的文件夹名） */
  platform: string;
  version: string;
  archive: string;
  exe: string;
  installed: boolean;
  installedVersion?: string;
}

/** 列出该运行平台下的所有模拟器及其安装状态。 */
export async function listEmulators(
  provider: StorageProvider,
  source: SourceConfig,
): Promise<EmulatorInfo[]> {
  const osRoot = await emulatorOsRoot(provider, source);
  const { emulators } = await loadEmulators(provider, osRoot);

  // 平台 → 配置：优先合并文件，否则回退各目录的 config.json
  const entries: Array<[string, EmulatorConfig]> = Object.entries(emulators);
  if (entries.length === 0) {
    let dirs: string[];
    try {
      dirs = (await provider.list(osRoot)).filter((e) => e.isDir).map((e) => e.name);
    } catch {
      return [];
    }
    for (const platform of dirs) {
      try {
        entries.push([
          platform,
          parseEmulatorConfig(await provider.readText(joinPath(osRoot, platform, "config.json"))),
        ]);
      } catch {
        // 跳过没有 config.json 的目录
      }
    }
  }

  const out: EmulatorInfo[] = [];
  for (const [platform, config] of entries) {
    const { stampPath } = await emulatorLocal(source, platform);
    const ver = await installedVersion(stampPath);
    out.push({
      platform,
      version: config.version,
      archive: config.archive,
      exe: config.exe,
      installed: ver !== undefined,
      installedVersion: ver,
    });
  }
  return out.sort((a, b) => a.platform.localeCompare(b.platform));
}

/** 确保某平台的模拟器已下载并解压；force=true 时强制重新下载（更新）。 */
export async function ensureEmulator(
  provider: StorageProvider,
  source: SourceConfig,
  platform: string,
  onStatus?: (s: string) => void,
  force = false,
): Promise<EmulatorInstall> {
  const osRoot = await emulatorOsRoot(provider, source);
  const { platforms, emulators } = await loadEmulators(provider, osRoot);

  // 平台映射（无则同名）
  const emuPlatform = platforms[platform] ?? platform;

  // 服务器结构：Emulators/<运行平台>/<游戏平台>/
  const emuBase = joinPath(osRoot, emuPlatform);
  // 优先用合并配置，回退单文件 config.json
  const config =
    emulators[emuPlatform] ??
    parseEmulatorConfig(await provider.readText(joinPath(emuBase, "config.json")));

  const dl = await getDownloadDir(source);
  const localDir = joinPath(dl, "Emulators", emuPlatform);
  const stampPath = joinPath(localDir, ".installed.json");

  // 版本比对：已安装且版本一致则直接用
  if (!force) {
    const ver = await installedVersion(stampPath);
    if (ver === config.version) {
      onStatus?.(`模拟器已就绪（${config.version}）`);
      return { dir: localDir, config };
    }
  }

  // 下载模拟器压缩包到缓存目录
  if (!provider.downloadTo) throw new Error("该存储源不支持下载模拟器。");
  const remoteArchive = joinPath(emuBase, config.archive);
  const cacheDir = joinPath(dl, ".cache", "Emulators", emuPlatform);
  await tauri.ensureDir(cacheDir);
  const localArchive = joinPath(cacheDir, basename(config.archive));
  onStatus?.(`下载模拟器 ${emuPlatform} ${config.version}…`);
  await provider.downloadTo(remoteArchive, localArchive);

  onStatus?.("解压模拟器…");
  await tauri.removePath(localDir);
  await tauri.ensureDir(localDir);
  await tauri.extractArchive(localArchive, localDir);
  await tauri.writeTextFile(stampPath, JSON.stringify({ version: config.version }));
  return { dir: localDir, config };
}

/** 删除本地模拟器（安装目录 + 压缩包缓存）。 */
export async function removeEmulator(source: SourceConfig, platform: string): Promise<void> {
  const dl = await getDownloadDir(source);
  await tauri.removePath(joinPath(dl, "Emulators", platform));
  await tauri.removePath(joinPath(dl, ".cache", "Emulators", platform));
}

/** 直接打开模拟器（不启动游戏，用于进模拟器设置）。会先确保已安装。 */
export async function openEmulator(
  provider: StorageProvider,
  source: SourceConfig,
  platform: string,
  onStatus?: (s: string) => void,
): Promise<void> {
  const { dir, config } = await ensureEmulator(provider, source, platform, onStatus);
  const exe = nativePath(isAbsolute(config.exe) ? config.exe : joinPath(dir, config.exe));
  const workdir = nativePath(config.workdir ? joinPath(dir, config.workdir) : dirname(exe));
  onStatus?.("打开模拟器…");
  await tauri.launchEmulator(exe, [], workdir);
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
  if (!provider.downloadTo) throw new Error("该存储源不支持下载。");

  const dl = await getDownloadDir(source);
  // 保留服务器上的相对路径（含子文件夹），避免多卷/多盘同名文件互相覆盖
  const dest = joinPath(dl, romRel);

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
