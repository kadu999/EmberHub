import { useEffect, useMemo, useState } from "react";
import { isFullscreen, onFullscreenChange, setFullscreen } from "./platform/window";
import { createProvider } from "./storage";
import type { SourceConfig } from "./storage/types";
import { scanLibrary, type Game } from "./domain/scan";

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

/** App2.0 最小游戏库：连接 OpenList(WebDAV) → 扫描 → 列出平台与游戏。 */
export function App() {
  const [full, setFull] = useState(isFullscreen());
  const [src, setSrc] = useState<SourceConfig>(loadSource);
  const [games, setGames] = useState<Game[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
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
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(src));
      const provider = createProvider(src);
      const res = await scanLibrary(provider, src.romsPath || "Roms");
      setCollections(res.collections);
      setGames(res.games);
      setWarnings(res.warnings);
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

      <main>
        {collections.map((c) => (
          <section key={c} className="collection">
            <h2>
              {c} <span className="muted">({byCollection.get(c)?.length ?? 0})</span>
            </h2>
            <ul>
              {(byCollection.get(c) ?? []).slice(0, 300).map((g) => (
                <li key={g.id} className={g.available === false ? "missing" : undefined}>
                  {g.title}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
