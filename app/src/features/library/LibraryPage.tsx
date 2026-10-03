// 游戏库页（默认首页）：左侧信息面板 + 右侧游戏网格。
// 进入即自动扫描；无头部、无描述文字。
import { useEffect, useMemo, useState } from "react";
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
import { joinPath } from "../../lib/path";
import { pickVideoName } from "../../lib/media";

interface Props {
  onOpenSettings: () => void;
}

export function LibraryPage({ onOpenSettings }: Props) {
  const { sources, activeSourceId, scanToken } = useStore();
  const source = sources.find((s) => s.id === activeSourceId) ?? null;
  const provider = useMemo(() => (source ? createProvider(source) : null), [source]);

  const [result, setResult] = useState<ScanResult | null>(null);
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

  const scanRoot = (source?.romsPath ?? "Roms").trim();

  async function scan() {
    if (!provider) return;
    setError(null);
    setResult(null);
    setSelected(null);
    setCollection("");
    try {
      const r = await scanLibrary(provider, scanRoot);
      setResult(r);
      setSelected(r.games[0] ?? null);
      setCollection(r.collections[0] ?? "");
    } catch (e) {
      setError(String(e));
    }
  }

  // 进入即扫描；scanToken 变化时重扫
  useEffect(() => {
    if (provider && source) void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, source, scanToken]);

  // 下载进度
  useEffect(() => {
    const un = listen<{ path: string; downloaded: number; total: number | null }>(
      "download-progress",
      (e) => setProgress(e.payload),
    );
    return () => {
      un.then((f) => f()).catch(() => undefined);
    };
  }, []);

  // 选中游戏的视频预览（懒加载：列出 media 目录 → 挑视频 → 按需下载）
  useEffect(() => {
    let alive = true;
    setVideoSrc(null);
    if (!selected || !provider || !source) return;
    (async () => {
      try {
        let videoRel: string | undefined;
        if (selected.mediaDir) {
          const names = (await provider.list(selected.mediaDir))
            .filter((e) => !e.isDir)
            .map((e) => e.name);
          const pick = pickVideoName(names);
          if (pick) videoRel = joinPath(selected.mediaDir!, pick);
        }
        if (!videoRel) return;
        const p = await ensureLocalMedia(provider, source, videoRel);
        if (alive) setVideoSrc(convertFileSrc(p));
      } catch {
        // 忽略
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected, provider, source]);

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

  const games = result?.games ?? [];
  const filtered = games.filter((g) => g.collection === collection);

  return (
    <div className="page">
      {error && <p className="error">{error}</p>}

      <div
        className="library-layout"
        style={{
          display: "grid",
          gridTemplateColumns: "clamp(240px, 24vw, 340px) minmax(0, 1fr)",
          gridTemplateRows: "1fr",
          gap: 24,
          alignItems: "stretch",
        }}
      >
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
