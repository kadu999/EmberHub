// Electron 主进程（Windows 壳）。
// 只做壳该做的事：建窗口、加载前端、暴露窗口/全屏给渲染进程。
// 业务逻辑都在前端（src/domain 等），这里不掺和。
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

// 开发时指向 Vite dev server；否则加载构建产物 dist/
const devUrl = process.env.EMBERHUB_DEV_URL || "";
// 冒烟测试用：加载完成后自动退出（用于 CI/无头验证）
const isSmoke = process.env.EMBERHUB_SMOKE === "1";

let win = null;

function broadcastFullscreen(value) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("window:fullscreen", value);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#14100e",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on("enter-full-screen", () => broadcastFullscreen(true));
  win.on("leave-full-screen", () => broadcastFullscreen(false));

  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  if (isSmoke) {
    win.webContents.once("did-finish-load", async () => {
      console.log("[smoke] window loaded");
      try {
        const hasBridge = await win.webContents.executeJavaScript(
          "!!(window.emberhub && window.emberhub.window)",
        );
        console.log("[smoke] bridge present:", hasBridge);

        await win.webContents.executeJavaScript("window.emberhub.window.setFullscreen(true)");
        await new Promise((r) => setTimeout(r, 800));
        console.log("[smoke] after setFullscreen(true) -> isFullScreen =", win.isFullScreen());

        await win.webContents.executeJavaScript("window.emberhub.window.setFullscreen(false)");
        await new Promise((r) => setTimeout(r, 800));
        console.log("[smoke] after setFullscreen(false) -> isFullScreen =", win.isFullScreen());
      } catch (e) {
        console.error("[smoke] error:", e);
      }
      app.quit();
    });
  }

  return win;
}

// —— 窗口 / 全屏 IPC（对应 1.0 的 getCurrentWindow().setFullscreen）——
ipcMain.handle("window:set-fullscreen", (_e, next) => {
  if (!win || win.isDestroyed()) return false;
  const target = typeof next === "boolean" ? next : !win.isFullScreen();
  win.setFullScreen(target);
  return win.isFullScreen();
});

ipcMain.handle("window:is-fullscreen", () => (win && !win.isDestroyed() ? win.isFullScreen() : false));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
