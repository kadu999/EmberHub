// Electron 主进程：本地文件系统（Node fs）。
const fs = require("node:fs");
const fsp = fs.promises;
const nodePath = require("node:path");
const { spawn } = require("node:child_process");

// 默认下载目录（由 main 设置，通常为 userData/downloads）
let defaultDownloadDir = "";
function setDefaultDownloadDir(dir) {
  defaultDownloadDir = dir;
}

function registerFs(ipcMain) {
  ipcMain.handle("fs:default-download-dir", () => defaultDownloadDir);

  ipcMain.handle("fs:list-local-dir", async (_e, p) => {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.map((e) => {
      const full = nodePath.join(p, e.name);
      let size = 0;
      try {
        if (e.isFile()) size = fs.statSync(full).size;
      } catch {
        /* ignore */
      }
      return { name: e.name, path: full, is_dir: e.isDirectory(), size };
    });
  });

  ipcMain.handle("fs:list-local-files", async (_e, root) => {
    const base = nodePath.resolve(root);
    if (!fs.existsSync(base)) return [];
    const out = [];
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = nodePath.join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else out.push(nodePath.relative(base, full).split(nodePath.sep).join("/"));
      }
    }
    return out;
  });

  ipcMain.handle("fs:path-exists", (_e, p) => fs.existsSync(p));

  ipcMain.handle("fs:file-exists", (_e, p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });

  ipcMain.handle("fs:ensure-dir", async (_e, p) => {
    await fsp.mkdir(p, { recursive: true });
  });

  ipcMain.handle("fs:read-text-file", (_e, p) => fsp.readFile(p, "utf8"));

  ipcMain.handle("fs:write-text-file", async (_e, { path: p, content }) => {
    await fsp.mkdir(nodePath.dirname(p), { recursive: true });
    await fsp.writeFile(p, content, "utf8");
  });

  ipcMain.handle("fs:remove-path", async (_e, p) => {
    await fsp.rm(p, { recursive: true, force: true });
  });

  ipcMain.handle("fs:path-size", async (_e, p) => {
    const stat = await fsp.stat(p).catch(() => null);
    if (!stat) return 0;
    if (stat.isFile()) return stat.size;
    let total = 0;
    const stack = [p];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = nodePath.join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else {
          try {
            total += (await fsp.stat(full)).size;
          } catch {
            /* ignore */
          }
        }
      }
    }
    return total;
  });

  ipcMain.handle("fs:extract-archive", async (_e, { path: archive, destDir }) => {
    await fsp.mkdir(destDir, { recursive: true });
    const path7za = require("7zip-bin").path7za;
    await new Promise((resolve, reject) => {
      const child = spawn(path7za, ["x", archive, "-o" + destDir, "-y", "-bso0", "-bsp0"], {
        windowsHide: true,
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`解压失败（7za 退出码 ${code}）：${archive}`)),
      );
    });
  });
}

module.exports = { registerFs, setDefaultDownloadDir };
