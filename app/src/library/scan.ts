// 游戏库扫描：读取自定义 JSON 资源（manifest.json + Roms/<平台>/games.json）。
// 详见 docs/REQUIREMENTS.md 第 3 节。
import type { StorageProvider } from "../storage/types";
import { basename, extname, isAbsolute, joinPath, stripExt } from "../lib/path";
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
  /** 封面在存储源中的相对路径 */
  coverPath?: string;
  /** 视频在存储源中的相对路径 */
  videoPath?: string;
  /** 内部：Roms/<平台> 目录 */
  _baseDir?: string;
}

export interface ScanResult {
  collections: string[];
  games: Game[];
  warnings: string[];
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "webm", "avi", "mkv"];
const COVER_PRIORITY = [
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
];

function normalizeRel(baseDir: string, file: string): string {
  const f = file.replace(/\\/g, "/").trim();
  if (f === "") return f;
  if (isAbsolute(f)) return f;
  return joinPath(baseDir, f);
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
  return [...imgs].sort((a, b) => score(a) - score(b))[0];
}

function pickVideo(names: string[]): string | undefined {
  const vids = names.filter((n) => VIDEO_EXTS.includes(extname(n)));
  if (vids.length === 0) return undefined;
  return vids.find((n) => n.toLowerCase().includes("video")) ?? vids[0];
}

async function resolveMedia(
  provider: StorageProvider,
  game: Game,
  mediaIndexCache: Map<string, Map<string, string>>,
): Promise<void> {
  const baseDir = game._baseDir ?? "";
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
      const names = (await provider.list(joinPath(mediaDir, sub)))
        .filter((f) => !f.isDir)
        .map((f) => f.name);
      if (!game.coverPath) {
        const cover = pickCover(names);
        if (cover) game.coverPath = joinPath(mediaDir, sub, cover);
      }
      if (!game.videoPath) {
        const video = pickVideo(names);
        if (video) game.videoPath = joinPath(mediaDir, sub, video);
      }
      if (game.coverPath && game.videoPath) return;
    } catch {
      // 忽略
    }
  }
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

    for (const gm of pg.games) {
      const file = normalizeRel(baseDir, gm.file);
      games.push({
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
      });
    }
  }

  // 解析封面与视频（显式优先，其次 media 约定）
  const mediaIndexCache = new Map<string, Map<string, string>>();
  for (const g of games) {
    await resolveMedia(provider, g, mediaIndexCache);
  }

  const collections = Array.from(new Set(games.map((g) => g.collection))).sort();
  return { collections, games, warnings };
}
