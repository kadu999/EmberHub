// 游戏库页（默认首页）：左侧信息面板 + 右侧游戏网格。
// 进入即自动扫描；重扫时保留旧数据，避免闪烁成空白。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../../state/store";
import { APP_CONFIG } from "../../config/config";
import { createProvider, type StorageProvider } from "../../storage";
import { createCachedProvider } from "../../domain/library-cache";
import { scanLibrary, type Game, type ScanResult } from "../../domain/scan";
import { Cover } from "../../components/Cover";
import { VirtualGrid, type VirtualGridHandle } from "../../components/VirtualGrid";
import { launchGame } from "../../domain/launch";
import { ensureLocalMedia, warmEmulatorConfig } from "../../domain/ensure";
import { listDownloadedGames } from "../../domain/local";
import { listMediaNames } from "../../domain/media-cache";
import { joinPath } from "../../shared/path";
import { pickVideoName } from "../../shared/media";
import { useGamepad } from "../../shared/useGamepad";
import { platform } from "../../platform";

interface Props {
  onOpenSettings: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  emulatorsOpen: boolean;
  onCloseEmulators: () => void;
  cacheOpen: boolean;
  onCloseCache: () => void;
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
  cacheOpen,
  onCloseCache,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
}: Props) {
  const { source, scanToken } = useStore();
  const mobile = platform.isMobile;
  const [provider, setProvider] = useState<StorageProvider | null>(null);
  const gridRef = useRef<VirtualGridHandle | null>(null);

  // 缓存型 provider：配置/列表/games.json 默认读本地缓存，扫描时再强制刷新 manifest。
  useEffect(() => {
    let alive = true;
    if (!source) {
      setProvider(null);
      return;
    }
    void createCachedProvider(createProvider(source), source)
      .then((p) => {
        if (alive) setProvider(p);
      })
      .catch(() => {
        if (alive) setProvider(null);
      });
    return () => {
      alive = false;
    };
  }, [source]);
  // 扫描完成后待滚动的游戏 id（恢复上次位置）
  const pendingScrollId = useRef<string | null>(null);
  /** 是否正在「启动游戏」流程：只在这时显示下载进度浮层（模拟器页下 APK 等不应弹） */
  const launchingRef = useRef(false);
  /** 始终指向最新的 launch（供「安装完自动继续」复用，避免闭包过期） */
  const launchRef = useRef<(g: Game) => void>(() => undefined);

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

  // 让 launchRef 始终指向最新闭包（provider/source 变化后仍可用）
  useEffect(() => {
    launchRef.current = (g) => void launch(g);
  });

  // Android：从系统安装器回到前台时，若刚才是「等模拟器安装」的启动，则自动继续。
  // 不做原地等待、也不依赖回调：只在这里查一次当前是否已安装。
  // 注意：必须放在组件所有 early return 之前，保证每次渲染 hook 数量一致。
  useEffect(() => {
    if (!platform.isMobile) return;
    const onResume = () => {
      if (document.visibilityState !== "visible") return;
      if (!provider || !source) return; // 资源源还没就绪：先不消费，等它就绪后再查
      const pending = useStore.getState().pendingLaunch;
      if (!pending) return;
      useStore.getState().setPendingLaunch(null); // 先消费，避免重复触发
      void (async () => {
        try {
          if (await platform.isEmulatorInstalled(pending.pkg)) {
            launchRef.current(pending.game);
          } else {
            setLaunchMsg({
              ok: false,
              text: `模拟器 ${pending.pkg} 仍未安装，请再次点击游戏重试。`,
            });
          }
        } catch (e) {
          setLaunchMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
        }
      })();
    };
    onResume(); // 挂载/资源源就绪时也查一次（进程被回收后重开也能续上）
    document.addEventListener("visibilitychange", onResume);
    return () => document.removeEventListener("visibilitychange", onResume);
  }, [provider, source]);

  const scanRoot = (source?.romsPath ?? "Roms").trim();

  const scan = useCallback(async () => {
    if (!provider) return;
    setError(null);
    setScanning(true);
    try {
      const r = await scanLibrary(provider, scanRoot);
      setResult(r);
      // 预热模拟器配置缓存：让「模拟器」页之后打开时完全离线
      if (source) void warmEmulatorConfig(provider, source).catch(() => undefined);
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
        // 只在「启动游戏」流程里显示下载进度（否则模拟器页下载 APK 也会弹这个浮层）
        if (!launchingRef.current) return;
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
  const showLaunchPanel = launching || (launchMsg !== null && !launchMsg.ok);

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
    if (cacheOpen) {
      if (action === "menu" || action === "back") onCloseCache();
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
    launchingRef.current = true;
    setLaunching(true);
    try {
      await launchGame(g, provider!, source!, (s) => setLaunchMsg({ ok: true, text: s }));
      launchingRef.current = false;
      await getCurrentWindow().close();
    } catch (e) {
      launchingRef.current = false;
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

                {selected.available !== false && (
                  <div className="actions">
                    <button onClick={() => void launch(selected)} disabled={launching}>
                      {launching ? "启动中…" : "启动游戏"}
                    </button>
                  </div>
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
            <button className="ghost small" style={{ marginLeft: "auto" }} onClick={onOpenMenu}>
              菜单
            </button>
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
            minColWidth={mobile ? 104 : APP_CONFIG.grid.minColWidth}
            aspect={APP_CONFIG.grid.aspect}
            extraHeight={mobile ? 34 : APP_CONFIG.grid.extraHeight}
            gap={mobile ? 10 : APP_CONFIG.grid.gap}
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
            {/* 只有真正在下载（且有总大小）时才显示进度条；纯启动时不显示 */}
            {progress && progress.total ? (
              <div className="dl-track">
                <div
                  className="dl-fill"
                  style={{
                    width: `${Math.min(100, (progress.downloaded / progress.total) * 100)}%`,
                  }}
                />
              </div>
            ) : null}
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
