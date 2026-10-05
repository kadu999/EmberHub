// Electron preload 注入到 window.emberhub 的桥类型声明。
import type { DavAuth, DavEntry, LocalEntry } from "./shared/dto";

export {};

declare global {
  interface EmberHubWindowBridge {
    setFullscreen(next?: boolean): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
    onFullscreenChange(cb: (full: boolean) => void): () => void;
  }

  interface EmberHubDavBridge {
    list(auth: DavAuth, path: string): Promise<DavEntry[]>;
    readText(auth: DavAuth, path: string): Promise<string>;
    download(auth: DavAuth, path: string, dest: string): Promise<number>;
    onDownloadProgress(
      cb: (p: { path: string; downloaded: number; total: number | null }) => void,
    ): () => void;
  }

  interface EmberHubFsBridge {
    defaultDownloadDir(): Promise<string>;
    listLocalDir(path: string): Promise<LocalEntry[]>;
    listLocalFiles(path: string): Promise<string[]>;
    pathExists(path: string): Promise<boolean>;
    fileExists(path: string): Promise<boolean>;
    ensureDir(path: string): Promise<void>;
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
    removePath(path: string): Promise<void>;
    pathSize(path: string): Promise<number>;
    extractArchive(path: string, destDir: string): Promise<void>;
  }

  interface EmberHubProcBridge {
    launch(exe: string, args: string[], workdir?: string): Promise<number>;
  }

  interface EmberHubBridge {
    runtime: "electron";
    hostOs(): Promise<string>;
    window: EmberHubWindowBridge;
    dav: EmberHubDavBridge;
    fs: EmberHubFsBridge;
    proc: EmberHubProcBridge;
  }

  interface Window {
    /** 仅 Electron 壳注入；Capacitor/浏览器下为 undefined */
    emberhub?: EmberHubBridge;
  }
}
