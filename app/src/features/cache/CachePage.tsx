// 资源缓存：查看/清理本地数据（只保留 3 项：游戏、模拟器、缓存）。
import { useEffect, useState } from "react";
import { useStore } from "../../state/store";
import { tauri } from "../../shared/tauri";
import { cacheRoot, emulatorsRoot, romsRoot } from "../../domain/paths";

/** 3 个可删除项（dir 由下载目录派生）。 */
const ITEMS = [
  { key: "roms", label: "已下载游戏", dir: romsRoot },
  { key: "emulators", label: "已安装模拟器", dir: emulatorsRoot },
  { key: "cache", label: "缓存", dir: cacheRoot },
] as const;

function formatSize(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

interface Props {
  onClose: () => void;
}

export function CachePage({ onClose }: Props) {
  const downloadDir = useStore((s) => s.downloadDir);
  const [defaultDir, setDefaultDir] = useState("");
  useEffect(() => {
    tauri.defaultDownloadDir().then(setDefaultDir).catch(() => undefined);
  }, []);

  const baseDir = (downloadDir?.trim() || defaultDir).replace(/\\/g, "/");
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [clearingKey, setClearingKey] = useState<string | null>(null);

  async function refreshSizes() {
    if (!baseDir) return;
    const next: Record<string, number | null> = {};
    for (const it of ITEMS) {
      try {
        next[it.key] = await tauri.pathSize(it.dir(baseDir));
      } catch {
        next[it.key] = null;
      }
    }
    setSizes(next);
  }

  useEffect(() => {
    void refreshSizes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDir]);

  async function remove(it: (typeof ITEMS)[number]) {
    setClearingKey(it.key);
    try {
      await tauri.removePath(it.dir(baseDir));
      await refreshSizes();
    } catch {
      /* 忽略 */
    } finally {
      setClearingKey(null);
    }
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>资源缓存</h2>
        <button className="ghost small" onClick={onClose}>
          关闭（Esc）
        </button>
      </div>

      <ul className="cache-list">
        {ITEMS.map((it) => (
          <li key={it.key}>
            <div className="cache-info">
              <span className="cache-name">{it.label}</span>
              <span className="cache-meta">{formatSize(sizes[it.key])}</span>
            </div>
            <button
              className="ghost small"
              disabled={clearingKey !== null}
              onClick={() => void remove(it)}
            >
              {clearingKey === it.key ? "删除中…" : "删除"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
