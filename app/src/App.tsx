import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LibraryPage } from "./features/library/LibraryPage";
import { SourcesPage } from "./features/sources/SourcesPage";
import { EmulatorsPage } from "./features/emulators/EmulatorsPage";
import { CachePage } from "./features/cache/CachePage";
import { useStore } from "./state/store";
import { tauri } from "./shared/tauri";
import { getDownloadDir } from "./domain/ensure";
import { joinPath } from "./shared/path";
import "./App.css";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showEmulators, setShowEmulators] = useState(false);
  const [showCache, setShowCache] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const requestScan = useStore((s) => s.requestScan);
  const fullscreen = useStore((s) => s.fullscreen);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const source = useStore((s) => s.source);
  const downloadDir = useStore((s) => s.downloadDir);

  const openSettings = () => {
    setShowMenu(false);
    setShowEmulators(false);
    setShowCache(false);
    setShowSettings(true);
  };
  const openEmulators = () => {
    setShowMenu(false);
    setShowSettings(false);
    setShowCache(false);
    setShowEmulators(true);
  };
  const openCache = () => {
    setShowMenu(false);
    setShowSettings(false);
    setShowEmulators(false);
    setShowCache(true);
  };

  // 应用全屏偏好（启动时 + 切换时）
  useEffect(() => {
    void getCurrentWindow()
      .setFullscreen(fullscreen)
      .catch(() => undefined);
  }, [fullscreen]);

  // 失败日志目录：<下载目录>/logs（下载目录变化时更新）
  useEffect(() => {
    void getDownloadDir(source ?? undefined)
      .then((d) => tauri.logInit(joinPath(d, "logs")))
      .catch(() => undefined);
  }, [source, downloadDir]);

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
        else if (showCache) setShowCache(false);
        else setShowMenu((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestScan, fullscreen, setFullscreen, showSettings, showEmulators, showCache]);

  const anyPanel = showSettings || showEmulators || showCache;

  return (
    <div className="app">
      <LibraryPage
        onOpenSettings={openSettings}
        settingsOpen={showSettings}
        onCloseSettings={() => setShowSettings(false)}
        emulatorsOpen={showEmulators}
        onCloseEmulators={() => setShowEmulators(false)}
        cacheOpen={showCache}
        onCloseCache={() => setShowCache(false)}
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
            <button onClick={openCache}>资源缓存</button>
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

      {showCache && (
        <div className="settings-overlay" onClick={() => setShowCache(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <CachePage onClose={() => setShowCache(false)} />
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
