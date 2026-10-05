// 游戏库缓存（按资源源隔离）：
//   - manifest.json 每次都联网取；
//   - manifest 里的 version 变化（或本地没缓存）时才重新拉各平台 games.json；
//   - 网络失败时回退本地旧缓存。
import { native } from "../shared/native";
import { basename, dirname, joinPath } from "../shared/path";
import type { RemoteEntry, SourceConfig, StorageKind, StorageProvider } from "../storage/types";
import { getDownloadDir } from "./ensure";

/** 资源源短标识（与 ensure.ts 的 sourceSlug 同算法，隔离不同源的缓存）。 */
function sourceSlug(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** 内容哈希（manifest 没写 version 时的兜底）。 */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    if (!(await native.fs.fileExists(path))) return undefined;
    return await native.fs.readTextFile(path);
  } catch {
    return undefined;
  }
}

class CachedProvider implements StorageProvider {
  readonly kind: StorageKind;
  readonly key: string;
  private base: StorageProvider;
  private cacheRoot: string;
  /** 服务器约定的 games 文件名（manifest.files.games 可覆盖，默认 games.json） */
  private gamesFile = "games.json";
  /** 本次 manifest 的版本 */
  private currentVersion: string | null = null;
  /** 本地缓存的版本 */
  private storedVersion: string | null = null;

  constructor(base: StorageProvider, cacheRoot: string) {
    this.base = base;
    this.kind = base.kind;
    this.key = base.key;
    this.cacheRoot = cacheRoot;
  }

  get downloadTo() {
    return this.base.downloadTo?.bind(this.base);
  }

  list(path: string): Promise<RemoteEntry[]> {
    return this.base.list(path);
  }

  readText(path: string): Promise<string> {
    const name = basename(path);
    if (name === "manifest.json") return this.readManifest(path);
    if (name === this.gamesFile) return this.readGames(path);
    return this.base.readText(path);
  }

  private manifestCache() {
    return joinPath(this.cacheRoot, "manifest.json");
  }
  private versionCache() {
    return joinPath(this.cacheRoot, "manifest.version");
  }
  private gamesCache(platform: string) {
    return joinPath(this.cacheRoot, "games", `${platform}.json`);
  }

  /** 每次都联网取 manifest；失败则回退本地缓存。 */
  private async readManifest(path: string): Promise<string> {
    this.storedVersion = (await readIfExists(this.versionCache())) ?? null;
    try {
      const raw = await this.base.readText(path);
      let version = hash(raw);
      try {
        const o = JSON.parse(raw) as Record<string, unknown>;
        if (typeof o.version === "string" && o.version !== "") version = o.version;
        const files = o.files as Record<string, unknown> | undefined;
        if (files && typeof files.games === "string" && files.games !== "") {
          this.gamesFile = files.games;
        }
      } catch {
        /* 非法 JSON：用内容哈希 */
      }
      this.currentVersion = version;
      await native.fs.writeTextFile(this.manifestCache(), raw);
      await native.fs.writeTextFile(this.versionCache(), version);
      return raw;
    } catch (e) {
      const cached = await readIfExists(this.manifestCache());
      if (cached !== undefined) {
        // 网络失败：用旧 manifest，版本沿用本地记录的版本 → games 走缓存
        this.currentVersion = this.storedVersion;
        return cached;
      }
      throw e;
    }
  }

  /** version 未变 → 用缓存；变了 → 联网取并更新；网络失败 → 回退缓存。 */
  private async readGames(path: string): Promise<string> {
    const platform = basename(dirname(path));
    const cacheFile = this.gamesCache(platform);
    const unchanged = this.currentVersion !== null && this.currentVersion === this.storedVersion;
    if (unchanged) {
      const cached = await readIfExists(cacheFile);
      if (cached !== undefined) return cached;
    }
    try {
      const raw = await this.base.readText(path);
      await native.fs.writeTextFile(cacheFile, raw);
      return raw;
    } catch (e) {
      const cached = await readIfExists(cacheFile);
      if (cached !== undefined) return cached;
      throw e;
    }
  }
}

/** 把存储源包一层缓存（需要下载目录来放缓存）。 */
export async function createCachedProvider(
  base: StorageProvider,
  source: SourceConfig,
): Promise<StorageProvider> {
  const dl = await getDownloadDir(source);
  const cacheRoot = joinPath(dl, ".cache", "library", sourceSlug(base.key));
  return new CachedProvider(base, cacheRoot);
}
