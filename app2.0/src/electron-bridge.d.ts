// Electron preload 注入到 window.emberhub 的桥类型声明。
export {};

declare global {
  interface EmberHubWindowBridge {
    setFullscreen(next?: boolean): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
    onFullscreenChange(cb: (full: boolean) => void): () => void;
  }

  interface EmberHubBridge {
    runtime: "electron";
    window: EmberHubWindowBridge;
  }

  interface Window {
    /** 仅 Electron 壳注入；Capacitor/浏览器下为 undefined */
    emberhub?: EmberHubBridge;
  }
}
