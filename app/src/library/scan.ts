// 游戏库扫描：读取自定义 JSON 资源（manifest.json + Roms/<平台>/games.json）。
// 封面/视频不在扫描阶段解析（避免大量目录请求），改为显示时懒加载并缓存。
import type { StorageProvider } from "../storage/types";
import { basename, isAbsolute, joinPath, stripExt } from "../lib/path";
import { parseManifest, parseMediaMap, parsePlatformGames } from "./parse";
import { DEFAULT_MEDIA_VARIANTS, buildVariantRegex, matchMediaDir } from "./media-match";
import { clearMediaCache } from "./media-cache";

export interface Game {
  id: string;
  title: string;
  /** 平台（Roms 下的文件夹名） */
  collection: string;
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
  /** 显式指定的封面路径（games.json 里的 cover） */
  coverPath?: string;
  /** 该游戏对应的 media 子目录（懒加载封面/视频用） */
  mediaDir?: string;
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
  cache: Map<string, Map<string, string>>,
): Promise<Map<string, string>> {
  const mediaDir = joinPath(baseDir, "media");
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

/** 扫描单个平台。失败只记录警告，不影响其它平台。 */
async function scanPlatform(
  provider: StorageProvider,
  romsPath: string,
  platform: string,
  variantRe: RegExp | null,
  mediaCache: Map<string, Map<string, string>>,
): Promise<{ games: Game[]; warnings: string[] }> {
  const baseDir = joinPath(romsPath, platform);
  const gamesPath = joinPath(baseDir, "games.json");
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

  // media 目录索引 + 可选的 media-map.json 并行请求
  const [index, mediaMapText] = await Promise.all([
    mediaIndex(provider, baseDir, mediaCache),
    provider.readText(joinPath(baseDir, "media-map.json")).catch(() => ""),
  ]);

  let mediaMap: Record<string, string> = {};
  if (mediaMapText) {
    try {
      mediaMap = parseMediaMap(mediaMapText);
    } catch {
      // 映射文件损坏时忽略
    }
  }

  const games: Game[] = [];
  for (const gm of pg.games) {
    const file = normalizeRel(baseDir, gm.file);
    const game: Game = {
      id: file,
      title: gm.title,
      collection: platform,
      files: [file],
      developer: gm.developer,
      publisher: gm.publisher,
      genre: gm.genre,
      players: gm.players !== undefined ? String(gm.players) : undefined,
      release: gm.release,
      rating: gm.rating !== undefined ? (gm.rating > 1 ? gm.rating / 100 : gm.rating) : undefined,
      description: gm.description,
      launch: gm.launch ?? pg.launch,
      coverPath: gm.cover ? normalizeRel(baseDir, gm.cover) : undefined,
    };

    // media 目录：games.json 的 media > media-map.json > 模糊匹配（都校验目录确实存在）
    const explicit = gm.media ?? mediaMap[gm.title] ?? "";
    const explicitDir = explicit.replace(/^media\//i, "").replace(/\/+$/, "");
    const explicitHit = explicitDir ? index.get(explicitDir.toLowerCase()) : undefined;
    if (explicitHit) {
      game.mediaDir = joinPath(baseDir, "media", explicitHit);
    } else if (!game.coverPath) {
      const candidates = [game.title];
      if (file) {
        const f = file.replace(/\\/g, "/");
        candidates.push(stripExt(basename(f)));
        const first = f.split("/")[0];
        if (first && first !== f) candidates.push(first);
      }
      const sub = matchMediaDir(index, candidates, variantRe);
      if (sub) game.mediaDir = joinPath(baseDir, "media", sub);
    }

    games.push(game);
  }

  return { games, warnings };
}

// 同一次扫描（同源 + 同路径）在途去重：React StrictMode 会重复触发 effect，避免扫两遍。
const scanCache = new Map<string, Promise<ScanResult>>();

async function doScan(provider: StorageProvider, romsPath: string): Promise<ScanResult> {
  // 重新扫描时清掉媒体目录缓存，确保新增的封面/视频能被发现
  clearMediaCache();

  const warnings: string[] = [];
  const manifestText = await provider.readText("manifest.json");
  const manifest = parseManifest(manifestText);
  const variantRe = buildVariantRegex(manifest.mediaVariants ?? DEFAULT_MEDIA_VARIANTS);
  const mediaCache = new Map<string, Map<string, string>>();

  // 各平台并行扫描（请求量大时明显更快）
  const perPlatform = await Promise.all(
    manifest.platforms.map((platform) =>
      scanPlatform(provider, romsPath, platform, variantRe, mediaCache),
    ),
  );

  const games: Game[] = [];
  for (const r of perPlatform) {
    games.push(...r.games);
    warnings.push(...r.warnings);
  }

  const collections = Array.from(new Set(games.map((g) => g.collection))).sort();
  return { collections, games, warnings };
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
