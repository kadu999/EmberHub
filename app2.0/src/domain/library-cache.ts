// 游戏库/配置缓存（按资源源隔离）：
//   - manifest.json：默认读本地缓存；游戏库连接时用 refreshManifest() 强制联网刷新（检查 version）；
//   - games.json：manifest 的 version 变化（或本地没缓存）时才重新拉；网络失败回退旧缓存；
//   - 模拟器配置（emulators.json / platforms.json / config.json）：默认读本地缓存（打开模拟器页不联网）；
//     需要联网时调用 clearConfigCache() + refreshManifest()（模拟器页的「从服务器刷新」）。
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
  /** 服务器约定的 games 文件名（manifest.files.games 可覆盖） */
  private gamesFile = "games.json";
  /** 需要本地缓存的配置类文件名（模拟器相关） */
  private configFiles = new Set<string>(["emulators.json", "platforms.json", "config.json"]);
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
    if (this.configFiles.has(name)) return this.readConfig(path);
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
  private configCache(path: string) {
    return joinPath(this.cacheRoot, "configs", path);
  }

  /** 解析 manifest 元信息（version + 文件名约定），返回 version。 */
  private applyManifestMeta(raw: string): string {
    let version = hash(raw);
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      if (typeof o.version === "string" && o.version !== "") version = o.version;
      else if (typeof o.version === "number") version = String(o.version);
      const files = o.files as Record<string, unknown> | undefined;
      if (files) {
        if (typeof files.games === "string" && files.games) this.gamesFile = files.games;
        for (const k of ["emulators", "platformMap", "emulatorConfig"] as const) {
          const v = files[k];
          if (typeof v === "string" && v) this.configFiles.add(v);
        }
      }
    } catch {
      /* 非法 JSON：用内容哈希 */
    }
    return version;
  }

  /** 强制联网刷新 manifest（游戏库连接 / 模拟器页「从服务器刷新」时用）。 */
  async refreshManifest(): Promise<void> {
    const raw = await this.base.readText("manifest.json");
    this.storedVersion = (await readIfExists(this.versionCache())) ?? null;
    this.currentVersion = this.applyManifestMeta(raw);
    await native.fs.writeTextFile(this.manifestCache(), raw);
    await native.fs.writeTextFile(this.versionCache(), this.currentVersion);
  }

  /** 默认读本地缓存的 manifest；没有缓存才联网。 */
  private async readManifest(path: string): Promise<string> {
    const cached = await readIfExists(this.manifestCache());
    if (cached === undefined) {
      await this.refreshManifest();
      const raw = await readIfExists(this.manifestCache());
      if (raw === undefined) throw new Error(`无法读取 ${path}`);
      return raw;
    }
    if (this.currentVersion === null) {
      // 未刷新过：以本地记录的版本为准（games 走缓存）
      this.storedVersion = (await readIfExists(this.versionCache())) ?? null;
      this.currentVersion = this.applyManifestMeta(cached);
    } else {
      this.applyManifestMeta(cached);
    }
    return cached;
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

  /** 配置类文件：默认读本地缓存，没有才联网。 */
  private async readConfig(path: string): Promise<string> {
    const cacheFile = this.configCache(path);
    const cached = await readIfExists(cacheFile);
    if (cached !== undefined) return cached;
    const raw = await this.base.readText(path);
    await native.fs.writeTextFile(cacheFile, raw);
    return raw;
  }

  async clearConfigCache(): Promise<void> {
    await native.fs.removePath(joinPath(this.cacheRoot, "configs"));
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
