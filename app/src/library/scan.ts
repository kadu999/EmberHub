// 游戏库扫描：在存储源里查找 Pegasus 元数据文件，解析成游戏列表。
import type { StorageProvider } from "../storage/types";
import { basename, dirname, extname, isAbsolute, joinPath, stripExt } from "../lib/path";
import { parsePegasus, type PegasusCollection } from "./pegasus";

export interface Game {
  id: string;
  title: string;
  collection: string;
  files: string[];
  developer?: string;
  genre?: string;
  players?: string;
  release?: string;
  rating?: number;
  description?: string;
  /** 启动命令（来自 game 或 collection 的 launch） */
  launch?: string;
  workdir?: string;
  /** 封面在存储源中的相对路径 */
  coverPath?: string;
  /** 内部：元数据所在目录（用于解析素材） */
  _baseDir?: string;
  /** 内部：显式 assets 字段 */
  _assets?: Record<string, string>;
}

export interface ScanResult {
  collections: string[];
  games: Game[];
  warnings: string[];
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const COVER_PRIORITY = [
  "boxfront",
  "box_front",
  "box2dfront",
  "box_front_2d",
  "cover",
  "front",
  "tile",
  "banner",
  "logo",
  "screenshot",
  "titlescreen",
];
const SKIP_DIRS = new Set([
  "media",
  "assets",
  "images",
  "videos",
  "bios",
  "saves",
  "savedata",
  "screenshots",
  "manuals",
  "music",
  "cheats",
  "system",
  "cores",
]);

function isMetadataName(name: string): boolean {
  const l = name.toLowerCase();
  return (
    l === "metadata.pegasus.txt" ||
    l === "metadata.txt" ||
    l.endsWith(".metadata.pegasus.txt") ||
    l.endsWith(".metadata.txt")
  );
}

function normalizeRel(baseDir: string, file: string): string {
  const f = file.replace(/\\/g, "/").trim();
  if (f === "") return f;
  if (isAbsolute(f)) return f;
  return joinPath(baseDir, f);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 递归查找元数据文件（限制深度，跳过素材目录）。 */
async function findMetadataFiles(
  provider: StorageProvider,
  dir: string,
  depth: number,
  out: string[],
): Promise<void> {
  let entries;
  try {
    entries = await provider.list(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDir) {
      if (depth <= 0) continue;
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
      await findMetadataFiles(provider, e.path, depth - 1, out);
    } else if (isMetadataName(e.name)) {
      out.push(e.path);
    }
  }
}

/** 递归列出指定扩展名的文件。 */
async function listFilesRecursive(
  provider: StorageProvider,
  dir: string,
  depth: number,
  exts: Set<string>,
  out: string[],
): Promise<void> {
  let entries;
  try {
    entries = await provider.list(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDir) {
      if (depth <= 0) continue;
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
      await listFilesRecursive(provider, e.path, depth - 1, exts, out);
    } else if (exts.has(extname(e.name))) {
      out.push(e.path);
    }
  }
}

function pickCover(names: string[]): string | undefined {
  const imgs = names.filter((n) => IMAGE_EXTS.includes(extname(n)));
  if (imgs.length === 0) return undefined;
  const score = (n: string): number => {
    const l = n.toLowerCase();
    for (let i = 0; i < COVER_PRIORITY.length; i++) {
      if (l.includes(COVER_PRIORITY[i])) return i;
    }
    return COVER_PRIORITY.length;
  };
  const sorted = [...imgs].sort((a, b) => score(a) - score(b));
  return sorted[0];
}

const ASSET_KEYS = [
  "box_front",
  "boxfront",
  "box2dfront",
  "box_front_2d",
  "cover",
  "tile",
  "banner",
  "screenshot",
  "titlescreen",
  "logo",
];

async function resolveCoverPath(
  provider: StorageProvider,
  game: Game,
  mediaIndexCache: Map<string, Map<string, string>>,
): Promise<string | undefined> {
  const baseDir = game._baseDir ?? "";
  const assets = game._assets ?? {};

  for (const key of ASSET_KEYS) {
    if (assets[key]) return normalizeRel(baseDir, assets[key]);
  }

  const mediaDir = joinPath(baseDir, "media");
  let index = mediaIndexCache.get(mediaDir);
  if (!index) {
    index = new Map();
    try {
      for (const e of await provider.list(mediaDir)) {
        if (e.isDir) index.set(e.name.toLowerCase(), e.name);
      }
    } catch {
      // 没有 media 目录
    }
    mediaIndexCache.set(mediaDir, index);
  }

  const candidates = [game.title.toLowerCase()];
  if (game.files[0]) candidates.push(stripExt(basename(game.files[0])).toLowerCase());

  for (const key of candidates) {
    const sub = index.get(key);
    if (!sub) continue;
    try {
      const files = await provider.list(joinPath(mediaDir, sub));
      const pick = pickCover(files.filter((f) => !f.isDir).map((f) => f.name));
      if (pick) return joinPath(mediaDir, sub, pick);
    } catch {
      // 忽略
    }
  }

  return undefined;
}

function gameFromPegasus(
  col: PegasusCollection,
  g: PegasusCollection["games"][number],
  baseDir: string,
): Game {
  const files = g.files.map((f) => normalizeRel(baseDir, f));
  return {
    id: files[0] ?? `${col.name}:${g.title}`,
    title: g.title,
    collection: col.name,
    files,
    developer: g.developers.join(", ") || undefined,
    genre: g.genres.join(", ") || undefined,
    players: g.players,
    release: g.release,
    rating: g.rating,
    description: g.summary ?? g.description,
    launch: g.launch ?? col.launch,
    workdir: g.workdir ?? col.workdir,
    _baseDir: baseDir,
    _assets: g.assets,
  };
}

/** 扫描存储源，构建游戏库。`root` 为相对根的起始路径。 */
export async function scanLibrary(
  provider: StorageProvider,
  root = "",
): Promise<ScanResult> {
  const warnings: string[] = [];
  const games: Game[] = [];

  const metaFiles: string[] = [];
  await findMetadataFiles(provider, root, 3, metaFiles);

  const seenFiles = new Set<string>();

  for (const metaPath of metaFiles) {
    let text: string;
    try {
      text = await provider.readText(metaPath);
    } catch (e) {
      warnings.push(`读取失败：${metaPath}（${String(e)}）`);
      continue;
    }

    let collections: PegasusCollection[];
    try {
      collections = parsePegasus(text);
    } catch (e) {
      warnings.push(`解析失败：${metaPath}（${String(e)}）`);
      continue;
    }

    const baseDir = dirname(metaPath);

    for (const col of collections) {
      // 1) 显式声明的游戏
      for (const g of col.games) {
        const game = gameFromPegasus(col, g, baseDir);
        game.files.forEach((f) => seenFiles.add(f.toLowerCase()));
        if (game.title) games.push(game);
      }

      // 2) 按扩展名发现的游戏
      if (col.extensions.length > 0) {
        const exts = new Set(col.extensions.map((e) => e.toLowerCase()));
        const found: string[] = [];
        await listFilesRecursive(provider, baseDir, 3, exts, found);
        for (const f of found) {
          if (seenFiles.has(f.toLowerCase())) continue;
          seenFiles.add(f.toLowerCase());
          games.push({
            id: f,
            title: stripExt(basename(f)),
            collection: col.name,
            files: [f],
            launch: col.launch,
            workdir: col.workdir,
            _baseDir: baseDir,
          });
        }
      }
    }
  }

  // 去重：同一文件可能被显式声明与扩展名发现重复收录
  const unique = new Map<string, Game>();
  for (const g of games) {
    const key = g.id.toLowerCase();
    if (!unique.has(key)) unique.set(key, g);
  }
  const deduped = Array.from(unique.values());

  // 解析封面
  const mediaIndexCache = new Map<string, Map<string, string>>();
  await mapLimit(deduped, 4, async (g) => {
    g.coverPath = await resolveCoverPath(provider, g, mediaIndexCache);
  });

  const collections = Array.from(new Set(deduped.map((g) => g.collection))).sort();

  return { collections, games: deduped, warnings };
}
