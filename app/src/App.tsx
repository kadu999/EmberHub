import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LibraryPage } from "./features/library/LibraryPage";
import { SourcesPage } from "./features/sources/SourcesPage";
import { EmulatorsPage } from "./features/emulators/EmulatorsPage";
import { useStore } from "./state/store";
import "./App.css";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showEmulators, setShowEmulators] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const requestScan = useStore((s) => s.requestScan);
  const fullscreen = useStore((s) => s.fullscreen);
  const setFullscreen = useStore((s) => s.setFullscreen);

  const openSettings = () => {
    setShowMenu(false);
    setShowEmulators(false);
    setShowSettings(true);
  };
  const openEmulators = () => {
    setShowMenu(false);
    setShowSettings(false);
    setShowEmulators(true);
  };

  // 应用全屏偏好（启动时 + 切换时）
  useEffect(() => {
    void getCurrentWindow()
      .setFullscreen(fullscreen)
      .catch(() => undefined);
  }, [fullscreen]);

  // 快捷键：F1 设置 / F5 重扫 / F11 全屏 / Esc 逐层关闭
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
        else if (showEmulators) setShowEmulators(false);
        else setShowMenu((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestScan, fullscreen, setFullscreen, showSettings, showEmulators]);

  const anyPanel = showSettings || showEmulators;

  return (
    <div className="app">
      <LibraryPage
        onOpenSettings={openSettings}
        settingsOpen={showSettings}
        onCloseSettings={() => setShowSettings(false)}
        emulatorsOpen={showEmulators}
        onCloseEmulators={() => setShowEmulators(false)}
        menuOpen={showMenu}
        onOpenMenu={() => setShowMenu(true)}
        onCloseMenu={() => setShowMenu(false)}
      />

      {showMenu && !anyPanel && (
        <div className="menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            <button autoFocus onClick={openEmulators}>
              模拟器
            </button>
            <button onClick={openSettings}>设置</button>
            <button onClick={() => void getCurrentWindow().close()}>退出</button>
          </div>
        </div>
      )}

      {showEmulators && (
        <div className="settings-overlay" onClick={() => setShowEmulators(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <EmulatorsPage onClose={() => setShowEmulators(false)} />
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
