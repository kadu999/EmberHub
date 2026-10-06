import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { LibraryPage } from "./features/library/LibraryPage";
import { SourcesPage } from "./features/sources/SourcesPage";
import { EmulatorsPage } from "./features/emulators/EmulatorsPage";
import { CachePage } from "./features/cache/CachePage";
import { useStore } from "./state/store";
import { tauri } from "./shared/tauri";
import { getDownloadDir } from "./domain/ensure";
import { joinPath } from "./shared/path";
import { platform } from "./platform";
import "./App.css";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showEmulators, setShowEmulators] = useState(false);
  const [showCache, setShowCache] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Android：启动权限门 —— 未授权前不进入主界面（存储 + 安装未知应用）
  const [missingPerms, setMissingPerms] = useState({ storage: false, install: false });
  const [permsChecked, setPermsChecked] = useState(!platform.isMobile);
  const requestScan = useStore((s) => s.requestScan);
  const fullscreen = useStore((s) => s.fullscreen);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const source = useStore((s) => s.source);
  const downloadDir = useStore((s) => s.downloadDir);
  // Android：权限门通过前，禁止任何网络 / 文件读写（未授权会 EPERM / 失败）
  const permsReady = permsChecked && !missingPerms.storage && !missingPerms.install;

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
  // 权限门通过前不写日志，避免未授权时写文件失败（EPERM）。
  useEffect(() => {
    if (!permsReady) return;
    void getDownloadDir(source ?? undefined)
      .then((d) => tauri.logInit(joinPath(d, "logs")))
      .catch(() => undefined);
  }, [source, downloadDir, permsReady]);

  // Android：启动即检查所需权限；缺了就停在权限门（从系统设置返回时自动复查）
  const checkPerms = useCallback(async () => {
    if (!platform.isMobile) return;
    const [storage, install] = await Promise.all([
      tauri.hasAllFilesAccess().catch(() => true),
      tauri.canInstallPackages().catch(() => true),
    ]);
    setMissingPerms({ storage: !storage, install: !install });
    setPermsChecked(true);
  }, []);

  useEffect(() => {
    if (!platform.isMobile) return;
    void checkPerms();
    const onVis = () => {
      if (document.visibilityState === "visible") void checkPerms();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [checkPerms]);

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

  // Android 返回键：等价 Esc（逐层关闭面板）；都关了就退出应用
  useEffect(() => {
    if (!platform.isMobile) return;
    let unlisten: (() => void) | undefined;
    void onBackButtonPress(() => {
      if (showSettings) setShowSettings(false);
      else if (showEmulators) setShowEmulators(false);
      else if (showCache) setShowCache(false);
      else if (showMenu) setShowMenu(false);
      else void getCurrentWindow().close();
    })
      .then((l) => {
        unlisten = () => void l.unregister();
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [showSettings, showEmulators, showCache, showMenu]);

  const anyPanel = showSettings || showEmulators || showCache;

  // Android 权限门：未检查完 / 缺权限时**不渲染主界面**（也不做任何 I/O）
  if (!permsReady) {
    const checking = !permsChecked;
    return (
      <div className={"app" + (platform.isMobile ? " is-mobile" : "")}>
        <div className="perm-gate">
          <div className="perm-card">
            {checking ? (
              <p className="hint">正在检查权限…</p>
            ) : (
              <>
                <h2>需要授予权限</h2>
                <p className="hint">
                  EmberHub 需要以下权限才能下载 / 安装 / 启动模拟器，请先授予：
                </p>
                {missingPerms.storage && (
                  <div className="actions">
                    <button onClick={() => void tauri.requestAllFilesAccess()}>
                      授予「所有文件访问」
                    </button>
                  </div>
                )}
                {missingPerms.install && (
                  <div className="actions">
                    <button onClick={() => void tauri.requestInstallPackages()}>
                      授予「安装未知应用」
                    </button>
                  </div>
                )}
                <p className="hint">
                  「所有文件访问」用于把 ROM / 模拟器写入共享目录（Android 11+ 必需）；「安装未知应用」用于安装模拟器
                  APK。授权后回到本应用会自动继续。
                </p>
                <div className="actions" style={{ justifyContent: "center" }}>
                  <button className="ghost" onClick={() => void tauri.exitApp()}>
                    退出
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"app" + (platform.isMobile ? " is-mobile" : "")}>
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
            <button onClick={() => void tauri.exitApp()}>退出</button>
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
