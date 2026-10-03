// 封面组件：按需从存储源加载图片（data URL），带小型缓存。
// 支持两种来源：显式 path，或 dir（media 子目录，懒加载挑封面）。
import { useEffect, useState } from "react";
import type { StorageProvider } from "../storage/types";
import { joinPath } from "../lib/path";
import { pickCoverName } from "../lib/media";

interface Props {
  provider: StorageProvider;
  path?: string;
  dir?: string;
  title: string;
}

// 小型缓存：避免虚拟滚动来回时重复下载封面
const cache = new Map<string, string>();
const MAX_CACHE = 120;

function cacheSet(key: string, value: string) {
  cache.set(key, value);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function Cover({ provider, path, dir, title }: Props) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setFailed(false);

    const key = path
      ? `p:${provider.kind}:${path}`
      : dir
        ? `d:${provider.kind}:${dir}`
        : null;
    if (!key) return;

    const cached = cache.get(key);
    if (cached) {
      setSrc(cached);
      return;
    }

    (async () => {
      let target = path;
      if (!target && dir) {
        try {
          const names = (await provider.list(dir))
            .filter((e) => !e.isDir)
            .map((e) => e.name);
          const pick = pickCoverName(names);
          if (pick) target = joinPath(dir, pick);
        } catch {
          // 忽略
        }
      }
      if (!target) {
        if (alive) setFailed(true);
        return;
      }
      try {
        const d = await provider.readFileDataUrl(target);
        cacheSet(key, d);
        if (alive) setSrc(d);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [provider, path, dir]);

  if (src) {
    return <img className="cover" src={src} alt={title} loading="lazy" />;
  }
  return (
    <div className="cover placeholder" title={failed ? "封面加载失败" : undefined}>
      <span>{title.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}
