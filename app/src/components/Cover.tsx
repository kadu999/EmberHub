// 封面组件：按需从存储源加载图片（data URL），带小型缓存。
import { useEffect, useState } from "react";
import type { StorageProvider } from "../storage/types";

interface Props {
  provider: StorageProvider;
  path?: string;
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

export function Cover({ provider, path, title }: Props) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setFailed(false);
    if (!path) return;

    const key = `${provider.kind}:${path}`;
    const cached = cache.get(key);
    if (cached) {
      setSrc(cached);
      return;
    }

    provider
      .readFileDataUrl(path)
      .then((d) => {
        cacheSet(key, d);
        if (alive) setSrc(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [provider, path]);

  if (src) {
    return <img className="cover" src={src} alt={title} loading="lazy" />;
  }
  return (
    <div className="cover placeholder" title={failed ? "封面加载失败" : undefined}>
      <span>{title.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}
