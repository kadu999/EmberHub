import { useEffect, useState } from "react";
import { isFullscreen, onFullscreenChange, setFullscreen } from "./platform/window";

/**
 * App2.0 最小壳：验证 Capacitor 方案。
 * 第一步移植的是「窗口 / 全屏」——对应现有 Tauri 版 App.tsx 的
 * F11 / getCurrentWindow().setFullscreen + isFullscreen 监听。
 */
export function App() {
  const [full, setFull] = useState(isFullscreen());

  useEffect(() => onFullscreenChange(setFull), []);

  // F11 快捷键，行为与 1.0 保持一致
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

  return (
    <div className="app">
      <h1>EmberHub 2.0</h1>
      <p className="muted">Capacitor 壳 · 第一步：窗口 / 全屏</p>

      <button onClick={() => void setFullscreen().then(setFull)}>
        {full ? "退出全屏" : "进入全屏"}
      </button>

      <p className="muted">
        当前：<b>{full ? "全屏" : "窗口"}</b>（也可按 F11 切换）
      </p>
    </div>
  );
}
