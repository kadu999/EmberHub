// 自定义 JSON 资源的解析与校验。
import type {
  EmulatorConfig,
  EmulatorFile,
  GameMeta,
  Manifest,
  MediaPickSpec,
  PlatformGames,
  PlatformMap,
} from "./types";

function asObject(text: string, what: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`${what} 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${what} 应为 JSON 对象`);
  }
  return data as Record<string, unknown>;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const strArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : undefined;

/** 解析 { 键: 字符串 } 形式（仅保留字符串值）。 */
function strMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

/** 解析 { 键: { 键: 字符串 } } 形式（跳过非法项）。 */
function strMapMap(v: unknown): Record<string, Record<string, string>> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const m = strMap(val);
    if (m) out[k] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 解析媒体文件名 / 扩展名约定。 */
function parsePickSpec(v: unknown): MediaPickSpec | undefined {
  const o = asOptionalObject(v);
  if (!o) return undefined;
  const spec: MediaPickSpec = {};
  const names = strArray(o.names);
  const exts = strArray(o.exts);
  if (names) spec.names = names;
  if (exts) spec.exts = exts;
  return spec;
}

function asOptionalObject(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

export function parseManifest(text: string): Manifest {
  const o = asObject(text, "manifest.json");
  if (!Array.isArray(o.platforms) || o.platforms.some((p) => typeof p !== "string")) {
    throw new Error("manifest.json 的 platforms 应为字符串数组");
  }

  const dirsRaw = asOptionalObject(o.dirs);
  const filesRaw = asOptionalObject(o.files);
  const mediaRaw = asOptionalObject(o.media);
  const scanRaw = asOptionalObject(o.scan);

  const manifest: Manifest = {
    platforms: o.platforms as string[],
    mediaVariants: strArray(o.mediaVariants),
    osFolders: strMap(o.osFolders),
  };

  if (dirsRaw) {
    const dirs: Manifest["dirs"] = {};
    if (str(dirsRaw.roms)) dirs.roms = str(dirsRaw.roms);
    if (str(dirsRaw.emulators)) dirs.emulators = str(dirsRaw.emulators);
    manifest.dirs = dirs;
  }
  if (filesRaw) {
    const files: Manifest["files"] = {};
    for (const k of ["games", "emulators", "emulatorConfig", "platformMap"] as const) {
      if (str(filesRaw[k])) files[k] = str(filesRaw[k]);
    }
    manifest.files = files;
  }
  if (mediaRaw) {
    const media: Manifest["media"] = {};
    if (str(mediaRaw.dir)) media.dir = str(mediaRaw.dir);
    media.cover = parsePickSpec(mediaRaw.cover);
    media.video = parsePickSpec(mediaRaw.video);
    manifest.media = media;
  }
  if (Array.isArray(o.archives)) {
    const archives = strArray(o.archives);
    if (archives) manifest.archives = archives;
  }
  if (scanRaw) {
    const scan: Manifest["scan"] = {};
    if (typeof scanRaw.fileDepth === "number" && scanRaw.fileDepth >= 0) {
      scan.fileDepth = Math.floor(scanRaw.fileDepth);
    }
    manifest.scan = scan;
  }
  if (typeof o.ratingScale === "number" && o.ratingScale > 0) {
    manifest.ratingScale = o.ratingScale;
  }
  return manifest;
}

export function parsePlatformGames(text: string, fallbackPlatform: string): PlatformGames {
  const o = asObject(text, "games.json");
  if (!Array.isArray(o.games)) throw new Error("games.json 的 games 应为数组");

  const games: GameMeta[] = o.games.map((g, i) => {
    if (typeof g !== "object" || g === null || Array.isArray(g)) {
      throw new Error(`games[${i}] 应为对象`);
    }
    const gg = g as Record<string, unknown>;
    const title = str(gg.title);
    const file = str(gg.file);
    if (!title) throw new Error(`games[${i}].title 缺失`);
    if (!file) throw new Error(`games[${i}].file 缺失`);
    return {
      title,
      file,
      cover: str(gg.cover),
      media: str(gg.media),
      developer: str(gg.developer),
      publisher: str(gg.publisher),
      genre: str(gg.genre),
      players: typeof gg.players === "number" || typeof gg.players === "string" ? gg.players : undefined,
      release: str(gg.release),
      rating: typeof gg.rating === "number" ? gg.rating : undefined,
      description: str(gg.description),
      launch: str(gg.launch),
      extract: typeof gg.extract === "boolean" ? gg.extract : undefined,
    };
  });

  return {
    platform: str(o.platform) ?? fallbackPlatform,
    name: str(o.name),
    launch: str(o.launch),
    extract: typeof o.extract === "boolean" ? o.extract : undefined,
    games,
  };
}

export function parsePlatformMap(text: string): PlatformMap {
  const o = asObject(text, "platforms.json");
  const out: PlatformMap = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Emulators/<OS>/emulators.json：平台映射 + 各模拟器配置合并在一个文件里。 */
export interface EmulatorsFile {
  /** Roms 平台 → 模拟器平台 */
  platforms: PlatformMap;
  /** 模拟器平台 → 配置 */
  emulators: Record<string, EmulatorConfig>;
  /** Roms 平台 → 启动参数（可选，覆盖该模拟器 args；用于一份共享模拟器按平台用不同 core） */
  platformArgs: Record<string, string[]>;
  /** 解析过程中被跳过的条目说明 */
  warnings: string[];
}

function emulatorConfigFrom(o: Record<string, unknown>, fallbackPlatform: string): EmulatorConfig {
  // version / archive 可选：Android 端模拟器是「已安装的 App」，没有可下载的压缩包
  const version = str(o.version) ?? "0";
  const archive = str(o.archive) ?? "";
  const exe = str(o.exe);
  if (!exe) throw new Error("模拟器配置缺少 exe");
  return {
    platform: str(o.platform) ?? fallbackPlatform,
    version,
    archive,
    exe,
    args: Array.isArray(o.args) ? (o.args.filter((a) => typeof a === "string") as string[]) : undefined,
    workdir: str(o.workdir),
    extract: typeof o.extract === "boolean" ? o.extract : undefined,
    configs: parseEmulatorFiles(o.configs),
    package: str(o.package),
    mime: str(o.mime),
    apk: str(o.apk),
    activity: str(o.activity),
    extras: strMap(o.extras),
    platformExtras: strMapMap(o.platformExtras),
  };
}

/** 解析「解压后预置文件」列表，非法项跳过。 */
function parseEmulatorFiles(v: unknown): EmulatorFile[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: EmulatorFile[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const to = str(o.to);
    if (!to) continue;
    const from = str(o.from);
    const content = typeof o.content === "string" ? o.content : undefined;
    if (from === undefined && content === undefined) continue;
    out.push({ to, from, content });
  }
  return out.length > 0 ? out : undefined;
}

export function parseEmulatorConfig(text: string): EmulatorConfig {
  return emulatorConfigFrom(asObject(text, "config.json"), "");
}

/** 解析合并后的 emulators.json（兼容旧结构：单独读 platforms.json / config.json）。 */
export function parseEmulators(text: string): EmulatorsFile {
  const o = asObject(text, "emulators.json");
  const platforms: PlatformMap = {};
  if (o.platforms && typeof o.platforms === "object" && !Array.isArray(o.platforms)) {
    for (const [k, v] of Object.entries(o.platforms as Record<string, unknown>)) {
      if (typeof v === "string") platforms[k] = v;
    }
  }
  const emulators: Record<string, EmulatorConfig> = {};
  const warnings: string[] = [];
  if (o.emulators && typeof o.emulators === "object" && !Array.isArray(o.emulators)) {
    for (const [k, v] of Object.entries(o.emulators as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        try {
          emulators[k] = emulatorConfigFrom(v as Record<string, unknown>, k);
        } catch (e) {
          warnings.push(
            `模拟器「${k}」配置无效，已跳过：${e instanceof Error ? e.message : String(e)}`,
          );
        }
      } else {
        warnings.push(`模拟器「${k}」不是对象，已跳过`);
      }
    }
  }
  const platformArgs: Record<string, string[]> = {};
  if (o.platformArgs && typeof o.platformArgs === "object" && !Array.isArray(o.platformArgs)) {
    for (const [k, v] of Object.entries(o.platformArgs as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const arr = v.filter((x) => typeof x === "string") as string[];
        if (arr.length > 0) platformArgs[k] = arr;
      }
    }
  }
  return { platforms, emulators, platformArgs, warnings };
}
