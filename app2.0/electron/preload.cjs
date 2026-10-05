// Electron preload：把壳能力以 contextBridge 暴露给渲染进程（window.emberhub）。
// 渲染进程不 import electron，所以同一份前端 bundle 也能跑在 Capacitor/浏览器上。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("emberhub", {
  runtime: "electron",

  hostOs: () => ipcRenderer.invoke("app:host-os"),

  window: {
    setFullscreen: (next) => ipcRenderer.invoke("window:set-fullscreen", next),
    isFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
    onFullscreenChange: (cb) => {
      const listener = (_e, value) => cb(value);
      ipcRenderer.on("window:fullscreen", listener);
      return () => ipcRenderer.removeListener("window:fullscreen", listener);
    },
  },

  dav: {
    list: (auth, path) => ipcRenderer.invoke("dav:list", { ...auth, path }),
    readText: (auth, path) => ipcRenderer.invoke("dav:readText", { ...auth, path }),
    download: (auth, path, dest) => ipcRenderer.invoke("dav:download", { ...auth, path, dest }),
    onDownloadProgress: (cb) => {
      const listener = (_e, p) => cb(p);
      ipcRenderer.on("download-progress", listener);
      return () => ipcRenderer.removeListener("download-progress", listener);
    },
  },

  fs: {
    defaultDownloadDir: () => ipcRenderer.invoke("fs:default-download-dir"),
    listLocalDir: (path) => ipcRenderer.invoke("fs:list-local-dir", path),
    listLocalFiles: (path) => ipcRenderer.invoke("fs:list-local-files", path),
    pathExists: (path) => ipcRenderer.invoke("fs:path-exists", path),
    fileExists: (path) => ipcRenderer.invoke("fs:file-exists", path),
    ensureDir: (path) => ipcRenderer.invoke("fs:ensure-dir", path),
    readTextFile: (path) => ipcRenderer.invoke("fs:read-text-file", path),
    writeTextFile: (path, content) => ipcRenderer.invoke("fs:write-text-file", { path, content }),
    removePath: (path) => ipcRenderer.invoke("fs:remove-path", path),
    pathSize: (path) => ipcRenderer.invoke("fs:path-size", path),
    extractArchive: (path, destDir) => ipcRenderer.invoke("fs:extract-archive", { path, destDir }),
  },

  proc: {
    launch: (exe, args, workdir) => ipcRenderer.invoke("proc:launch", { exe, args, workdir }),
  },
});
