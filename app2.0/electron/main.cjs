// Electron 主进程（Windows 壳）。
// 只做壳该做的事：建窗口、加载前端、暴露窗口/文件/网盘能力给渲染进程。
// 业务逻辑都在前端（src/domain 等），这里不掺和。
const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { registerFs, setDefaultDownloadDir } = require("./fs.cjs");
const { registerDav } = require("./dav.cjs");

// 本地媒体（封面/视频）用一个自定义协议暴露给渲染进程（等价 1.0 的 asset protocol）。
// 必须在 app ready 之前声明 scheme 特权。
protocol.registerSchemesAsPrivileged([
  {
    scheme: "emberhub-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

const MEDIA_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};


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

        // 下载到本地文件 + 自定义协议读取（等价封面链路）
        const smokeDest = path.join(app.getPath("userData"), "downloads", "smoke-manifest.json");
        const written = await win.webContents.executeJavaScript(
          `window.emberhub.dav.download(${JSON.stringify(auth)}, "manifest.json", ${JSON.stringify(smokeDest)})`,
        );
        console.log("[smoke] dav download bytes:", written);
        const served = await win.webContents.executeJavaScript(
          `fetch("emberhub-media://local/" + encodeURIComponent(${JSON.stringify(smokeDest)})).then((r) => r.arrayBuffer()).then((b) => b.byteLength).catch(() => -1)`,
        );
        console.log("[smoke] media protocol fetch bytes:", served);

        // 1x1 PNG 经自定义协议用 <img> 加载（等价封面链路）
        const pngB64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        const pngPath = path.join(app.getPath("userData"), "downloads", "smoke.png");
        fs.writeFileSync(pngPath, Buffer.from(pngB64, "base64"));
        const imgWidth = await win.webContents.executeJavaScript(
          `new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img.naturalWidth); img.onerror = () => resolve(-1); img.src = "emberhub-media://local/" + encodeURIComponent(${JSON.stringify(pngPath)}); })`,
        );
        console.log("[smoke] media image width:", imgWidth);

        // 解压链路：7za 造包 → fs.extractArchive
        const dlDir = path.join(app.getPath("userData"), "downloads");
        const srcTxt = path.join(dlDir, "smoke-src.txt");
        fs.writeFileSync(srcTxt, "hello emberhub");
        const zipPath = path.join(dlDir, "smoke.zip");
        await new Promise((resolve, reject) => {
          const c = spawn(require("7zip-bin").path7za, ["a", "-tzip", zipPath, srcTxt], {
            windowsHide: true,
          });
          c.on("error", reject);
          c.on("close", (code) => (code === 0 ? resolve() : reject(new Error("zip create " + code))));
        });
        const outDir = path.join(dlDir, "smoke-out");
        await win.webContents.executeJavaScript(
          `window.emberhub.fs.removePath(${JSON.stringify(outDir)})`,
        );
        await win.webContents.executeJavaScript(
          `window.emberhub.fs.extractArchive(${JSON.stringify(zipPath)}, ${JSON.stringify(outDir)})`,
        );
        const extracted = await win.webContents.executeJavaScript(
          `window.emberhub.fs.listLocalFiles(${JSON.stringify(outDir)})`,
        );
        console.log("[smoke] extract files:", extracted.join(", "));

        // 启动进程链路
        const pid = await win.webContents.executeJavaScript(
          `window.emberhub.proc.launch(${JSON.stringify(process.env.ComSpec || "cmd.exe")}, ["/c", "exit"], undefined)`,
        );
        console.log("[smoke] proc pid:", pid);
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

// —— 应用信息 / 文件 / WebDAV / 进程 ——
ipcMain.handle("app:host-os", () => hostOs());
registerFs(ipcMain);
registerDav(ipcMain);

// 启动外部进程（模拟器），分离运行，返回 PID。
ipcMain.handle("proc:launch", (_e, { exe, args, workdir }) => {
  const child = spawn(exe, args || [], {
    cwd: workdir || undefined,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid ?? 0;
});

app.whenReady().then(() => {
  const downloadDir = path.join(app.getPath("userData"), "downloads");
  fs.mkdirSync(downloadDir, { recursive: true });
  setDefaultDownloadDir(downloadDir);

  // emberhub-media://local/<url-encoded 绝对路径> → 本地文件
  protocol.handle("emberhub-media", async (request) => {
    try {
      const u = new URL(request.url);
      const abs = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
      const data = await fs.promises.readFile(abs);
      const ext = (abs.split(".").pop() || "").toLowerCase();
      return new Response(data, {
        headers: {
          "Content-Type": MEDIA_MIME[ext] || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
