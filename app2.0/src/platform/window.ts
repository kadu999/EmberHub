// 窗口 / 全屏抽象。
// 对应 1.0（Tauri）里的 getCurrentWindow().setFullscreen / isFullscreen：
// - Web（浏览器 / 开发调试）：用标准 Fullscreen API；
// - 原生（Capacitor Android）：调用本地 Fullscreen 插件（沉浸式隐藏系统栏）。
import { Capacitor, registerPlugin } from "@capacitor/core";

interface FullscreenPlugin {
  setFullscreen(options: { fullscreen: boolean }): Promise<{ fullscreen: boolean }>;
}

const Fullscreen = registerPlugin<FullscreenPlugin>("Fullscreen");

const isNative = Capacitor.isNativePlatform();

// 原生侧没有可靠的同步查询接口，这里由本模块维护状态。
let nativeFullscreen = false;

export function isFullscreen(): boolean {
  return isNative ? nativeFullscreen : !!document.fullscreenElement;
}

/** 切换（或指定）全屏，返回切换后的状态。 */
export async function setFullscreen(next?: boolean): Promise<boolean> {
  const target = next ?? !isFullscreen();

  if (isNative) {
    const res = await Fullscreen.setFullscreen({ fullscreen: target });
    nativeFullscreen = res.fullscreen;
    return nativeFullscreen;
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
  if (isNative) {
    // 原生状态由 setFullscreen 的返回值更新，这里无需额外监听。
    return () => {};
  }
  const handler = () => cb(!!document.fullscreenElement);
  document.addEventListener("fullscreenchange", handler);
  return () => document.removeEventListener("fullscreenchange", handler);
}
