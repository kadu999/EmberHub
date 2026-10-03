// 封面组件：下载一次到本地（与资源结构一致），之后直接用本地文件。
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { StorageProvider } from "../storage/types";
import { joinPath } from "../lib/path";
import { pickCoverName } from "../lib/media";
import { ensureLocalMedia } from "../library/ensure";

interface Props {
  provider: StorageProvider;
  path?: string;
  dir?: string;
  title: string;
}

// 已解析的本地路径缓存（避免重复存在性检查）
const pathCache = new Map<string, string>();
const MAX_CACHE = 300;

function remember(key: string, value: string) {
  pathCache.set(key, value);
  if (pathCache.size > MAX_CACHE) {
    const oldest = pathCache.keys().next().value;
    if (oldest !== undefined) pathCache.delete(oldest);
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

    const cached = pathCache.get(key);
    if (cached) {
      setSrc(convertFileSrc(cached));
      return;
    }

    (async () => {
      let target = path;
      try {
        if (!target && dir) {
          const names = (await provider.list(dir))
            .filter((e) => !e.isDir)
            .map((e) => e.name);
          const pick = pickCoverName(names);
          if (pick) target = joinPath(dir, pick);
        }
        if (!target) {
          if (alive) setFailed(true);
          return;
        }
        const local = await ensureLocalMedia(provider, target);
        remember(key, local);
        if (alive) setSrc(convertFileSrc(local));
      } catch (e) {
        console.warn("[EmberHub] 封面加载失败:", target ?? dir, e);
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
