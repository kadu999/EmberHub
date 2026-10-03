import { useEffect, useState } from "react";
import { tauri, type AppInfo } from "./lib/tauri";
import { SourcesPage } from "./features/sources/SourcesPage";
import { LibraryPage } from "./features/library/LibraryPage";
import "./App.css";

type Tab = "library" | "sources";

function App() {
  const [tab, setTab] = useState<Tab>("library");
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    tauri.appInfo().then(setInfo).catch(() => undefined);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="flame">🔥</span>
          <span className="brand-name">
            Ember<b>Hub</b>
          </span>
        </div>
        <nav>
          <button
            className={tab === "library" ? "nav active" : "nav"}
            onClick={() => setTab("library")}
          >
            🎮 游戏库
          </button>
          <button
            className={tab === "sources" ? "nav active" : "nav"}
            onClick={() => setTab("sources")}
          >
            ☁️ 存储源
          </button>
        </nav>
        <div className="sidebar-foot">{info ? `v${info.version}` : ""}</div>
      </aside>
      <main className="content">
        {tab === "library" ? <LibraryPage /> : <SourcesPage />}
      </main>
    </div>
  );
}

export default App;
