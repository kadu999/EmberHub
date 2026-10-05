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

function broadcastDownload(dest, downloaded, total) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("download-progress", { path: dest, downloaded, total });
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

  // 把渲染进程 console 转发到主进程，便于排查
  win.webContents.on("console-message", (...args) => {
    const d = args[0];
    const msg = d && typeof d === "object" && "message" in d ? d.message : args[2];
    console.log("[renderer]", msg);
  });

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

        // 下载到本地文件 + 进度事件 + 自定义协议读取（等价封面链路）
        const smokeDest = path.join(app.getPath("userData"), "downloads", "smoke-manifest.json");
        await win.webContents.executeJavaScript(
          `window.__prog = 0; window.emberhub.dav.onDownloadProgress((p) => { window.__prog = Math.max(window.__prog, p.downloaded); }); true`,
        );
        const written = await win.webContents.executeJavaScript(
          `window.emberhub.dav.download(${JSON.stringify(auth)}, "manifest.json", ${JSON.stringify(smokeDest)})`,
        );
        const prog = await win.webContents.executeJavaScript(`window.__prog`);
        console.log("[smoke] dav download bytes:", written, "| progress peak:", prog);

        // 断点续传：造一个 100 字节 .part，删掉 dest，再下载应从断点续传
        const partFile = smokeDest + ".part";
        fs.writeFileSync(partFile, Buffer.from(manifest).subarray(0, 100));
        fs.rmSync(smokeDest, { force: true });
        const resumed = await win.webContents.executeJavaScript(
          `window.emberhub.dav.download(${JSON.stringify(auth)}, "manifest.json", ${JSON.stringify(smokeDest)})`,
        );
        const finalSize = fs.statSync(smokeDest).size;
        console.log("[smoke] resume bytes:", resumed, "| final size:", finalSize);
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
          const c = spawn(
            require("7zip-bin").path7za.replace("app.asar", "app.asar.unpacked"),
            ["a", "-tzip", zipPath, srcTxt],
            { windowsHide: true },
          );
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

        // 完整准备链路（可选，下载量较大）：确保模拟器 + 确保 ROM
        if (process.env.EMBERHUB_PREPARE) {
          const platform = process.env.EMBERHUB_PREPARE;
          const diag = await win.webContents.executeJavaScript(
            `JSON.stringify({ has: !!window.__emberhub2, h1: document.querySelector("h1") ? document.querySelector("h1").textContent : null, cards: document.querySelectorAll(".game-card").length, keys: Object.keys(window).filter((k) => k.startsWith("__")), rootLen: (document.getElementById("root") || {}).innerHTML ? document.getElementById("root").innerHTML.length : -1, scripts: [...document.scripts].map((s) => s.getAttribute("src")), jsRes: performance.getEntriesByType("resource").map((r) => r.name).filter((n) => n.includes(".js")) })`,
          );
          console.log("[smoke] prepare diag:", diag);
          const hasHook = JSON.parse(diag).has;
          if (hasHook) {
            console.log(`[smoke] prepare ${platform}: 下载模拟器 + ROM …`);
            const t0 = Date.now();
            const result = await win.webContents.executeJavaScript(
              `window.__emberhub2.prepare(${JSON.stringify(platform)})`,
            );
            console.log("[smoke] prepare result:", JSON.stringify(result));
            console.log("[smoke] prepare took", ((Date.now() - t0) / 1000).toFixed(1), "s");
          }
        }

        // 列出游戏库（可选）：驱动真实 UI 连接 → 打印平台与游戏
        if (process.env.EMBERHUB_LIST) {
          const t0 = Date.now();
          await win.webContents.executeJavaScript(`window.__emberhub2.connect()`);
          await new Promise((r) => setTimeout(r, 1500));
          const ui = await win.webContents.executeJavaScript(
            `JSON.stringify({ title: document.querySelector(".detail-title") ? document.querySelector(".detail-title").textContent : null, cards: document.querySelectorAll(".game-card").length, chips: document.querySelectorAll(".chip").length })`,
          );
          console.log("[list] ui:", ui);
          const lib = await win.webContents.executeJavaScript(`window.__emberhub2.list()`);
          console.log("[list] platforms:", lib.collections.join(", "));
          const byC = {};
          for (const g of lib.games) (byC[g.c] || (byC[g.c] = [])).push(g);
          for (const c of lib.collections) {
            const arr = byC[c] || [];
            console.log(`[list] === ${c}（${arr.length}）===`);
            for (const g of arr.slice(0, 15)) console.log(`[list]   ${g.a === false ? "×" : "·"} ${g.t}`);
            if (arr.length > 15) console.log(`[list]   … 其余 ${arr.length - 15} 个`);
          }
          if (lib.warnings && lib.warnings.length) {
            console.log("[list] warnings:", lib.warnings.slice(0, 5).join(" | "));
          }
          console.log("[list] took", ((Date.now() - t0) / 1000).toFixed(1), "s");
        }

        // 真正启动模拟器跑一把（可选）：起进程 → 等 6s → 确认存活 → 杀掉
        if (process.env.EMBERHUB_LAUNCH) {
          const platform = process.env.EMBERHUB_LAUNCH;
          const r = await win.webContents.executeJavaScript(
            `window.__emberhub2.play(${JSON.stringify(platform)})`,
          );
          console.log("[smoke] play result:", JSON.stringify(r));
          const pid = r && r.pid;
          if (pid) {
            await new Promise((res) => setTimeout(res, 6000));
            let alive = true;
            try {
              process.kill(pid, 0);
            } catch {
              alive = false;
            }
            console.log("[smoke] emulator alive after 6s:", alive);
            try {
              process.kill(pid);
            } catch {
              /* ignore */
            }
          }
        }
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
registerDav(ipcMain, broadcastDownload);

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
  // 便携模式：打包后数据放在 exe 同级的 downloads/（解压即用）；开发时放用户数据目录。
  const base = app.isPackaged ? path.dirname(app.getPath("exe")) : app.getPath("userData");
  const downloadDir = path.join(base, "downloads");
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
