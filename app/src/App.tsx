import { useEffect, useState } from "react";
import { LibraryPage } from "./features/library/LibraryPage";
import { SourcesPage } from "./features/sources/SourcesPage";
import { useStore } from "./store";
import "./App.css";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const requestScan = useStore((s) => s.requestScan);

  // 默认进入游戏库；F1 打开设置，F5 重新扫描，Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        setShowSettings((v) => !v);
      } else if (e.key === "F5") {
        e.preventDefault();
        requestScan();
      } else if (e.key === "Escape") {
        setShowSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestScan]);

  return (
    <div className="app">
      <LibraryPage onOpenSettings={() => setShowSettings(true)} />

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <SourcesPage onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
