// 游戏库扫描：读取自定义 JSON 资源（manifest.json + Roms/<平台>/games.json）。
// 封面/视频不在扫描阶段解析（避免大量目录请求），改为显示时懒加载并缓存。
import type { StorageProvider } from "../storage/types";
import { basename, isAbsolute, joinPath, stripExt } from "../shared/path";
import { parsePlatformGames } from "./parse";
import { DEFAULT_MEDIA_VARIANTS, buildVariantRegex, matchMediaDir } from "./media-match";
import { clearMediaCache } from "./media-cache";
import {
  clearResourceConfigCache,
  loadResourceConfig,
  setActiveResourceConfig,
  type ResourceConfig,
} from "./resource-config";

export interface Game {
  id: string;
  title: string;
  /** 平台（Roms 下的文件夹名） */
  collection: string;
  /** 平台显示名（games.json 的 name，缺省为 collection） */
  platformName?: string;
  files: string[];
  developer?: string;
  publisher?: string;
  genre?: string;
  players?: string;
  release?: string;
  /** 归一化为 0~1 */
  rating?: number;
  description?: string;
  /** 启动命令（游戏级或平台级，Roms 优先） */
  launch?: string;
  /** 使用 Roms 级 launch 时是否解压 ROM 压缩包（默认 true） */
  extract?: boolean;
  /** 显式指定的封面路径（games.json 里的 cover） */
  coverPath?: string;
  /** 该游戏对应的 media 子目录（懒加载封面/视频用） */
  mediaDir?: string;
  /** 服务器上是否存在该游戏文件（undefined = 未检查，如列目录失败） */
  available?: boolean;
}

export interface ScanResult {
  collections: string[];
  games: Game[];
  warnings: string[];
}

function normalizeRel(baseDir: string, file: string): string {
  const f = file.replace(/\\/g, "/").trim();
  if (f === "") return f;
  if (isAbsolute(f)) return f;
  return joinPath(baseDir, f);
}

/** 建立 media 子目录索引（每个平台只列一次）。 */
async function mediaIndex(
  provider: StorageProvider,
  baseDir: string,
  cfg: ResourceConfig,
  cache: Map<string, Map<string, string>>,
): Promise<Map<string, string>> {
  const mediaDir = joinPath(baseDir, cfg.media.dir);
  let index = cache.get(mediaDir);
  if (!index) {
    index = new Map();
    try {
      for (const e of await provider.list(mediaDir)) {
        if (e.isDir) index.set(e.name.toLowerCase(), e.name);
      }
    } catch {
      // 没有 media 目录
    }
    cache.set(mediaDir, index);
  }
  return index;
}

/** 递归列出平台目录下的文件名（小写，含子文件夹，跳过 media/），用于判断游戏文件是否已上传。失败返回 null（不判断）。 */
async function listPlatformFiles(
  provider: StorageProvider,
  baseDir: string,
  cfg: ResourceConfig,
): Promise<Set<string> | null> {
  try {
    const set = new Set<string>();
    const mediaDirName = cfg.media.dir.toLowerCase();
    const walk = async (dir: string, depth: number): Promise<void> => {
      const entries = await provider.list(dir);
      const subdirs: string[] = [];
      for (const e of entries) {
        if (e.isDir) {
          if (e.name.toLowerCase() !== mediaDirName) subdirs.push(e.path);
        } else {
          set.add(e.name.toLowerCase());
        }
      }
      if (depth > 0 && subdirs.length > 0) {
        await Promise.all(subdirs.map((d) => walk(d, depth - 1)));
      }
    };
    await walk(baseDir, cfg.fileDepth);
    return set;
  } catch {
    return null;
  }
}

/** 扫描单个平台。失败只记录警告，不影响其它平台。 */
async function scanPlatform(
  provider: StorageProvider,
  romsPath: string,
  platform: string,
  variantRe: RegExp | null,
  mediaCache: Map<string, Map<string, string>>,
  cfg: ResourceConfig,
): Promise<{ games: Game[]; warnings: string[] }> {
  const baseDir = joinPath(romsPath, platform);
  const gamesPath = joinPath(baseDir, cfg.files.games);
  const warnings: string[] = [];

  let text: string;
  try {
    text = await provider.readText(gamesPath);
  } catch (e) {
    warnings.push(`读取失败：${gamesPath}（${String(e)}）`);
    return { games: [], warnings };
  }

  let pg;
  try {
    pg = parsePlatformGames(text, platform);
  } catch (e) {
    warnings.push(`解析失败：${gamesPath}（${String(e)}）`);
    return { games: [], warnings };
  }

  // media 目录索引 + 平台文件列表并行请求
  const [index, fileSet] = await Promise.all([
    mediaIndex(provider, baseDir, cfg, mediaCache),
    listPlatformFiles(provider, baseDir, cfg),
  ]);

  const mediaDirAbs = joinPath(baseDir, cfg.media.dir);
  const mediaPrefix = cfg.media.dir.toLowerCase() + "/";

  const games: Game[] = [];
  for (const gm of pg.games) {
    const file = normalizeRel(baseDir, gm.file);
    const game: Game = {
      id: file,
      title: gm.title,
      collection: platform,
      platformName: pg.name ?? platform,
      files: [file],
      developer: gm.developer,
      publisher: gm.publisher,
      genre: gm.genre,
      players: gm.players !== undefined ? String(gm.players) : undefined,
      release: gm.release,
      rating:
        gm.rating !== undefined
          ? gm.rating > 1
            ? gm.rating / cfg.ratingScale
            : gm.rating
          : undefined,
      description: gm.description,
      launch: gm.launch ?? pg.launch,
      extract: gm.extract ?? pg.extract,
      coverPath: gm.cover ? normalizeRel(baseDir, gm.cover) : undefined,
      available: fileSet ? fileSet.has(basename(file).toLowerCase()) : undefined,
    };

    // media 目录：games.json 的 media 字段 > 按标题模糊匹配（都校验目录确实存在）
    const explicit = gm.media ?? "";
    const stripped = explicit.toLowerCase().startsWith(mediaPrefix)
      ? explicit.slice(mediaPrefix.length)
      : explicit;
    const explicitDir = stripped.replace(/\/+$/, "");
    const explicitHit = explicitDir ? index.get(explicitDir.toLowerCase()) : undefined;
    if (explicitHit) {
      game.mediaDir = joinPath(mediaDirAbs, explicitHit);
    } else if (!game.coverPath) {
      const candidates = [game.title];
      if (file) {
        const f = file.replace(/\\/g, "/");
        candidates.push(stripExt(basename(f)));
        const first = f.split("/")[0];
        if (first && first !== f) candidates.push(first);
      }
      const sub = matchMediaDir(index, candidates, variantRe);
      if (sub) game.mediaDir = joinPath(mediaDirAbs, sub);
    }

    games.push(game);
  }

  return { games, warnings };
}

// 同一次扫描（同源 + 同路径）在途去重：React StrictMode 会重复触发 effect，避免扫两遍。
const scanCache = new Map<string, Promise<ScanResult>>();

async function doScan(provider: StorageProvider, romsPath: string): Promise<ScanResult> {
  // 重新扫描时清掉缓存，确保新增的封面/视频、改动过的 manifest 能被发现
  clearMediaCache();
  clearResourceConfigCache();

  const warnings: string[] = [];
  const cfg = await loadResourceConfig(provider, true);
  setActiveResourceConfig(cfg);
  const variantRe = buildVariantRegex(
    cfg.mediaVariants.length ? cfg.mediaVariants : DEFAULT_MEDIA_VARIANTS,
  );
  const mediaCache = new Map<string, Map<string, string>>();

  // 各平台并行扫描（请求量大时明显更快）
  const perPlatform = await Promise.all(
    cfg.platforms.map((platform) =>
      scanPlatform(provider, romsPath, platform, variantRe, mediaCache, cfg),
    ),
  );

  const games: Game[] = [];
  for (const r of perPlatform) {
    games.push(...r.games);
    warnings.push(...r.warnings);
  }

  // 平台顺序跟随 manifest.platforms（只保留实际有游戏的），未知平台追加在后
  const present = new Set(games.map((g) => g.collection));
  const collections = cfg.platforms.filter((p) => present.has(p));
  for (const c of present) if (!collections.includes(c)) collections.push(c);
  return { collections, games, warnings };
}

/** 懒加载会话：打开库后复用（资源约定 + 变体正则 + media 目录索引缓存）。 */
export interface LibrarySession {
  cfg: ResourceConfig;
  variantRe: RegExp | null;
  mediaCache: Map<string, Map<string, string>>;
}

/** 打开游戏库：读取并应用 manifest，返回可复用会话（供按平台懒加载）。 */
export async function openLibrary(provider: StorageProvider): Promise<LibrarySession> {
  clearMediaCache();
  clearResourceConfigCache();
  const cfg = await loadResourceConfig(provider, true);
  setActiveResourceConfig(cfg);
  const variantRe = buildVariantRegex(
    cfg.mediaVariants.length ? cfg.mediaVariants : DEFAULT_MEDIA_VARIANTS,
  );
  return { cfg, variantRe, mediaCache: new Map() };
}

/** 扫描单个平台（懒加载：切到哪个平台才扫哪个）。 */
export function scanPlatformOf(
  session: LibrarySession,
  provider: StorageProvider,
  romsPath: string,
  platform: string,
): Promise<{ games: Game[]; warnings: string[] }> {
  return scanPlatform(provider, romsPath, platform, session.variantRe, session.mediaCache, session.cfg);
}

/** 扫描资源服务器，构建游戏库。romsPath 默认 "Roms"。 */
export function scanLibrary(provider: StorageProvider, romsPath = "Roms"): Promise<ScanResult> {
  const key = `${provider.key}|${romsPath}`;
  const inflight = scanCache.get(key);
  if (inflight) return inflight;

  const task = doScan(provider, romsPath);
  scanCache.set(key, task);
  task.then(
    () => scanCache.delete(key),
    () => scanCache.delete(key),
  );
  return task;
}
