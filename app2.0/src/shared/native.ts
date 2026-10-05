// 统一原生能力入口（对应 1.0 的 shared/tauri.ts）。
// - Electron：preload 注入的 window.emberhub（走主进程）
// - Capacitor：本地插件（后续接入）
// - Web：兜底（多数能力不可用）
//
// 业务层（domain/、storage/）只依赖这里，不直接碰任何壳的 API。
import type { DavAuth, DavEntry, LocalEntry } from "./dto";

export type { DavAuth, DavEntry, LocalEntry };

const bridge = typeof window !== "undefined" ? window.emberhub : undefined;

function unavailable(what: string): never {
  throw new Error(`当前运行环境未实现「${what}」`);
}

export const native = {
  /** 当前运行平台（windows / linux / macos / android / ios） */
  hostOs: (): Promise<string> => (bridge ? bridge.hostOs() : Promise.resolve("web")),

  // ---- WebDAV ----
  dav: {
    list: (auth: DavAuth, path: string): Promise<DavEntry[]> =>
      bridge ? bridge.dav.list(auth, path) : unavailable("WebDAV"),
    readText: (auth: DavAuth, path: string): Promise<string> =>
      bridge ? bridge.dav.readText(auth, path) : unavailable("WebDAV"),
    download: (auth: DavAuth, path: string, dest: string): Promise<number> =>
      bridge ? bridge.dav.download(auth, path, dest) : unavailable("WebDAV"),
  },

  // ---- 本地文件系统 ----
  fs: {
    defaultDownloadDir: (): Promise<string> =>
      bridge ? bridge.fs.defaultDownloadDir() : unavailable("文件系统"),
    listLocalDir: (path: string): Promise<LocalEntry[]> =>
      bridge ? bridge.fs.listLocalDir(path) : unavailable("文件系统"),
    listLocalFiles: (path: string): Promise<string[]> =>
      bridge ? bridge.fs.listLocalFiles(path) : unavailable("文件系统"),
    pathExists: (path: string): Promise<boolean> =>
      bridge ? bridge.fs.pathExists(path) : unavailable("文件系统"),
    fileExists: (path: string): Promise<boolean> =>
      bridge ? bridge.fs.fileExists(path) : unavailable("文件系统"),
    ensureDir: (path: string): Promise<void> =>
      bridge ? bridge.fs.ensureDir(path) : unavailable("文件系统"),
    readTextFile: (path: string): Promise<string> =>
      bridge ? bridge.fs.readTextFile(path) : unavailable("文件系统"),
    writeTextFile: (path: string, content: string): Promise<void> =>
      bridge ? bridge.fs.writeTextFile(path, content) : unavailable("文件系统"),
    removePath: (path: string): Promise<void> =>
      bridge ? bridge.fs.removePath(path) : unavailable("文件系统"),
    pathSize: (path: string): Promise<number> =>
      bridge ? bridge.fs.pathSize(path) : unavailable("文件系统"),
    extractArchive: (path: string, destDir: string): Promise<void> =>
      bridge ? bridge.fs.extractArchive(path, destDir) : unavailable("解压"),
  },

  // ---- 启动外部进程（桌面） ----
  proc: {
    launch: (exe: string, args: string[], workdir?: string): Promise<number> =>
      bridge ? bridge.proc.launch(exe, args, workdir) : unavailable("启动进程"),
  },

  // ---- 媒体（本地文件 → 可被 <img>/<video> 加载的 URL） ----
  media: {
    url: (path: string): string => {
      if (bridge) return `emberhub-media://local/${encodeURIComponent(path)}`;
      // Capacitor 原生后续用 Capacitor.convertFileSrc；Web 无本地文件
      return path;
    },
  },
};
