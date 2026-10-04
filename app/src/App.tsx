import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LibraryPage } from "./features/library/LibraryPage";
import { SourcesPage } from "./features/sources/SourcesPage";
import { useStore } from "./store";
import "./App.css";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const requestScan = useStore((s) => s.requestScan);
  const fullscreen = useStore((s) => s.fullscreen);
  const setFullscreen = useStore((s) => s.setFullscreen);

  const openSettings = () => {
    setShowMenu(false);
    setShowSettings(true);
  };

  // 应用全屏偏好（启动时 + 切换时）
  useEffect(() => {
    void getCurrentWindow()
      .setFullscreen(fullscreen)
      .catch(() => undefined);
  }, [fullscreen]);

  // 快捷键：F1 设置 / F5 重扫 / F11 全屏 / Esc 菜单（设置打开时先关设置）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        setShowMenu(false);
        setShowSettings((v) => !v);
      } else if (e.key === "F5") {
        e.preventDefault();
        requestScan();
      } else if (e.key === "F11") {
        e.preventDefault();
        setFullscreen(!fullscreen);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (showSettings) setShowSettings(false);
        else setShowMenu((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestScan, fullscreen, setFullscreen, showSettings]);

  return (
    <div className="app">
      <LibraryPage
        onOpenSettings={openSettings}
        settingsOpen={showSettings}
        onCloseSettings={() => setShowSettings(false)}
        menuOpen={showMenu}
        onOpenMenu={() => setShowMenu(true)}
        onCloseMenu={() => setShowMenu(false)}
      />

      {showMenu && !showSettings && (
        <div className="menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => void getCurrentWindow().close()}>退出</button>
            <button autoFocus onClick={openSettings}>
              设置
            </button>
          </div>
        </div>
      )}

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
