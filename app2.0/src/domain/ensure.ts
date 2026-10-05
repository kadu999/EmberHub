// 确保资源就位：模拟器（按平台，带版本比对）与 ROM（下载 + 自动解压）。
import { native } from "../shared/native";
import { basename, dirname, extname, isAbsolute, joinPath, nativePath, stripExt } from "../shared/path";
import type { SourceConfig, StorageProvider } from "../storage/types";
import { parseEmulatorConfig, parseEmulators, parsePlatformMap } from "./parse";
import type { EmulatorsFile } from "./parse";
import { loadResourceConfig, type ResourceConfig } from "./resource-config";
import type { EmulatorConfig } from "./types";
import type { Game } from "./scan";

/** 默认下载目录只解析一次（壳侧也会缓存，这里避免重复取）。 */
let defaultDirPromise: Promise<string> | null = null;
function defaultDownloadDir(): Promise<string> {
  if (!defaultDirPromise) {
    defaultDirPromise = native.fs.defaultDownloadDir().catch((e) => {
      defaultDirPromise = null;
      throw e;
    });
  }
  return defaultDirPromise;
}

/** 下载目录：存储源设置优先，其次壳的默认目录。 */
export async function getDownloadDir(source?: SourceConfig): Promise<string> {
  if (source?.downloadDir && source.downloadDir.trim() !== "") {
    return source.downloadDir.trim();
  }
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
  dir: string;
  config: EmulatorConfig;
  args?: string[];
}

/** Emulators/<运行平台> 目录（相对存储源根）。 */
async function emulatorOsRoot(source: SourceConfig, cfg: ResourceConfig): Promise<string> {
  const emuRoot = (source.emulatorsPath ?? cfg.emulatorsDir).trim() || cfg.emulatorsDir;
  return joinPath(emuRoot, osFolder(await native.hostOs(), cfg.osFolders));
}

/** 读取该运行平台的模拟器配置：优先合并文件 emulators.json，否则回退旧的 platforms.json。 */
async function loadEmulators(
  provider: StorageProvider,
  osRoot: string,
  cfg: ResourceConfig,
): Promise<EmulatorsFile> {
  let file: EmulatorsFile;
  try {
    file = parseEmulators(await provider.readText(joinPath(osRoot, cfg.files.emulators)));
  } catch {
    const platforms: Record<string, string> = {};
    try {
      Object.assign(
        platforms,
        parsePlatformMap(await provider.readText(joinPath(osRoot, cfg.files.platformMap))),
      );
    } catch {
      /* 没有 platforms.json */
    }
    file = { platforms, emulators: {}, platformArgs: {}, warnings: [] };
  }
  if (file.warnings.length > 0) {
    console.warn(`[EmberHub] ${cfg.files.emulators}:\n${file.warnings.join("\n")}`);
  }
  return file;
}

/** 本地模拟器安装目录 + 版本戳路径。 */
async function emulatorLocal(source: SourceConfig, platform: string, cfg: ResourceConfig) {
  const dl = await getDownloadDir(source);
  const dir = joinPath(dl, cfg.emulatorsDir, platform);
  return { dir, stampPath: joinPath(dir, ".installed.json") };
}

async function installedVersion(stampPath: string): Promise<string | undefined> {
  if (!(await native.fs.pathExists(stampPath))) return undefined;
  try {
    return (JSON.parse(await native.fs.readTextFile(stampPath)) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** 替换配置内容里的路径占位符。 */
function applyConfigPlaceholders(
  text: string,
  vars: { installDir: string; downloadDir: string; romsDir: string },
): string {
  return text
    .replace(/\{install\.dir\}/g, nativePath(vars.installDir))
    .replace(/\{download\.dir\}/g, nativePath(vars.downloadDir))
    .replace(/\{roms\.dir\}/g, nativePath(vars.romsDir));
}

/** 把 emulators.json 里声明的配置文件写入本地模拟器目录（幂等）。 */
async function provisionEmulatorConfigs(
  provider: StorageProvider,
  emuBase: string,
  localDir: string,
  config: EmulatorConfig,
  downloadDir: string,
  romsRoot: string,
  onStatus?: (s: string) => void,
): Promise<void> {
  const list = config.configs ?? [];
  if (list.length === 0) return;
  const vars = { installDir: localDir, downloadDir, romsDir: joinPath(downloadDir, romsRoot) };
  for (const f of list) {
    const dest = joinPath(localDir, f.to);
    try {
      if (f.from) {
        if (await native.fs.fileExists(dest)) continue;
        if (!provider.downloadTo) continue;
        onStatus?.(`写入配置 ${f.to}`);
        await provider.downloadTo(joinPath(emuBase, f.from), dest);
      } else {
        const content = applyConfigPlaceholders(f.content ?? "", vars);
        const existing = (await native.fs.fileExists(dest))
          ? await native.fs.readTextFile(dest).catch(() => null)
          : null;
        if (existing === content) continue;
        onStatus?.(`写入配置 ${f.to}`);
        await native.fs.writeTextFile(dest, content);
      }
    } catch (e) {
      console.warn(`[EmberHub] 预置配置失败 ${f.to}:`, e);
    }
  }
}

export interface EmulatorInfo {
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
  const cfg = await loadResourceConfig(provider);
  const osRoot = await emulatorOsRoot(source, cfg);
  const { emulators } = await loadEmulators(provider, osRoot, cfg);

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
          parseEmulatorConfig(
            await provider.readText(joinPath(osRoot, platform, cfg.files.emulatorConfig)),
          ),
        ]);
      } catch {
        /* 跳过没有 config.json 的目录 */
      }
    }
  }

  const out: EmulatorInfo[] = [];
  for (const [platform, config] of entries) {
    const { stampPath } = await emulatorLocal(source, platform, cfg);
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
  const cfg = await loadResourceConfig(provider);
  const osRoot = await emulatorOsRoot(source, cfg);
  const { platforms, emulators, platformArgs } = await loadEmulators(provider, osRoot, cfg);

  const emuPlatform = platforms[platform] ?? platform;
  const emuBase = joinPath(osRoot, emuPlatform);
  const config =
    emulators[emuPlatform] ??
    parseEmulatorConfig(await provider.readText(joinPath(emuBase, cfg.files.emulatorConfig)));
  const args = platformArgs[platform] ?? config.args;

  const dl = await getDownloadDir(source);
  const localDir = joinPath(dl, cfg.emulatorsDir, emuPlatform);
  const stampPath = joinPath(localDir, ".installed.json");
  const romsRoot = (source.romsPath ?? cfg.romsDir).trim() || cfg.romsDir;

  if (!force) {
    const ver = await installedVersion(stampPath);
    if (ver === config.version) {
      await provisionEmulatorConfigs(provider, emuBase, localDir, config, dl, romsRoot, onStatus);
      onStatus?.(`模拟器已就绪（${config.version}）`);
      return { dir: localDir, config, args };
    }
  }

  if (!provider.downloadTo) throw new Error("该存储源不支持下载模拟器。");
  const remoteArchive = joinPath(emuBase, config.archive);
  const cacheDir = joinPath(dl, ".cache", "Emulators", emuPlatform);
  await native.fs.ensureDir(cacheDir);
  const localArchive = joinPath(cacheDir, basename(config.archive));
  onStatus?.(`下载模拟器 ${emuPlatform} ${config.version}…`);
  await provider.downloadTo(remoteArchive, localArchive);

  onStatus?.("解压模拟器…");
  await native.fs.removePath(localDir);
  await native.fs.ensureDir(localDir);
  await native.fs.extractArchive(localArchive, localDir);
  await provisionEmulatorConfigs(provider, emuBase, localDir, config, dl, romsRoot, onStatus);
  await native.fs.writeTextFile(stampPath, JSON.stringify({ version: config.version }));
  return { dir: localDir, config, args };
}

/** 删除本地模拟器（安装目录 + 压缩包缓存）。 */
export async function removeEmulator(
  provider: StorageProvider,
  source: SourceConfig,
  platform: string,
): Promise<void> {
  const cfg = await loadResourceConfig(provider);
  const dl = await getDownloadDir(source);
  await native.fs.removePath(joinPath(dl, cfg.emulatorsDir, platform));
  await native.fs.removePath(joinPath(dl, ".cache", "Emulators", platform));
}

/** 直接打开模拟器（不启动游戏，用于进模拟器设置）。 */
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
  await native.proc.launch(exe, [], workdir);
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
  const dest = joinPath(dl, romRel);

  if (await native.fs.fileExists(dest)) {
    onStatus?.("已下载，直接启动");
  } else {
    onStatus?.(`开始下载 ${basename(romRel)}`);
    await provider.downloadTo(romRel, dest);
    onStatus?.("下载完成");
  }

  if (!extract) return dest;
  const { archives } = await loadResourceConfig(provider);
  return maybeExtract(dest, archives, onStatus);
}

/** 若文件是压缩包则解压，返回内部 ROM 路径。已解压过则直接复用。 */
async function maybeExtract(
  file: string,
  archives: string[],
  onStatus?: (s: string) => void,
): Promise<string> {
  const ext = extname(file);
  if (!archives.includes(ext)) return file;
  const dir = joinPath(dirname(file), stripExt(basename(file)));

  const cached = await firstRomFileSafe(dir, archives);
  if (cached) return cached;

  onStatus?.("解压中…");
  await native.fs.removePath(dir);
  await native.fs.ensureDir(dir);
  await native.fs.extractArchive(file, dir);
  return (await firstRomFile(dir, archives)) ?? file;
}

async function firstRomFileSafe(dir: string, archives: string[]): Promise<string | undefined> {
  try {
    return await firstRomFile(dir, archives);
  } catch {
    return undefined;
  }
}

/** 在目录里递归找第一个非压缩包文件。 */
async function firstRomFile(dir: string, archives: string[]): Promise<string | undefined> {
  const entries = await native.fs.listLocalDir(dir);
  for (const e of entries) {
    if (!e.is_dir && !archives.includes(extname(e.name))) return e.path;
  }
  for (const e of entries) {
    if (e.is_dir) {
      const inner = await firstRomFile(e.path, archives);
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
  const dest = joinPath(dl, ".cache", "media", sourceSlug(provider), relPath);
  if (await native.fs.fileExists(dest)) return dest;

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
