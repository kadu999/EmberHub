import { useEffect, useMemo, useState } from "react";
import { isFullscreen, onFullscreenChange, setFullscreen } from "./platform/window";
import { createProvider } from "./storage";
import type { SourceConfig, StorageProvider } from "./storage/types";
import { scanLibrary, type Game } from "./domain/scan";
import { launchGame } from "./domain/launch";
import { Cover } from "./components/Cover";

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

/** App2.0 游戏库：连接 OpenList(WebDAV) → 扫描 → 平台切换 + 封面网格。 */
export function App() {
  const [full, setFull] = useState(isFullscreen());
  const [src, setSrc] = useState<SourceConfig>(loadSource);
  const [provider, setProvider] = useState<StorageProvider | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
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

  async function connect() {
    setStatus("连接中…");
    setWarnings([]);
    setProvider(null);
    setGames([]);
    setCollections([]);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(src));
      const p = createProvider(src);
      const res = await scanLibrary(p, src.romsPath || "Roms");
      setProvider(p);
      setCollections(res.collections);
      setGames(res.games);
      setWarnings(res.warnings);
      setSelected(res.collections[0] ?? "");
      setStatus(`已加载 ${res.games.length} 个游戏 / ${res.collections.length} 个平台`);
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const byCollection = useMemo(() => {
    const m = new Map<string, Game[]>();
    for (const g of games) {
      const arr = m.get(g.collection) ?? [];
      arr.push(g);
      m.set(g.collection, arr);
    }
    return m;
  }, [games]);

  async function play(g: Game) {
    if (!provider) return;
    try {
      setStatus(`准备启动 ${g.title}…`);
      await launchGame(g, provider, src, (s) => setStatus(`${g.title}：${s}`));
      setStatus(`已启动：${g.title}`);
    } catch (e) {
      setStatus(`启动失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const shown = byCollection.get(selected) ?? [];

  return (
    <div className="app2">
      <header>
        <h1>
          EmberHub <span>2.0</span>
        </h1>
        <button onClick={() => void setFullscreen().then(setFull)}>
          {full ? "退出全屏" : "全屏"}
        </button>
      </header>

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
        {warnings.length > 0 && (
          <ul className="warn">
            {warnings.slice(0, 8).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      {collections.length > 0 && (
        <nav className="tabs">
          {collections.map((c) => (
            <button
              key={c}
              className={c === selected ? "tab active" : "tab"}
              onClick={() => setSelected(c)}
            >
              {c} <span className="muted">{byCollection.get(c)?.length ?? 0}</span>
            </button>
          ))}
        </nav>
      )}

      <main>
        <div className="grid">
          {shown.map((g) => (
            <div key={g.id} className="card" title={g.title} onClick={() => void play(g)}>
              {provider ? (
                <Cover provider={provider} path={g.coverPath} dir={g.mediaDir} title={g.title} />
              ) : null}
              <span className="card-title">{g.title}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
