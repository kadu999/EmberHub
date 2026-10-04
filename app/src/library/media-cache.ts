// 媒体目录文件列表缓存。
// 封面（Cover）与视频预览共用同一份目录列表，避免每个游戏都重复发一次 PROPFIND。
import type { StorageProvider } from "../storage/types";

const dirCache = new Map<string, Promise<string[]>>();

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

/** 清空缓存（切换资源源 / 重新扫描时调用）。 */
export function clearMediaCache(): void {
  dirCache.clear();
}
