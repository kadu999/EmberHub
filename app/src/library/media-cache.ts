// 媒体系列缓存：
//   - 媒体目录文件列表缓存（封面（Cover）与视频预览共用一份，避免每个游戏都重复发一次 PROPFIND）
//   - 已解析的本地媒体路径缓存（封面 key → 本地绝对路径）
// 两类缓存都由 clearMediaCache() 统一失效（切换资源源 / 重新扫描时调用）。
import type { StorageProvider } from "../storage/types";

const dirCache = new Map<string, Promise<string[]>>();
const pathCache = new Map<string, string>();
const MAX_PATH_CACHE = 300;

function cacheKey(provider: StorageProvider, dir: string): string {
  // 用 provider.key（kind + 根地址）区分不同资源源，切换源时会 clearMediaCache()。
  return `${provider.key}|${dir}`;
}

/** 列出媒体目录内的文件名（缓存 + 在途去重）。失败不缓存，下次可重试。 */
export function listMediaNames(provider: StorageProvider, dir: string): Promise<string[]> {
  const key = cacheKey(provider, dir);
  const hit = dirCache.get(key);
  if (hit) return hit;

  const task = provider
    .list(dir)
    .then((entries) => entries.filter((e) => !e.isDir).map((e) => e.name))
    .catch(() => {
      dirCache.delete(key);
      return [] as string[];
    });
  dirCache.set(key, task);
  return task;
}

/** 读取已解析的本地媒体路径（未命中返回 undefined）。 */
export function getCachedMediaPath(key: string): string | undefined {
  return pathCache.get(key);
}

/** 记住已解析的本地媒体路径（LRU 上限）。 */
export function rememberMediaPath(key: string, value: string): void {
  pathCache.set(key, value);
  if (pathCache.size > MAX_PATH_CACHE) {
    const oldest = pathCache.keys().next().value;
    if (oldest !== undefined) pathCache.delete(oldest);
  }
}

/** 清空缓存（切换资源源 / 重新扫描时调用）。 */
export function clearMediaCache(): void {
  dirCache.clear();
  pathCache.clear();
}
