import { useEffect, useState } from "react";
import { tauri, type AppInfo } from "./lib/tauri";
import { LocalStorageProvider } from "./storage/providers/local";
import type { RemoteEntry } from "./storage/types";
import "./App.css";

const local = new LocalStorageProvider();

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [path, setPath] = useState("E:\\WorkSpace\\EmberHub");
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    tauri.appInfo().then(setInfo).catch((e) => setError(String(e)));
  }, []);

  async function browse() {
    setError(null);
    try {
      setEntries(await local.list(path));
    } catch (e) {
      setError(String(e));
      setEntries([]);
    }
  }

  return (
    <main className="app">
      <header className="hero">
        <div className="brand">
          <span className="flame">🔥</span>
          <h1>
            Ember<span className="accent">Hub</span>
          </h1>
        </div>
        <p className="tagline">{info?.tagline ?? "让每一款老游戏，重新燃烧。"}</p>
        <p className="version">
          {info ? `v${info.version}` : "loading…"} · {local.displayName}
        </p>
      </header>

      <section className="panel">
        <h2>本地存储测试</h2>
        <p className="hint">
          通过 LocalProvider → Tauri 命令读取磁盘，验证前后端桥已打通。
        </p>
        <div className="row">
          <input
            value={path}
            onChange={(e) => setPath(e.currentTarget.value)}
            placeholder="输入本地目录路径"
          />
          <button onClick={browse}>浏览</button>
        </div>

        {error && <p className="error">{error}</p>}

        <ul className="entries">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="icon">{e.isDir ? "📁" : "📄"}</span>
              <span className="name">{e.name}</span>
              <span className="size">{e.isDir ? "—" : formatSize(e.size)}</span>
            </li>
          ))}
          {entries.length === 0 && !error && <li className="empty">（暂无内容）</li>}
        </ul>
      </section>
    </main>
  );
}

export default App;
