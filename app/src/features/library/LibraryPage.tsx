// 游戏库页（默认首页）：左侧信息面板 + 右侧游戏网格。
// 进入即自动扫描；重扫时保留旧数据，避免闪烁成空白。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../../store";
import { APP_CONFIG } from "../../config";
import { createProvider } from "../../storage";
import { scanLibrary, type Game, type ScanResult } from "../../library/scan";
import { Cover } from "../../components/Cover";
import { VirtualGrid, type VirtualGridHandle } from "../../components/VirtualGrid";
import { launchGame } from "../../library/launch";
import { ensureLocalMedia } from "../../library/ensure";
import { listDownloadedGames } from "../../library/local";
import { listMediaNames } from "../../library/media-cache";
import { joinPath } from "../../lib/path";
import { pickVideoName } from "../../lib/media";
import { useGamepad } from "../../lib/useGamepad";

interface Props {
  onOpenSettings: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  emulatorsOpen: boolean;
  onCloseEmulators: () => void;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
}

/** 选中游戏切换后，延迟一点再加载视频，避免快速浏览时触发一堆下载。 */
const VIDEO_DEBOUNCE_MS = APP_CONFIG.videoPreviewDebounceMs;

/** 某个容器内可聚焦的元素（手柄导航用）。 */
function focusablesIn(selector: string): HTMLElement[] {
  const root = document.querySelector(selector);
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]"),
  ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
}

function moveFocus(selector: string, delta: number) {
  const els = focusablesIn(selector);
  if (els.length === 0) return;
  const cur = document.activeElement as HTMLElement | null;
  const i = cur ? els.indexOf(cur) : -1;
  const next = i < 0 ? (delta > 0 ? 0 : els.length - 1) : (i + delta + els.length) % els.length;
  els[next]?.focus();
}

function activateFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return;
  if (el instanceof HTMLButtonElement) el.click();
  else el.focus();
}

export function LibraryPage({
  onOpenSettings,
  settingsOpen,
  onCloseSettings,
  emulatorsOpen,
  onCloseEmulators,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
}: Props) {
  const { source, scanToken } = useStore();
  const provider = useMemo(() => (source ? createProvider(source) : null), [source]);
  const gridRef = useRef<VirtualGridHandle | null>(null);
  // 扫描完成后待滚动的游戏 id（恢复上次位置）
  const pendingScrollId = useRef<string | null>(null);

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
  // 是否正在启动（下载/解压/拉起模拟器）
  const [launching, setLaunching] = useState(false);
  // 本地已下载的游戏 id 集合
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());

  const scanRoot = (source?.romsPath ?? "Roms").trim();

  const scan = useCallback(async () => {
    if (!provider) return;
    setError(null);
    setScanning(true);
    try {
      const r = await scanLibrary(provider, scanRoot);
      setResult(r);
      // 恢复上次选中的游戏/平台；找不到则回退到该平台第一个或全局第一个
      const { lastGameId, lastCollection } = useStore.getState();
      const remembered = lastGameId ? r.games.find((g) => g.id === lastGameId) : undefined;
      const sel =
        remembered ??
        (lastCollection ? r.games.find((g) => g.collection === lastCollection) : undefined) ??
        r.games[0] ??
        null;
      if (remembered) pendingScrollId.current = remembered.id;
      setSelected(sel);
      setCollection(sel ? sel.collection : (r.collections[0] ?? ""));
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

  // 本地已下载集合（每次扫描结果更新后刷新，用于卡片「已下载」标记）
  useEffect(() => {
    let alive = true;
    if (!source) {
      setDownloaded(new Set());
      return;
    }
    (async () => {
      const set = await listDownloadedGames(source, scanRoot);
      if (alive) setDownloaded(set);
    })();
    return () => {
      alive = false;
    };
  }, [source, scanRoot, result]);

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
    if (!selected || !provider || !source || !selected.mediaDir) return;

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
  }, [selected, provider, source]);

  const games = result?.games;
  const filtered = useMemo(
    () => (games ?? []).filter((g) => g.collection === collection),
    [games, collection],
  );

  // 记住上次选中（下次打开定位）
  useEffect(() => {
    if (selected) useStore.getState().setLastSelection(selected.id, selected.collection);
  }, [selected]);

  // 恢复上次位置：扫描完成后滚动到选中项
  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    const idx = filtered.findIndex((g) => g.id === id);
    if (idx < 0) return;
    pendingScrollId.current = null;
    const t = setTimeout(() => gridRef.current?.scrollToIndex(idx), 120);
    return () => clearTimeout(t);
  }, [filtered]);

  // 启动中（下载/解压）或启动失败时，显示居中的进度/状态面板
  const showLaunchPanel = launching || progress !== null || (launchMsg !== null && !launchMsg.ok);

  // 手柄：导航 / 确认启动 / 切换平台 / 菜单 / 全屏
  const gamepadConnected = useGamepad((action) => {
    if (action === "fullscreen") {
      useStore.getState().toggleFullscreen();
      return;
    }
    if (settingsOpen) {
      if (action === "menu" || action === "back") onCloseSettings();
      else if (action === "up") moveFocus(".settings-panel", -1);
      else if (action === "down") moveFocus(".settings-panel", 1);
      else if (action === "confirm") activateFocused();
      return;
    }
    if (emulatorsOpen) {
      if (action === "menu" || action === "back") onCloseEmulators();
      else if (action === "up") moveFocus(".settings-panel", -1);
      else if (action === "down") moveFocus(".settings-panel", 1);
      else if (action === "confirm") activateFocused();
      return;
    }
    if (menuOpen) {
      if (action === "menu" || action === "back") onCloseMenu();
      else if (action === "up") moveFocus(".menu-panel", -1);
      else if (action === "down") moveFocus(".menu-panel", 1);
      else if (action === "confirm") activateFocused();
      return;
    }
    if (action === "menu") onOpenSettings();
    else if (action === "back") onOpenMenu();
    else if (action === "prev") switchPlatform(-1);
    else if (action === "next") switchPlatform(1);
    else if (action === "confirm") {
      if (selected) void launch(selected);
    } else if (action === "up" || action === "down" || action === "left" || action === "right") {
      navigate(action);
    }
  });

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
    if (g.available === false) {
      setLaunchMsg({ ok: false, text: "该游戏文件未上传，无法启动。" });
      return;
    }
    setSelected(g);
    setLaunchMsg(null);
    setProgress(null);
    setLaunching(true);
    try {
      await launchGame(g, provider!, source!, (s) => setLaunchMsg({ ok: true, text: s }));
      await getCurrentWindow().close();
    } catch (e) {
      setLaunching(false);
      setProgress(null);
      setLaunchMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 手柄方向键：在当前平台内移动选中项 */
  function navigate(dir: "up" | "down" | "left" | "right") {
    if (filtered.length === 0) return;
    const cur = selected ? filtered.findIndex((g) => g.id === selected.id) : -1;
    const base = cur < 0 ? 0 : cur;
    const cols = Math.max(1, gridRef.current?.cols() ?? 1);
    const delta = dir === "left" ? -1 : dir === "right" ? 1 : dir === "up" ? -cols : cols;
    const next = base + delta;
    if (next < 0 || next >= filtered.length) return; // 不越界
    const g = filtered[next];
    if (g) {
      setLaunchMsg(null);
      setSelected(g);
      gridRef.current?.scrollToIndex(next);
    }
  }

  /** 手柄 LB/RB：切换平台并选中第一个 */
  function switchPlatform(delta: number) {
    const list = result?.collections ?? [];
    if (list.length === 0) return;
    const i = list.indexOf(collection);
    const next = (i + delta + list.length) % list.length;
    const c = list[next];
    setCollection(c);
    const first = result?.games.find((g) => g.collection === c);
    if (first) setSelected(first);
  }

  return (
    <div className="page">
      {error && <p className="error">{error}</p>}

      <div className="library-layout">
        {/* 左侧：信息面板 */}
        <aside className="detail-panel">
          {selected && (
            <>
              <div className="detail-media">
                {videoSrc ? (
                  <video
                    key={videoSrc}
                    className="preview-video"
                    src={videoSrc}
                    autoPlay
                    muted
                    loop
                    playsInline
                    onCanPlay={(e) => void e.currentTarget.play().catch(() => undefined)}
                    onError={() => setVideoSrc(null)}
                  />
                ) : (
                  <Cover provider={provider} path={selected.coverPath} dir={selected.mediaDir} title={selected.title} />
                )}
              </div>

              <div className="detail-scroll">
                <h3 className="detail-title">{selected.title}</h3>
                <div className="detail-platform">
                  {selected.platformName ?? selected.collection}
                  {selected.available !== false && downloaded.has(selected.id) && (
                    <span className="detail-downloaded">已下载</span>
                  )}
                </div>
                {selected.available === false && (
                  <p className="detail-missing">服务器上没有该游戏文件，无法启动。</p>
                )}

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

                {selected.description && <p className="desc">{selected.description}</p>}
              </div>
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
                onClick={() => {
                  setCollection(c);
                  // 切换平台时自动选中该平台的第一个游戏
                  const first = result?.games.find((g) => g.collection === c);
                  if (first) setSelected(first);
                }}
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
            minColWidth={APP_CONFIG.grid.minColWidth}
            aspect={APP_CONFIG.grid.aspect}
            extraHeight={APP_CONFIG.grid.extraHeight}
            gap={APP_CONFIG.grid.gap}
            overscan={APP_CONFIG.grid.overscan}
            handleRef={gridRef}
            renderItem={(g) => (
              <button
                className={[
                  "game-card",
                  g.id === selected?.id ? "active" : "",
                  g.available === false ? "unavailable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setLaunchMsg(null);
                  setSelected(g);
                }}
                onDoubleClick={() => launch(g)}
              >
                <Cover provider={provider} path={g.coverPath} dir={g.mediaDir} title={g.title} />
                {g.available === false && <span className="game-badge">未上传</span>}
                {g.available !== false && downloaded.has(g.id) && (
                  <span className="game-badge downloaded">已下载</span>
                )}
                <span className="game-title" title={g.title}>
                  {g.title}
                </span>
              </button>
            )}
          />
        </main>
      </div>

      {gamepadConnected && <div className="gamepad-hint">🎮 手柄已连接</div>}

      {showLaunchPanel && (
        <div
          className="launch-overlay"
          onClick={() => {
            if (launchMsg && !launchMsg.ok) setLaunchMsg(null);
          }}
        >
          <div className="launch-panel" onClick={(e) => e.stopPropagation()}>
            <div className="launch-title">{selected?.title ?? "正在启动"}</div>
            <div className="dl-track">
              <div
                className={progress ? "dl-fill" : "dl-fill indeterminate"}
                style={
                  progress
                    ? {
                        width: progress.total
                          ? `${Math.min(100, (progress.downloaded / progress.total) * 100)}%`
                          : "100%",
                      }
                    : undefined
                }
              />
            </div>
            {progress && (
              <div className="launch-meta">
                {progress.path.replace(/\\/g, "/").split("/").pop()}
                {progress.total
                  ? ` · ${(progress.downloaded / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB`
                  : ` · ${(progress.downloaded / 1048576).toFixed(1)} MB`}
              </div>
            )}
            {launchMsg && (
              <div className={launchMsg.ok ? "launch-status" : "launch-status is-error"}>
                {launchMsg.text}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
