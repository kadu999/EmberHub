// 自定义 JSON 资源的解析与校验。
import type { EmulatorConfig, GameMeta, Manifest, PlatformGames, PlatformMap } from "./types";

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

export function parseManifest(text: string): Manifest {
  const o = asObject(text, "manifest.json");
  if (!Array.isArray(o.platforms) || o.platforms.some((p) => typeof p !== "string")) {
    throw new Error("manifest.json 的 platforms 应为字符串数组");
  }
  return { platforms: o.platforms as string[] };
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
      developer: str(gg.developer),
      publisher: str(gg.publisher),
      genre: str(gg.genre),
      players: typeof gg.players === "number" || typeof gg.players === "string" ? gg.players : undefined,
      release: str(gg.release),
      rating: typeof gg.rating === "number" ? gg.rating : undefined,
      description: str(gg.description),
      launch: str(gg.launch),
    };
  });

  return {
    platform: str(o.platform) ?? fallbackPlatform,
    name: str(o.name),
    launch: str(o.launch),
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

export function parseEmulatorConfig(text: string): EmulatorConfig {
  const o = asObject(text, "config.json");
  const version = str(o.version);
  const archive = str(o.archive);
  const exe = str(o.exe);
  if (!version) throw new Error("config.json 缺少 version");
  if (!archive) throw new Error("config.json 缺少 archive");
  if (!exe) throw new Error("config.json 缺少 exe");
  return {
    platform: str(o.platform) ?? "",
    version,
    archive,
    exe,
    args: Array.isArray(o.args) ? (o.args.filter((a) => typeof a === "string") as string[]) : undefined,
    workdir: str(o.workdir),
    extract: typeof o.extract === "boolean" ? o.extract : undefined,
  };
}
