import { useEffect, useMemo, useRef, useState } from "react";
import { isFullscreen, onFullscreenChange, setFullscreen } from "./platform/window";
import { createProvider } from "./storage";
import type { SourceConfig, StorageProvider } from "./storage/types";
import { scanLibrary, type Game } from "./domain/scan";
import { launchGame } from "./domain/launch";
import { ensureEmulator, ensureLocalMedia, ensureRom } from "./domain/ensure";
import { listDownloadedGames } from "./domain/local";
import { listMediaNames } from "./domain/media-cache";
import { Cover } from "./components/Cover";
import { VirtualGrid, type VirtualGridHandle } from "./components/VirtualGrid";
import { SourcesPage } from "./features/sources/SourcesPage";
import { EmulatorsPage } from "./features/emulators/EmulatorsPage";
import { APP_CONFIG } from "./config/config";
import { native } from "./shared/native";
import { basename, joinPath } from "./shared/path";
import { pickVideoName } from "./shared/media";
import { useGamepad } from "./shared/useGamepad";

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

const LS_KEY = "emberhub2.source";
const LS_FULL = "emberhub2.fullscreen";
const LS_LAST = "emberhub2.last";

const DEFAULT_SOURCE: SourceConfig = {
  id: "default",
  name: "OpenList",
  kind: "openlist",
  server: "127.0.0.1:5244",
  mountPath: "/EmberHub_Baidu",
  username: "admin",
  password: "12345",
  romsPath: "Roms",
};

function loadSource(): SourceConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_SOURCE, ...(JSON.parse(raw) as SourceConfig) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SOURCE;
}

interface Progress {
  path: string;
  downloaded: number;
  total: number | null;
}

/** App2.0 游戏库：连接 OpenList → 扫描 → 详情面板 + 封面网格 + 启动。 */
export function App() {
  const [full, setFull] = useState(isFullscreen());
  const [src, setSrc] = useState<SourceConfig>(loadSource);
  const [showSettings, setShowSettings] = useState(false);
  const [showEmulators, setShowEmulators] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [provider, setProvider] = useState<StorageProvider | null>(null);
  const [connected, setConnected] = useState(false);

  const [games, setGames] = useState<Game[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [collection, setCollection] = useState("");
  const [selected, setSelected] = useState<Game | null>(null);
  const [scanning, setScanning] = useState(false);

  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState("未连接");
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const gridRef = useRef<VirtualGridHandle | null>(null);
  const pendingScrollId = useRef<string | null>(null);

  function applyFull(v: boolean) {
    setFull(v);
    try {
      localStorage.setItem(LS_FULL, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  useEffect(() => onFullscreenChange(applyFull), []);

  // 全屏状态记忆：启动时应用
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_FULL) === "1") void setFullscreen(true).then(applyFull);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        setShowMenu(false);
        setShowSettings((v) => !v);
      } else if (e.key === "F5") {
        e.preventDefault();
        void connect();
      } else if (e.key === "F11") {
        e.preventDefault();
        void setFullscreen().then(applyFull);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (showSettings) setShowSettings(false);
        else if (showEmulators) setShowEmulators(false);
        else setShowMenu((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, showEmulators]);

  // 启动时若已配置资源源，自动扫描（对齐 1.0）
  useEffect(() => {
    if (src.server && src.mountPath) void connect(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 下载进度（媒体缓存静默）
  useEffect(
    () =>
      native.dav.onDownloadProgress((p) => {
        if (/[\\/]\.cache[\\/]media[\\/]/.test(p.path)) return;
        setProgress({ path: p.path, downloaded: p.downloaded, total: p.total });
      }),
    [],
  );

  // 本地已下载集合
  useEffect(() => {
    if (!connected) {
      setDownloaded(new Set());
      return;
    }
    let alive = true;
    void listDownloadedGames(src, src.romsPath || "Roms").then((s) => {
      if (alive) setDownloaded(s);
    });
    return () => {
      alive = false;
    };
  }, [connected, src, games]);

  // 选中游戏的视频预览（懒加载：列 media 目录 → 挑视频 → 按需下载）
  useEffect(() => {
    let alive = true;
    setVideoSrc(null);
    if (!selected || !provider || !selected.mediaDir) return;
    const dir = selected.mediaDir;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const names = await listMediaNames(provider, dir);
          const pick = pickVideoName(names);
          if (!pick) return;
          const p = await ensureLocalMedia(provider, joinPath(dir, pick));
          if (alive) setVideoSrc(native.media.url(p));
        } catch (e) {
          console.warn("[EmberHub2] 视频加载失败:", e);
        }
      })();
    }, APP_CONFIG.videoPreviewDebounceMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selected, provider]);

  const byCollection = useMemo(() => {
    const m = new Map<string, Game[]>();
    for (const g of games) {
      const arr = m.get(g.collection) ?? [];
      arr.push(g);
      m.set(g.collection, arr);
    }
    return m;
  }, [games]);

  const filtered = byCollection.get(collection) ?? [];

  async function connect(cfg: SourceConfig = src) {
    setStatus("连接中…");
    setWarnings([]);
    setScanning(true);
    setConnected(false);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
      const p = createProvider(cfg);
      const res = await scanLibrary(p, cfg.romsPath || "Roms");
      setProvider(p);
      setCollections(res.collections);
      setGames(res.games);
      setWarnings(res.warnings);
      let sel = res.games[0] ?? null;
      try {
        const remembered = JSON.parse(localStorage.getItem(LS_LAST) || "null") as {
          id?: string;
          collection?: string;
        } | null;
        if (remembered) {
          const hit =
            res.games.find((g) => g.id === remembered.id) ??
            res.games.find((g) => g.collection === remembered.collection);
          if (hit) {
            sel = hit;
            pendingScrollId.current = hit.id;
          }
        }
      } catch {
        /* ignore */
      }
      setSelected(sel);
      setCollection(sel ? sel.collection : (res.collections[0] ?? ""));
      if (sel) selectGame(sel);
      setConnected(true);
      setShowSettings(false);
      setStatus(`已加载 ${res.games.length} 个游戏 / ${res.collections.length} 个平台`);
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  function onSaveSource(cfg: SourceConfig) {
    setSrc(cfg);
    setShowSettings(false);
    void connect(cfg);
  }

  async function launch(g: Game) {
    if (!provider) return;
    if (g.available === false) {
      setLaunchMsg({ ok: false, text: "该游戏文件未上传，无法启动。" });
      return;
    }
    selectGame(g);
    setLaunchMsg(null);
    setProgress(null);
    setLaunching(true);
    try {
      await launchGame(g, provider, src, (s) => setLaunchMsg({ ok: true, text: s }));
      setLaunching(false);
      setProgress(null);
      setLaunchMsg({ ok: true, text: `已启动：${g.title}` });
      void listDownloadedGames(src, src.romsPath || "Roms").then(setDownloaded);
    } catch (e) {
      setLaunching(false);
      setProgress(null);
      setLaunchMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  function selectGame(g: Game) {
    setSelected(g);
    try {
      localStorage.setItem(LS_LAST, JSON.stringify({ id: g.id, collection: g.collection }));
    } catch {
      /* ignore */
    }
  }

  function selectCollection(c: string) {
    setCollection(c);
    const first = games.find((g) => g.collection === c);
    if (first) selectGame(first);
  }

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

  /** 手柄方向键：在当前平台内移动选中项 */
  function navigate(dir: "up" | "down" | "left" | "right") {
    if (filtered.length === 0) return;
    const cur = selected ? filtered.findIndex((g) => g.id === selected.id) : -1;
    const base = cur < 0 ? 0 : cur;
    const cols = Math.max(1, gridRef.current?.cols() ?? 1);
    const delta = dir === "left" ? -1 : dir === "right" ? 1 : dir === "up" ? -cols : cols;
    const next = base + delta;
    if (next < 0 || next >= filtered.length) return;
    const g = filtered[next];
    if (g) {
      selectGame(g);
      gridRef.current?.scrollToIndex(next);
    }
  }

  /** 手柄 LB/RB：切换平台并选中第一个 */
  function switchPlatform(delta: number) {
    if (collections.length === 0) return;
    const i = collections.indexOf(collection);
    const next = (i + delta + collections.length) % collections.length;
    const c = collections[next];
    setCollection(c);
    const first = games.find((g) => g.collection === c);
    if (first) selectGame(first);
  }

  // 手柄：导航 / 确认启动 / 切换平台 / 菜单 / 全屏
  const gamepadConnected = useGamepad((action) => {
    if (action === "fullscreen") {
      void setFullscreen().then(applyFull);
      return;
    }
    if (showSettings || showEmulators) {
      if (action === "menu" || action === "back") {
        setShowSettings(false);
        setShowEmulators(false);
      } else if (action === "up") moveFocus(".settings-panel", -1);
      else if (action === "down") moveFocus(".settings-panel", 1);
      else if (action === "confirm") activateFocused();
      return;
    }
    if (action === "menu") setShowSettings(true);
    else if (action === "prev") switchPlatform(-1);
    else if (action === "next") switchPlatform(1);
    else if (action === "confirm") {
      if (selected) void launch(selected);
    } else if (action === "up" || action === "down" || action === "left" || action === "right") {
      navigate(action);
    }
  });

  // 测试钩子：供打包/冒烟脚本调用
  const srcRef = useRef(src);
  srcRef.current = src;
  useEffect(() => {
    (window as unknown as { __emberhub2?: unknown }).__emberhub2 = {
      connect: () => connect(),
      openSettings: () => setShowSettings(true),
      openEmulators: () => setShowEmulators(true),
      openMenu: () => setShowMenu(true),
      closeAll: () => {
        setShowSettings(false);
        setShowEmulators(false);
        setShowMenu(false);
      },
      prepare: async (platform: string) => {
        try {
          const p = createProvider(srcRef.current);
          const res = await scanLibrary(p, srcRef.current.romsPath || "Roms");
          const game = res.games.find((g) => g.collection === platform);
          if (!game) return { error: `没有 ${platform} 的游戏` };
          const emu = await ensureEmulator(p, srcRef.current, platform, (s) => setStatus(s));
          const rom = await ensureRom(p, srcRef.current, game, (s) => setStatus(s));
          return {
            platform,
            title: game.title,
            emuDir: emu.dir,
            emuExe: emu.config.exe,
            args: emu.args,
            romPath: rom,
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
      play: async (platform: string) => {
        try {
          const p = createProvider(srcRef.current);
          const res = await scanLibrary(p, srcRef.current.romsPath || "Roms");
          const game = res.games.find((g) => g.collection === platform);
          if (!game) return { error: `没有 ${platform} 的游戏` };
          const pid = await launchGame(game, p, srcRef.current, (s) => setStatus(s));
          return { platform, title: game.title, pid };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
      list: async () => {
        const p = createProvider(srcRef.current);
        const res = await scanLibrary(p, srcRef.current.romsPath || "Roms");
        return {
          collections: res.collections,
          warnings: res.warnings,
          games: res.games.map((g) => ({ c: g.collection, t: g.title, a: g.available })),
        };
      },
    };
    return () => {
      delete (window as unknown as { __emberhub2?: unknown }).__emberhub2;
    };
  }, []);

  const showLaunchPanel = launching || progress !== null || (launchMsg !== null && !launchMsg.ok);

  return (
    <div className="app2">
      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <SourcesPage source={src} onSave={onSaveSource} onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}

      {showEmulators && (
        <div className="overlay" onClick={() => setShowEmulators(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <EmulatorsPage source={src} onClose={() => setShowEmulators(false)} />
          </div>
        </div>
      )}

      {showMenu && !showSettings && !showEmulators && (
        <div className="menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            <button
              autoFocus
              onClick={() => {
                setShowMenu(false);
                setShowEmulators(true);
              }}
            >
              模拟器
            </button>
            <button
              onClick={() => {
                setShowMenu(false);
                setShowSettings(true);
              }}
            >
              设置
            </button>
            <button onClick={() => void setFullscreen().then(applyFull)}>
              {full ? "退出全屏" : "全屏"}
            </button>
            <button
              onClick={() => {
                setShowMenu(false);
                void connect(src);
              }}
            >
              扫描游戏库
            </button>
            <button onClick={() => window.close()}>退出</button>
          </div>
        </div>
      )}

      {!connected && !showSettings && (
        <div className="page centered">
          <div className="brand big">
            <span className="flame">🔥</span>
            <span>EmberHub 2.0</span>
          </div>
          <button className="primary" onClick={() => setShowSettings(true)}>
            打开设置
          </button>
          <p className="muted">用 OpenList（WebDAV）连接游戏库</p>
        </div>
      )}

      {connected && (
        <div className="library-layout">
          <aside className="detail-panel">
            {selected ? (
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
                    <Cover
                      provider={provider!}
                      path={selected.coverPath}
                      dir={selected.mediaDir}
                      title={selected.title}
                    />
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
            ) : (
              <p className="muted">选择一个游戏</p>
            )}
          </aside>

          <main className="library-main">
            <div className="filters">
              {collections.map((c) => (
                <button
                  key={c}
                  className={collection === c ? "chip active" : "chip"}
                  onClick={() => selectCollection(c)}
                >
                  {c}
                  <span className="muted"> {byCollection.get(c)?.length ?? 0}</span>
                </button>
              ))}
              {scanning && <span className="refresh-badge">刷新中…</span>}
              {status && status !== "未连接" && <span className="refresh-badge">{status}</span>}
            </div>

            {warnings.length > 0 && (
              <details className="warnings">
                <summary>{warnings.length} 条警告</summary>
                <ul>
                  {warnings.map((w, i) => (
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
                  onClick={() => selectGame(g)}
                  onDoubleClick={() => void launch(g)}
                >
                  <Cover provider={provider!} path={g.coverPath} dir={g.mediaDir} title={g.title} />
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
      )}

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
                {basename(progress.path)}
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
            {launchMsg && !launchMsg.ok && <div className="muted">点击空白处关闭</div>}
          </div>
        </div>
      )}
    </div>
  );
}
