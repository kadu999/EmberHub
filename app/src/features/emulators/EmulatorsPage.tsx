// 模拟器管理：列出该运行平台下的模拟器，支持下载 / 更新 / 删除 / 直接打开。
// 打开模拟器 = 启动它自己的界面（用于配置），不启动游戏。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../../store";
import { createProvider } from "../../storage";
import {
  ensureEmulator,
  listEmulators,
  openEmulator,
  removeEmulator,
  type EmulatorInfo,
} from "../../library/ensure";

interface Props {
  onClose?: () => void;
}

export function EmulatorsPage({ onClose }: Props) {
  const source = useStore((s) => s.source);
  const provider = useMemo(() => (source ? createProvider(source) : null), [source]);

  const [list, setList] = useState<EmulatorInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!provider || !source) return;
    setLoading(true);
    setError(null);
    try {
      setList(await listEmulators(provider, source));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [provider, source]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(platform: string, fn: () => Promise<unknown>) {
    setBusy(platform);
    setStatus("");
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>模拟器</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost small" onClick={() => void refresh()} disabled={loading || busy !== null}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          {onClose && (
            <button className="ghost small" onClick={onClose}>
              关闭（Esc）
            </button>
          )}
        </div>
      </div>
      <p className="hint">
        下载 / 更新 / 删除模拟器，或直接「打开模拟器」进入它自己的设置界面（不会启动游戏）。
      </p>

      {error && <p className="error">{error}</p>}
      {status && <p className="ok">{status}</p>}

      <ul className="emu-list">
        {list.length === 0 && !loading && <li className="empty">没有找到模拟器配置</li>}
        {list.map((e) => {
          const upToDate = e.installed && e.installedVersion === e.version;
          const label = !e.installed ? "下载" : upToDate ? "重装" : "更新";
          return (
            <li key={e.platform} className={e.installed ? "" : "not-installed"}>
              <div className="emu-info">
                <span className="emu-name">{e.platform}</span>
                <span className="emu-meta">
                  版本 {e.version}
                  {!e.installed && " · 未安装"}
                  {upToDate && " · 已安装"}
                  {e.installed && !upToDate && ` · 可更新（本地 ${e.installedVersion}）`}
                </span>
              </div>
              <div className="emu-actions">
                <button
                  className="ghost small"
                  disabled={busy !== null}
                  onClick={() =>
                    run(e.platform, () =>
                      ensureEmulator(provider!, source!, e.platform, setStatus, upToDate),
                    )
                  }
                >
                  {busy === e.platform ? "处理中…" : label}
                </button>
                <button
                  className="ghost small"
                  disabled={busy !== null || !e.installed}
                  onClick={() => run(e.platform, () => openEmulator(provider!, source!, e.platform, setStatus))}
                >
                  打开
                </button>
                <button
                  className="ghost small"
                  disabled={busy !== null || !e.installed}
                  onClick={() => run(e.platform, () => removeEmulator(provider!, source!, e.platform))}
                >
                  删除
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
