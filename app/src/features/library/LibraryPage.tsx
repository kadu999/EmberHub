// 游戏库页（默认首页）：左侧信息面板 + 右侧游戏网格。
// 进入即自动扫描；重扫时保留旧数据，避免闪烁成空白。
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../../store";
import { createProvider } from "../../storage";
import { scanLibrary, type Game, type ScanResult } from "../../library/scan";
import { Cover } from "../../components/Cover";
import { VirtualGrid } from "../../components/VirtualGrid";
import { launchGame } from "../../library/launch";
import { ensureLocalMedia } from "../../library/ensure";
import { listMediaNames } from "../../library/media-cache";
import { joinPath } from "../../lib/path";
import { pickVideoName } from "../../lib/media";

interface Props {
  onOpenSettings: () => void;
}

/** 选中游戏切换后，延迟一点再加载视频，避免快速浏览时触发一堆下载。 */
const VIDEO_DEBOUNCE_MS = 350;

export function LibraryPage({ onOpenSettings }: Props) {
  const { source, scanToken } = useStore();
  const provider = useMemo(() => (source ? createProvider(source) : null), [source]);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState("");
  const [selected, setSelected] = useState<Game | null>(null);
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<{
    path: string;
    downloaded: number;
    total: number | null;
  } | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  // 首次进入只加载封面；用户点击某个游戏后才加载视频预览，避免一进来就抢占带宽
  const [videoArmed, setVideoArmed] = useState(false);

  const scanRoot = (source?.romsPath ?? "Roms").trim();

  const scan = useCallback(async () => {
    if (!provider) return;
    setError(null);
    setScanning(true);
    try {
      const r = await scanLibrary(provider, scanRoot);
      setResult(r);
      setCollection((prev) => (r.collections.includes(prev) ? prev : (r.collections[0] ?? "")));
      setSelected((prev) =>
        prev && r.games.some((g) => g.id === prev.id) ? prev : (r.games[0] ?? null),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }, [provider, scanRoot]);

  // 进入即扫描；scanToken 变化时重扫
  useEffect(() => {
    if (provider && source) void scan();
  }, [provider, source, scan, scanToken]);

  // 下载进度（ROM / 模拟器）；媒体预览静默下载，不显示进度条
  useEffect(() => {
    const un = listen<{ path: string; downloaded: number; total: number | null }>(
      "download-progress",
      (e) => {
        const p = e.payload.path.replace(/\\/g, "/");
        // 封面/视频预览（在 media/ 下）静默下载，不显示进度条
        if (p.includes("/media/")) return;
        setProgress(e.payload);
      },
    );
    return () => {
      un.then((f) => f()).catch(() => undefined);
    };
  }, []);

  // 选中游戏的视频预览（懒加载：列出 media 目录 → 挑视频 → 按需下载）
  useEffect(() => {
    let alive = true;
    setVideoSrc(null);
    if (!selected || !provider || !source || !selected.mediaDir || !videoArmed) return;

    const dir = selected.mediaDir;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const names = await listMediaNames(provider, dir);
          const pick = pickVideoName(names);
          if (!pick) return;
          const p = await ensureLocalMedia(provider, joinPath(dir, pick));
          if (alive) setVideoSrc(convertFileSrc(p));
        } catch (e) {
          console.warn("[EmberHub] 视频加载失败:", e);
        }
      })();
    }, VIDEO_DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selected, provider, source, videoArmed]);

  const games = result?.games;
  const filtered = useMemo(
    () => (games ?? []).filter((g) => g.collection === collection),
    [games, collection],
  );

  // 未配置存储源
  if (!source || !provider) {
    return (
      <div className="page centered">
        <div className="brand big">
          <span className="flame">🔥</span>
          <span className="brand-name">
            Ember<b>Hub</b>
          </span>
        </div>
        <button onClick={onOpenSettings}>打开设置</button>
      </div>
    );
  }

  // 首次加载（还没有数据，也没报错）
  if (!result && !error) {
    return (
      <div className="page centered">
        <div className="loading">
          <span className="spinner" />
          正在加载游戏库…
        </div>
      </div>
    );
  }

  async function launch(g: Game) {
    setSelected(g);
    setLaunchMsg(null);
    setProgress(null);
    try {
      await launchGame(g, provider!, source!, (s) => setLaunchMsg({ ok: true, text: s }));
      await getCurrentWindow().close();
    } catch (e) {
      setLaunchMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="page">
      {error && <p className="error">{error}</p>}

      <div className="library-layout">
        {/* 左侧：信息面板 */}
        <aside className="detail-panel">
          {selected && (
            <>
              {videoSrc ? (
                <video className="preview-video" src={videoSrc} autoPlay muted loop playsInline />
              ) : (
                <Cover provider={provider} path={selected.coverPath} dir={selected.mediaDir} title={selected.title} />
              )}
              <h3 className="detail-title">{selected.title}</h3>
              <p className="detail-sub">{selected.collection}</p>

              <dl>
                {selected.developer && (
                  <>
                    <dt>开发商</dt>
                    <dd>{selected.developer}</dd>
                  </>
                )}
                {selected.genre && (
                  <>
                    <dt>类型</dt>
                    <dd>{selected.genre}</dd>
                  </>
                )}
                {selected.players && (
                  <>
                    <dt>玩家人数</dt>
                    <dd>{selected.players}</dd>
                  </>
                )}
                {selected.release && (
                  <>
                    <dt>发行日期</dt>
                    <dd>{selected.release}</dd>
                  </>
                )}
                {selected.rating !== undefined && (
                  <>
                    <dt>评分</dt>
                    <dd>{Math.round(selected.rating * 100)}%</dd>
                  </>
                )}
              </dl>

              {launchMsg && <p className={launchMsg.ok ? "ok" : "error"}>{launchMsg.text}</p>}
              {selected.description && <p className="desc">{selected.description}</p>}
            </>
          )}
        </aside>

        {/* 右侧：游戏选择 */}
        <main className="library-main">
          <div className="filters">
            {result?.collections.map((c) => (
              <button
                key={c}
                className={collection === c ? "chip active" : "chip"}
                onClick={() => setCollection(c)}
              >
                {c}
              </button>
            ))}
            {scanning && <span className="refresh-badge">刷新中…</span>}
          </div>

          {result && result.warnings.length > 0 && (
            <details className="warnings">
              <summary>{result.warnings.length} 条警告</summary>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          <VirtualGrid
            items={filtered}
            minColWidth={150}
            aspect={4 / 3}
            extraHeight={46}
            gap={18}
            renderItem={(g) => (
              <button
                className={g.id === selected?.id ? "game-card active" : "game-card"}
                onClick={() => {
                  setLaunchMsg(null);
                  setSelected(g);
                  setVideoArmed(true);
                }}
                onDoubleClick={() => launch(g)}
              >
                <Cover provider={provider} path={g.coverPath} dir={g.mediaDir} title={g.title} />
                <span className="game-title" title={g.title}>
                  {g.title}
                </span>
              </button>
            )}
          />
        </main>
      </div>

      {progress && (
        <div className="dl-bar">
          <span className="dl-name">{progress.path.replace(/\\/g, "/").split("/").pop()}</span>
          <div className="dl-track">
            <div
              className="dl-fill"
              style={{
                width: progress.total
                  ? `${Math.min(100, (progress.downloaded / progress.total) * 100)}%`
                  : "100%",
              }}
            />
          </div>
          <span className="dl-text">
            {progress.total
              ? `${(progress.downloaded / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB`
              : `${(progress.downloaded / 1048576).toFixed(1)} MB`}
          </span>
        </div>
      )}
    </div>
  );
}
