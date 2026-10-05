// Electron preload：把壳能力以 contextBridge 暴露给渲染进程（window.emberhub）。
// 渲染进程不 import electron，所以同一份前端 bundle 也能跑在 Capacitor/浏览器上。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("emberhub", {
  runtime: "electron",
  window: {
    setFullscreen: (next) => ipcRenderer.invoke("window:set-fullscreen", next),
    isFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
    onFullscreenChange: (cb) => {
      const listener = (_e, value) => cb(value);
      ipcRenderer.on("window:fullscreen", listener);
      return () => ipcRenderer.removeListener("window:fullscreen", listener);
    },
  },
});
