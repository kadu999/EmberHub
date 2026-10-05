import { useEffect, useMemo, useRef, useState } from "react";
import { isFullscreen, onFullscreenChange, setFullscreen } from "./platform/window";
import { createProvider } from "./storage";
import type { SourceConfig, StorageProvider } from "./storage/types";
import { scanLibrary, type Game } from "./domain/scan";
import { launchGame } from "./domain/launch";
import { ensureEmulator, ensureRom } from "./domain/ensure";
import { listDownloadedGames } from "./domain/local";
import { Cover } from "./components/Cover";
import { VirtualGrid } from "./components/VirtualGrid";
import { native } from "./shared/native";
import { basename } from "./shared/path";

const LS_KEY = "emberhub2.source";

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
  const [showSettings, setShowSettings] = useState(true);
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

  useEffect(() => onFullscreenChange(setFull), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        void setFullscreen().then(setFull);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  async function connect() {
    setStatus("连接中…");
    setWarnings([]);
    setScanning(true);
    setConnected(false);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(src));
      const p = createProvider(src);
      const res = await scanLibrary(p, src.romsPath || "Roms");
      setProvider(p);
      setCollections(res.collections);
      setGames(res.games);
      setWarnings(res.warnings);
      setCollection(res.collections[0] ?? "");
      setSelected(res.games[0] ?? null);
      setConnected(true);
      setShowSettings(false);
      setStatus(`已加载 ${res.games.length} 个游戏 / ${res.collections.length} 个平台`);
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  async function launch(g: Game) {
    if (!provider) return;
    if (g.available === false) {
      setLaunchMsg({ ok: false, text: "该游戏文件未上传，无法启动。" });
      return;
    }
    setSelected(g);
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

  function selectCollection(c: string) {
    setCollection(c);
    const first = games.find((g) => g.collection === c);
    if (first) setSelected(first);
  }

  // 测试钩子：供打包/冒烟脚本调用
  const srcRef = useRef(src);
  srcRef.current = src;
  useEffect(() => {
    (window as unknown as { __emberhub2?: unknown }).__emberhub2 = {
      connect: () => connect(),
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
      <header>
        <h1>
          EmberHub <span>2.0</span>
        </h1>
        <div className="header-actions">
          <button onClick={() => setShowSettings((v) => !v)}>设置</button>
          <button onClick={() => void setFullscreen().then(setFull)}>
            {full ? "退出全屏" : "全屏"}
          </button>
        </div>
      </header>

      {showSettings && (
        <section className="panel">
          <div className="grid2">
            <label>
              OpenList 地址
              <input
                value={src.server ?? ""}
                onChange={(e) => setSrc({ ...src, server: e.currentTarget.value })}
                placeholder="127.0.0.1:5244"
              />
            </label>
            <label>
              资源源挂载
              <input
                value={src.mountPath ?? ""}
                onChange={(e) => setSrc({ ...src, mountPath: e.currentTarget.value })}
                placeholder="/EmberHub_Baidu"
              />
            </label>
            <label>
              用户名
              <input
                value={src.username ?? ""}
                onChange={(e) => setSrc({ ...src, username: e.currentTarget.value })}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={src.password ?? ""}
                onChange={(e) => setSrc({ ...src, password: e.currentTarget.value })}
              />
            </label>
          </div>
          <div className="actions">
            <button className="primary" onClick={connect}>
              连接并扫描
            </button>
            <span className="muted">{status}</span>
          </div>
        </section>
      )}

      {connected && (
        <div className="library-layout">
          <aside className="detail-panel">
            {selected ? (
              <>
                <div className="detail-media">
                  <Cover
                    provider={provider!}
                    path={selected.coverPath}
                    dir={selected.mediaDir}
                    title={selected.title}
                  />
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
                  <button className="primary launch-btn" onClick={() => void launch(selected)}>
                    启动游戏
                  </button>
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
              minColWidth={150}
              aspect={4 / 3}
              extraHeight={46}
              gap={18}
              overscan={3}
              renderItem={(g) => (
                <button
                  className={[
                    "game-card",
                    g.id === selected?.id ? "active" : "",
                    g.available === false ? "unavailable" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setSelected(g)}
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
