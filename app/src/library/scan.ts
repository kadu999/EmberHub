// 游戏库扫描：读取自定义 JSON 资源（manifest.json + Roms/<平台>/games.json）。
// 封面/视频不在扫描阶段解析（避免大量目录请求），改为显示时懒加载。
import type { StorageProvider } from "../storage/types";
import { basename, isAbsolute, joinPath, stripExt } from "../lib/path";
import { parseManifest, parsePlatformGames } from "./parse";

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
  /** 内部：Roms/<平台> 目录 */
  _baseDir?: string;
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

function normalizeKey(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[·・．。:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 在 media 索引里为游戏找匹配目录：精确 → 规整 → 前缀 → 包含。 */
function matchMediaDir(index: Map<string, string>, candidates: string[]): string | undefined {
  const raw = candidates.map((c) => c.toLowerCase()).filter((c) => c !== "");
  for (const c of raw) {
    const hit = index.get(c);
    if (hit) return hit;
  }

  const norm = [...new Set(candidates.map(normalizeKey).filter((s) => s.length >= 2))];
  for (const n of norm) {
    const hit = index.get(n);
    if (hit) return hit;
  }

  let best: string | undefined;
  let bestLen = 0;

  // 前缀匹配（标题带后缀、文件夹是基础名，或反之），取最长
  for (const [key, name] of index) {
    const k = normalizeKey(key);
    if (k.length < 3) continue;
    for (const n of norm) {
      if (n.length < 3) continue;
      if (n.startsWith(k) || k.startsWith(n)) {
        const len = Math.min(k.length, n.length);
        if (len > bestLen) {
          best = name;
          bestLen = len;
        }
      }
    }
  }
  if (best) return best;

  // 包含匹配（更宽松）
  for (const [key, name] of index) {
    const k = normalizeKey(key);
    if (k.length < 5) continue;
    for (const n of norm) {
      if (n.length < 5) continue;
      if (n.includes(k) || k.includes(n)) {
        const len = Math.min(k.length, n.length);
        if (len > bestLen) {
          best = name;
          bestLen = len;
        }
      }
    }
  }
  if (best) return best;

  // 词元重叠匹配（处理「…迷宫战记1+2 汉化版」vs「…迷宫战记 汉化版」这类）
  let bestScore = 0;
  let bestName: string | undefined;
  for (const [key, name] of index) {
    const kt = normalizeKey(key).split(" ").filter(Boolean);
    if (kt.length === 0) continue;
    for (const n of norm) {
      const nt = n.split(" ").filter(Boolean);
      if (nt.length === 0) continue;
      let ov = 0;
      for (const a of kt) {
        if (nt.some((b) => a === b || a.startsWith(b) || b.startsWith(a))) ov++;
      }
      const score = ov / Math.max(kt.length, nt.length);
      if (ov >= 2 && score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }
  }
  if (bestName && bestScore >= 0.6) return bestName;

  return undefined;
}

/** 扫描资源服务器，构建游戏库。romsPath 默认 "Roms"。 */
export async function scanLibrary(
  provider: StorageProvider,
  romsPath = "Roms",
): Promise<ScanResult> {
  const warnings: string[] = [];
  const games: Game[] = [];

  const manifestText = await provider.readText("manifest.json");
  const manifest = parseManifest(manifestText);
  const mediaCache = new Map<string, Map<string, string>>();

  for (const platform of manifest.platforms) {
    const baseDir = joinPath(romsPath, platform);
    let text: string;
    try {
      text = await provider.readText(joinPath(baseDir, "games.json"));
    } catch (e) {
      warnings.push(`读取失败：${baseDir}/games.json（${String(e)}）`);
      continue;
    }

    let pg;
    try {
      pg = parsePlatformGames(text, platform);
    } catch (e) {
      warnings.push(`解析失败：${baseDir}/games.json（${String(e)}）`);
      continue;
    }

    const index = await mediaIndex(provider, baseDir, mediaCache);

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
        _baseDir: baseDir,
      };

      // 懒加载：只记录 media 子目录，不在这里列目录
      if (!game.coverPath) {
        const candidates = [game.title];
        if (file) {
          const f = file.replace(/\\/g, "/");
          candidates.push(stripExt(basename(f)));
          const first = f.split("/")[0];
          if (first && first !== f) candidates.push(first);
        }
        const sub = matchMediaDir(index, candidates);
        if (sub) game.mediaDir = joinPath(baseDir, "media", sub);
      }

      games.push(game);
    }
  }

  const collections = Array.from(new Set(games.map((g) => g.collection))).sort();
  return { collections, games, warnings };
}
