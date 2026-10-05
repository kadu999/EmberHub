// 窗口 / 全屏抽象：一套接口，三套实现按运行时选择。
// - Electron(Windows)：preload 注入的 window.emberhub → 主进程 BrowserWindow.setFullScreen
// - Capacitor(Android)：本地 Fullscreen 插件（沉浸式隐藏系统栏）
// - Web（浏览器 / 开发预览）：标准 Fullscreen API
import { Capacitor, registerPlugin } from "@capacitor/core";

interface FullscreenPlugin {
  setFullscreen(options: { fullscreen: boolean }): Promise<{ fullscreen: boolean }>;
}

const Fullscreen = registerPlugin<FullscreenPlugin>("Fullscreen");

const bridge = typeof window !== "undefined" ? window.emberhub : undefined;
const isElectron = !!bridge;
const isNative = Capacitor.isNativePlatform();

// 非 web 平台没有可靠的同步查询，这里缓存状态（由 setFullscreen 返回值和事件更新）。
let cached = false;

export function isFullscreen(): boolean {
  if (isElectron || isNative) return cached;
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

/** 切换（或指定）全屏，返回切换后的状态。 */
export async function setFullscreen(next?: boolean): Promise<boolean> {
  const target = next ?? !isFullscreen();

  if (isElectron && bridge) {
    cached = await bridge.window.setFullscreen(target);
    return cached;
  }

  if (isNative) {
    const res = await Fullscreen.setFullscreen({ fullscreen: target });
    cached = res.fullscreen;
    return cached;
  }

  try {
    if (target && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    } else if (!target && document.fullscreenElement) {
      await document.exitFullscreen?.();
    }
  } catch (e) {
    console.warn("[EmberHub2] 全屏切换失败:", e);
  }
  return !!document.fullscreenElement;
}

/** 订阅全屏状态变化；返回取消订阅函数。 */
export function onFullscreenChange(cb: (full: boolean) => void): () => void {
  if (isElectron && bridge) {
    void bridge.window.isFullscreen().then((v) => {
      cached = v;
      cb(v);
    });
    return bridge.window.onFullscreenChange((v) => {
      cached = v;
      cb(v);
    });
  }

  if (isNative) {
    // 原生状态由 setFullscreen 的返回值更新，这里无需额外监听。
    return () => {};
  }

  const handler = () => cb(!!document.fullscreenElement);
  document.addEventListener("fullscreenchange", handler);
  return () => document.removeEventListener("fullscreenchange", handler);
}
