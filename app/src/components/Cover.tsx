// 封面组件：下载一次到本地（与资源结构一致），之后直接用本地文件。
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { StorageProvider } from "../storage/types";
import { joinPath } from "../shared/path";
import { pickCoverName } from "../shared/media";
import { ensureLocalMedia } from "../domain/ensure";
import { getCachedMediaPath, listMediaNames, rememberMediaPath } from "../domain/media-cache";

interface Props {
  provider: StorageProvider;
  path?: string;
  dir?: string;
  title: string;
}

export function Cover({ provider, path, dir, title }: Props) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setFailed(false);

    const key = path
      ? `p:${provider.key}:${path}`
      : dir
        ? `d:${provider.key}:${dir}`
        : null;
    if (!key) return;

    const cached = getCachedMediaPath(key);
    if (cached) {
      setSrc(convertFileSrc(cached));
      return;
    }

    (async () => {
      let target = path;
      try {
        if (!target && dir) {
          const names = await listMediaNames(provider, dir);
          const pick = pickCoverName(names);
          if (pick) target = joinPath(dir, pick);
        }
        if (!target) {
          if (alive) setFailed(true);
          return;
        }
        const local = await ensureLocalMedia(provider, target);
        rememberMediaPath(key, local);
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

  if (src && !failed) {
    return (
      <img
        className="cover"
        src={src}
        alt={title}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="cover placeholder" title={failed ? "封面加载失败" : undefined}>
      <span>{title.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}
