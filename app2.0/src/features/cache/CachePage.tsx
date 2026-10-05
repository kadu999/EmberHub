// 资源缓存：独立弹框，用于查看/清理本地缓存（测试用）。
import { useEffect, useState } from "react";
import { native } from "../../shared/native";
import { joinPath } from "../../shared/path";
import type { SourceConfig } from "../../storage/types";

/** 可清理的缓存/数据项（相对下载目录）。 */
const CACHE_ITEMS = [
  { key: "library", label: "游戏库缓存", desc: "manifest + 各平台 games.json", dir: ".cache/library", isCache: true },
  { key: "media", label: "媒体缓存", desc: "封面 / 视频预览", dir: ".cache/media", isCache: true },
  { key: "emuCache", label: "模拟器压缩包缓存", desc: "下载的模拟器 zip", dir: ".cache/Emulators", isCache: true },
  { key: "roms", label: "已下载游戏", desc: "Roms/", dir: "Roms", isCache: false },
  { key: "emulators", label: "已安装模拟器", desc: "Emulators/", dir: "Emulators", isCache: false },
] as const;

function formatSize(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

interface Props {
  source: SourceConfig;
  onClose: () => void;
}

export function CachePage({ source, onClose }: Props) {
  const [defaultDir, setDefaultDir] = useState("");
  useEffect(() => {
    native.fs.defaultDownloadDir().then(setDefaultDir).catch(() => undefined);
  }, []);

  const [downloadDir, setDownloadDir] = useState(source.downloadDir ?? "");
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [clearingKey, setClearingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const baseDir = (downloadDir.trim() || defaultDir).replace(/\\/g, "/");

  async function refreshSizes() {
    if (!baseDir) return;
    const next: Record<string, number | null> = {};
    for (const it of CACHE_ITEMS) {
      try {
        next[it.key] = await native.fs.pathSize(joinPath(baseDir, it.dir));
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

  async function clearDir(it: (typeof CACHE_ITEMS)[number]) {
    setClearingKey(it.key);
    try {
      await native.fs.removePath(joinPath(baseDir, it.dir));
      await refreshSizes();
      setMessage({ ok: true, text: `已清理：${it.label}` });
    } catch (e) {
      setMessage({ ok: false, text: `清理失败：${String(e)}` });
    } finally {
      setClearingKey(null);
    }
  }

  async function clearAllCaches() {
    setClearingKey("__all__");
    try {
      for (const it of CACHE_ITEMS.filter((x) => x.isCache)) {
        await native.fs.removePath(joinPath(baseDir, it.dir));
      }
      await refreshSizes();
      setMessage({ ok: true, text: "已清理全部缓存" });
    } catch (e) {
      setMessage({ ok: false, text: `清理失败：${String(e)}` });
    } finally {
      setClearingKey(null);
    }
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>资源缓存</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost small" onClick={() => void refreshSizes()}>
            刷新占用
          </button>
          <button className="ghost small" onClick={onClose}>
            关闭（Esc）
          </button>
        </div>
      </div>
      <p className="hint">
        查看与清理本地缓存（便于测试）。基准目录：<code>{baseDir || "—"}</code>
      </p>

      <div className="field">
        <label>下载目录（可临时改成别的目录查看）</label>
        <input
          value={downloadDir}
          onChange={(e) => setDownloadDir(e.currentTarget.value)}
          placeholder={defaultDir || "默认"}
        />
      </div>
      <div className="actions">
        <button className="ghost small" onClick={() => setDownloadDir("")}>
          重置为默认
        </button>
      </div>

      <ul className="cache-list">
        {CACHE_ITEMS.map((it) => (
          <li key={it.key}>
            <div className="cache-info">
              <span className="cache-name">{it.label}</span>
              <span className="cache-meta">
                {it.desc} · <code>{it.dir}</code> · {formatSize(sizes[it.key])}
              </span>
            </div>
            <button
              className="ghost small"
              disabled={clearingKey !== null}
              onClick={() => void clearDir(it)}
            >
              {clearingKey === it.key ? "清理中…" : "清理"}
            </button>
          </li>
        ))}
      </ul>

      <div className="actions">
        <button className="ghost small" disabled={clearingKey !== null} onClick={() => void clearAllCaches()}>
          {clearingKey === "__all__" ? "清理中…" : "清理全部缓存"}
        </button>
      </div>
      <p className="hint">
        「清理全部缓存」只清 <code>.cache/</code>（游戏库/媒体/模拟器包），不动已下载的 Roms 与已安装模拟器。
      </p>

      {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
    </div>
  );
}
