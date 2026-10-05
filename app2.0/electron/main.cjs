// Electron 主进程（Windows 壳）。
// 只做壳该做的事：建窗口、加载前端、暴露窗口/文件/网盘能力给渲染进程。
// 业务逻辑都在前端（src/domain 等），这里不掺和。
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { registerFs, setDefaultDownloadDir } = require("./fs.cjs");
const { registerDav } = require("./dav.cjs");

// 开发时指向 Vite dev server；否则加载构建产物 dist/
const devUrl = process.env.EMBERHUB_DEV_URL || "";
// 冒烟测试用：加载完成后自动跑一遍链路并退出
const isSmoke = process.env.EMBERHUB_SMOKE === "1";

let win = null;

function hostOs() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return "linux";
  }
}

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

  if (isSmoke) runSmoke();
  return win;
}

/** 冒烟测试：验证 preload 桥、全屏 IPC、WebDAV（若提供 EMBERHUB_DAV_ROOT）。 */
async function runSmoke() {
  win.webContents.once("did-finish-load", async () => {
    console.log("[smoke] window loaded");
    try {
      const hasBridge = await win.webContents.executeJavaScript(
        "!!(window.emberhub && window.emberhub.dav && window.emberhub.fs)",
      );
      console.log("[smoke] bridge present:", hasBridge);

      await win.webContents.executeJavaScript("window.emberhub.window.setFullscreen(true)");
      await new Promise((r) => setTimeout(r, 600));
      console.log("[smoke] fullscreen ->", win.isFullScreen());
      await win.webContents.executeJavaScript("window.emberhub.window.setFullscreen(false)");
      await new Promise((r) => setTimeout(r, 600));
      console.log("[smoke] fullscreen ->", win.isFullScreen());

      const root = process.env.EMBERHUB_DAV_ROOT;
      if (root) {
        const auth = {
          root,
          username: process.env.EMBERHUB_DAV_USER || "",
          password: process.env.EMBERHUB_DAV_PASS || "",
        };
        const entries = await win.webContents.executeJavaScript(
          `window.emberhub.dav.list(${JSON.stringify(auth)}, "")`,
        );
        console.log("[smoke] dav root entries:", entries.length);
        console.log(
          "[smoke] dav names:",
          entries
            .slice(0, 6)
            .map((e) => e.name + (e.is_dir ? "/" : ""))
            .join(", "),
        );

        const manifest = await win.webContents.executeJavaScript(
          `window.emberhub.dav.readText(${JSON.stringify(auth)}, "manifest.json")`,
        );
        const parsed = JSON.parse(manifest);
        console.log("[smoke] manifest platforms:", (parsed.platforms || []).join(", "));

        const gamesJson = await win.webContents.executeJavaScript(
          `window.emberhub.dav.readText(${JSON.stringify(auth)}, "Roms/GBA/games.json")`,
        );
        const gj = JSON.parse(gamesJson);
        console.log(
          "[smoke] Roms/GBA games:",
          (gj.games || []).length,
          "| first:",
          gj.games && gj.games[0] ? gj.games[0].title : "-",
        );
      }
    } catch (e) {
      console.error("[smoke] error:", e && e.message ? e.message : e);
    }
    app.quit();
  });
}

// —— 窗口 / 全屏 IPC ——
ipcMain.handle("window:set-fullscreen", (_e, next) => {
  if (!win || win.isDestroyed()) return false;
  const target = typeof next === "boolean" ? next : !win.isFullScreen();
  win.setFullScreen(target);
  return win.isFullScreen();
});
ipcMain.handle("window:is-fullscreen", () =>
  win && !win.isDestroyed() ? win.isFullScreen() : false,
);

// —— 应用信息 / 文件 / WebDAV ——
ipcMain.handle("app:host-os", () => hostOs());
registerFs(ipcMain);
registerDav(ipcMain);

app.whenReady().then(() => {
  const downloadDir = path.join(app.getPath("userData"), "downloads");
  fs.mkdirSync(downloadDir, { recursive: true });
  setDefaultDownloadDir(downloadDir);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
