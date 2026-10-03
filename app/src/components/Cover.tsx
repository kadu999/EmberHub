// 封面组件：按需从存储源加载图片（data URL）。
import { useEffect, useState } from "react";
import type { StorageProvider } from "../storage/types";

interface Props {
  provider: StorageProvider;
  path?: string;
  title: string;
}

export function Cover({ provider, path, title }: Props) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setFailed(false);
    if (!path) return;
    provider
      .readFileDataUrl(path)
      .then((d) => {
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
