// 确保资源就位：模拟器（按平台，带版本比对）与 ROM（断点续传 + 自动解压）。
import { tauri } from "../shared/tauri";
import { basename, dirname, extname, isAbsolute, joinPath, nativePath, stripExt } from "../shared/path";
import { platform as appPlatform } from "../platform";
import { useStore } from "../state/store";
import type { SourceConfig, StorageProvider } from "../storage/types";
import { parseEmulatorConfig, parseEmulators, parsePlatformMap } from "./parse";
import type { EmulatorsFile } from "./parse";
import { loadResourceConfig, type ResourceConfig } from "./resource-config";
import type { EmulatorConfig } from "./types";
import type { Game } from "./scan";

/** 默认下载目录只解析一次（Rust 侧也会缓存，这里避免重复 invoke）。 */
let defaultDirPromise: Promise<string> | null = null;
function defaultDownloadDir(): Promise<string> {
  if (!defaultDirPromise) {
    defaultDirPromise = (appPlatform.isMobile
      ? tauri.sharedStorageDir() // Android：一律共享存储（ROM 必须能被模拟器 App 读到）
      : tauri.defaultDownloadDir()
    ).catch((e) => {
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

/** 缓存根（配置 / 清单 / 列表等元数据）。
 *  Android 放 App 私有目录：共享目录不随卸载清空，改服务器配置后容易命中旧缓存；
 *  桌面端跟随下载目录。 */
export async function libraryCacheRoot(): Promise<string> {
  const base = appPlatform.isMobile ? await tauri.defaultDownloadDir() : await getDownloadDir();
  return joinPath(base, ".cache", "library");
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
  /** 该 Roms 平台实际使用的启动参数（可能被 platformArgs 覆盖） */
  args?: string[];
}

/** Emulators/<运行平台> 目录（相对存储源根）。 */
async function emulatorOsRoot(source: SourceConfig, cfg: ResourceConfig): Promise<string> {
  const emuRoot = (source.emulatorsPath ?? cfg.emulatorsDir).trim() || cfg.emulatorsDir;
  return joinPath(emuRoot, osFolder(await tauri.hostOs(), cfg.osFolders));
}

/** 读取该运行平台的模拟器配置：优先合并文件 emulators.json，否则回退旧的 platforms.json + 各 config.json。 */
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
      // 没有 platforms.json
    }
    file = { platforms, emulators: {}, platformArgs: {}, warnings: [] };
  }
  if (file.warnings.length > 0) {
    console.warn(`[EmberHub] ${cfg.files.emulators}:\n${file.warnings.join("\n")}`);
  }
  return file;
}

/**
 * 预热模拟器配置缓存（连接/扫描时调用一次）：
 * 让「模拟器」页之后打开时完全读本地缓存、不联网。
 */
export async function warmEmulatorConfig(
  provider: StorageProvider,
  source: SourceConfig,
): Promise<void> {
  try {
    const cfg = await loadResourceConfig(provider);
    const osRoot = await emulatorOsRoot(source, cfg);
    await provider.readText(joinPath(osRoot, cfg.files.emulators));
  } catch {
    /* 忽略：模拟器页仍会按需自行获取 */
  }
}

/** 本地模拟器安装目录 + 版本戳路径。 */
async function emulatorLocal(source: SourceConfig, platform: string, cfg: ResourceConfig) {
  const dl = await getDownloadDir(source);
  const dir = joinPath(dl, cfg.emulatorsDir, platform);
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

/**
 * 就地改写配置里的键：命中同名键整行替换，没有则追加到文件末尾
 * （同名键后写的生效，所以原键被注释掉也能盖住）。
 */
function patchConfigKeys(text: string, set: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(set)) {
    const line = `${key} = "${value}"`;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^[ \\t]*${esc}[ \\t]*=.*$`, "m");
    out = re.test(out) ? out.replace(re, line) : `${out.replace(/\s*$/, "")}\n${line}\n`;
  }
  return out;
}

/**
 * 把 emulators.json 里声明的配置文件写入本地模拟器目录（幂等）。
 * - `content`：直接写文本（支持 {install.dir} / {download.dir} / {roms.dir}）
 * - `from`：从服务器该模拟器目录下载文件（本地已存在则不覆盖）
 * - `set`：就地补齐/纠正配置里的键（文件不存在则跳过）。配置即使是模拟器自己
 *   生成的也保证这一行生效，例如 RetroArch 的 input_menu_toggle_gamepad_combo
 * 全部失败只记录警告，不阻断启动。
 */
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
  const vars = {
    installDir: localDir,
    downloadDir,
    romsDir: joinPath(downloadDir, romsRoot),
  };
  for (const f of list) {
    const dest = joinPath(localDir, f.to);
    try {
      // 1) 先保证文件存在：from 从服务器下载（已存在则不覆盖），content 直接写文本
      if (f.from) {
        if (!(await tauri.fileExists(dest))) {
          if (!provider.downloadTo) continue;
          onStatus?.(`写入配置 ${f.to}`);
          await provider.downloadTo(joinPath(emuBase, f.from), dest);
        }
      } else if (f.content !== undefined) {
        const content = applyConfigPlaceholders(f.content, vars);
        const existing = (await tauri.fileExists(dest))
          ? await tauri.readTextFile(dest).catch(() => null)
          : null;
        if (existing !== content) {
          onStatus?.(`写入配置 ${f.to}`);
          await tauri.writeTextFile(dest, content);
        }
      }

      // 2) 再就地补齐/纠正 set 里的键：文件已存在也一样处理（不覆盖其它设置）
      if (f.set && Object.keys(f.set).length > 0 && (await tauri.fileExists(dest))) {
        const text = await tauri.readTextFile(dest).catch(() => null);
        if (text != null) {
          const want: Record<string, string> = {};
          for (const [k, v] of Object.entries(f.set)) want[k] = applyConfigPlaceholders(v, vars);
          const next = patchConfigKeys(text, want);
          if (next !== text) {
            onStatus?.(`更新配置 ${f.to}`);
            await tauri.writeTextFile(dest, next);
          }
        }
      }
    } catch (e) {
      console.warn(`[EmberHub] 预置配置失败 ${f.to}:`, e);
    }
  }
}

/** 模拟器信息（服务器配置 + 本地安装状态）。 */
export interface EmulatorInfo {
  /** 模拟器平台（Emulators/<OS>/ 下的文件夹名） */
  platform: string;
  version: string;
  archive: string;
  exe: string;
  /** Android：网盘上的 APK 文件名（相对 Emulators/<OS>/），有则可「下载并安装」 */
  apk?: string;
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
          parseEmulatorConfig(
            await provider.readText(joinPath(osRoot, platform, cfg.files.emulatorConfig)),
          ),
        ]);
      } catch {
        // 跳过没有 config.json 的目录
      }
    }
  }

  const out: EmulatorInfo[] = [];
  const mobile = appPlatform.isMobile;
  for (const [platform, config] of entries) {
    // 移动端模拟器是「已安装的 App」：没有本地安装目录 / 版本戳
    const ver = mobile
      ? config.version
      : await installedVersion((await emulatorLocal(source, platform, cfg)).stampPath);
    out.push({
      platform,
      version: config.version,
      archive: config.archive,
      exe: config.exe,
      apk: config.apk,
      installed: mobile ? true : ver !== undefined,
      installedVersion: ver,
    });
  }
  return out.sort((a, b) => a.platform.localeCompare(b.platform));
}

/**
 * Android：模拟器未安装 —— 已下载 APK 并拉起系统安装器。
 * 调用方（启动流程）据此记下「待启动游戏」，回到前台复查后再自动继续；
 * 不在原地等待（WebView 退到后台会挂起/被回收）。
 */
export class EmulatorInstallingError extends Error {
  constructor(
    /** 目标模拟器包名 */
    public readonly pkg: string,
    message: string,
  ) {
    super(message);
    this.name = "EmulatorInstallingError";
  }
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

  // 平台映射（无则同名）
  const emuPlatform = platforms[platform] ?? platform;

  // 服务器结构：Emulators/<运行平台>/<游戏平台>/
  const emuBase = joinPath(osRoot, emuPlatform);
  // 优先用合并配置，回退单文件 config.json
  const config =
    emulators[emuPlatform] ??
    parseEmulatorConfig(await provider.readText(joinPath(emuBase, cfg.files.emulatorConfig)));

  // 该 Roms 平台的启动参数：platformArgs 覆盖 > 模拟器自身 args
  const args = platformArgs[platform] ?? config.args;

  // Android：模拟器是设备上已安装的 App（用 package/exe 指定包名）。
  // 先检测是否已安装：没装就下载 APK、拉起系统安装器，然后轮询等待装完再继续启动。
  if (appPlatform.isMobile) {
    const pkg = (config.package?.trim() || config.exe).trim();
    if (await appPlatform.isEmulatorInstalled(pkg)) {
      // 每个模拟器首次使用时：先打开它一次，让它弹出自己的存储授权
      // （Android 规定运行时权限只能由该 App 自己申请）；之后回来自动继续启动。
      if (useStore.getState().configuredEmulators.includes(pkg)) {
        onStatus?.(`使用已安装的模拟器（${pkg}）`);
        return { dir: "", config, args };
      }
      useStore.getState().markEmulatorConfigured(pkg);
      onStatus?.(`首次使用 ${pkg}：正在打开它，请允许它的存储权限…`);
      await appPlatform.launchEmulator(pkg, [], undefined, { package: pkg });
      throw new EmulatorInstallingError(
        pkg,
        `请在 ${pkg} 里允许「存储」权限；授权后回到本应用会自动继续启动。`,
      );
    }
    onStatus?.(`未安装模拟器 ${pkg}，开始下载安装…`);
    await installEmulator(provider, source, platform, onStatus);
    // 不在原地等安装完成：抛错交给启动流程记录「待启动游戏」，
    // 回到前台时复查（已安装则自动继续）。
    throw new EmulatorInstallingError(
      pkg,
      `模拟器 ${pkg} 尚未安装：已下载 APK 并打开系统安装器，安装完成后会自动继续启动。`,
    );
  }

  const dl = await getDownloadDir(source);
  const localDir = joinPath(dl, cfg.emulatorsDir, emuPlatform);
  const stampPath = joinPath(localDir, ".installed.json");
  const romsRoot = (source.romsPath ?? cfg.romsDir).trim() || cfg.romsDir;

  // 版本比对：已安装且版本一致则直接用（仍补写一次配置，保证配置变更能生效）
  if (!force) {
    const ver = await installedVersion(stampPath);
    if (ver === config.version) {
      await provisionEmulatorConfigs(provider, emuBase, localDir, config, dl, romsRoot, onStatus);
      onStatus?.(`模拟器已就绪（${config.version}）`);
      return { dir: localDir, config, args };
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
  await provisionEmulatorConfigs(provider, emuBase, localDir, config, dl, romsRoot, onStatus);
  await tauri.writeTextFile(stampPath, JSON.stringify({ version: config.version }));
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
  await tauri.removePath(joinPath(dl, cfg.emulatorsDir, platform));
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
  // Android：直接打开模拟器 App（不带 ROM，用于进它自己的设置）
  if (appPlatform.isMobile) {
    const pkg = (config.package?.trim() || config.exe).trim();
    onStatus?.("打开模拟器…");
    await appPlatform.launchEmulator(pkg, [], undefined, { package: pkg });
    return;
  }
  const exe = nativePath(isAbsolute(config.exe) ? config.exe : joinPath(dir, config.exe));
  const workdir = nativePath(config.workdir ? joinPath(dir, config.workdir) : dirname(exe));
  onStatus?.("打开模拟器…");
  await tauri.launchEmulator(exe, [], workdir);
}

/**
 * Android：从网盘下载模拟器 APK 并交给系统安装器安装（会弹安装确认）。
 * 需要 emulators.json 里该模拟器配置了 `apk`（相对 Emulators/<OS>/ 的文件名）。
 */
export async function installEmulator(
  provider: StorageProvider,
  source: SourceConfig,
  platform: string,
  onStatus?: (s: string) => void,
): Promise<void> {
  if (!appPlatform.isMobile) throw new Error("仅 Android 支持 APK 安装。");
  const cfg = await loadResourceConfig(provider);
  const osRoot = await emulatorOsRoot(source, cfg);
  const { platforms, emulators } = await loadEmulators(provider, osRoot, cfg);
  const emuPlatform = platforms[platform] ?? platform;
  const emuBase = joinPath(osRoot, emuPlatform);
  const config =
    emulators[emuPlatform] ??
    parseEmulatorConfig(await provider.readText(joinPath(emuBase, cfg.files.emulatorConfig)));

  let apk = config.apk?.trim();
  if (!apk) throw new Error("该模拟器未配置 APK（emulators.json 的 apk 字段）。");
  // APK 名里可用 {abi} 占位（如 EmberHub-RetroArch-{abi}.apk），按设备 ABI 选择
  if (apk.includes("{abi}")) {
    const abi = (await tauri.deviceAbi()).trim();
    if (!abi) throw new Error("无法获取设备 ABI，无法选择模拟器安装包。");
    apk = apk.replace(/\{abi\}/g, abi);
  }
  if (!provider.downloadTo) throw new Error("该存储源不支持下载。");

  const dl = await getDownloadDir(source);
  const dest = joinPath(dl, cfg.emulatorsDir, emuPlatform, basename(apk));
  onStatus?.(`下载 ${basename(apk)}…`);
  await provider.downloadTo(joinPath(emuBase, apk), dest);
  onStatus?.("启动安装器…");
  await tauri.installApk(nativePath(dest));
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

  // 已经解压过（目录里已有 ROM）就不再重复解压
  const cached = await firstRomFileSafe(dir, archives);
  if (cached) return cached;

  onStatus?.("解压中…");
  await tauri.removePath(dir);
  await tauri.ensureDir(dir);
  await tauri.extractArchive(file, dir);
  return (await firstRomFile(dir, archives)) ?? file;
}

/** firstRomFile 的容错版：目录不存在 / 不可读时返回 undefined。 */
async function firstRomFileSafe(
  dir: string,
  archives: string[],
): Promise<string | undefined> {
  try {
    return await firstRomFile(dir, archives);
  } catch {
    return undefined;
  }
}

/** 在目录里递归找第一个非压缩包文件。 */
async function firstRomFile(dir: string, archives: string[]): Promise<string | undefined> {
  const entries = await tauri.listLocalDir(dir);
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
