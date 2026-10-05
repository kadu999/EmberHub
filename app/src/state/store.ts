// 全局状态：唯一资源源（OpenList/WebDAV）与下载目录（持久化到 localStorage）。
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SourceConfig } from "../storage/types";

/** 从旧的 WebDAV 完整地址解析出 server 与挂载路径。 */
function parseDavUrl(url: string): { server: string; mountPath: string } {
  try {
    const u = new URL(url);
    return { server: u.host, mountPath: u.pathname.replace(/^\/dav/, "") };
  } catch {
    return { server: url, mountPath: "" };
  }
}

/** 迁移单个存储源：丢弃已移除的类型（本地 / FTP），旧的 webdav → openlist。 */
function migrateSource(s: unknown): SourceConfig | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (o.kind === "openlist") return o as unknown as SourceConfig;
  if (o.kind === "webdav") {
    const { server, mountPath } = parseDavUrl(String(o.url ?? ""));
    return { ...o, kind: "openlist", server, mountPath } as SourceConfig;
  }
  return null;
}

interface AppStore {
  /** 唯一资源源（OpenList/WebDAV） */
  source: SourceConfig | null;
  /** 下载目录（空 = 使用程序目录） */
  downloadDir: string;
  /** Android：存储位置（私有目录 / 共享存储） */
  storageMode: StorageMode;
  /** 扫描信号：自增以请求游戏库重新扫描 */
  scanToken: number;
  /** 是否全屏（持久化，启动时应用） */
  fullscreen: boolean;
  /** 上次选中的游戏（file 路径）与所在平台，启动时定位 */
  lastGameId: string;
  lastCollection: string;
  setSource: (s: SourceConfig | null) => void;
  setDownloadDir: (dir: string) => void;
  setStorageMode: (m: StorageMode) => void;
  requestScan: () => void;
  setFullscreen: (v: boolean) => void;
  toggleFullscreen: () => void;
  setLastSelection: (id: string, collection: string) => void;
}

/** Android 存储位置：App 私有目录 / 共享存储（/sdcard/EmberHub） */
export type StorageMode = "private" | "shared";

export const useStore = create<AppStore>()(
  persist(
    (set) => ({
      source: null,
      downloadDir: "",
      storageMode: "private",
      scanToken: 0,
      fullscreen: false,
      lastGameId: "",
      lastCollection: "",
      setSource: (s) => set({ source: s }),
      setDownloadDir: (dir) => set({ downloadDir: dir }),
      setStorageMode: (m) => set({ storageMode: m }),
      requestScan: () => set((st) => ({ scanToken: st.scanToken + 1 })),
      setFullscreen: (v) => set({ fullscreen: v }),
      toggleFullscreen: () => set((st) => ({ fullscreen: !st.fullscreen })),
      setLastSelection: (id, collection) => set({ lastGameId: id, lastCollection: collection }),
    }),
    {
      name: "emberhub",
      // 兼容旧数据：sources[] + activeSourceId → 单个 source
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        let src = migrateSource(p.source);
        if (!src) {
          const arr = Array.isArray(p.sources) ? p.sources : [];
          const active =
            arr.find((s) => (s as { id?: string })?.id === p.activeSourceId) ?? arr[0];
          src = migrateSource(active);
        }
        return {
          ...current,
          source: src,
          downloadDir: typeof p.downloadDir === "string" ? p.downloadDir : current.downloadDir,
          storageMode: p.storageMode === "shared" ? "shared" : "private",
          scanToken: typeof p.scanToken === "number" ? p.scanToken : current.scanToken,
          fullscreen: typeof p.fullscreen === "boolean" ? p.fullscreen : current.fullscreen,
          lastGameId: typeof p.lastGameId === "string" ? p.lastGameId : current.lastGameId,
          lastCollection: typeof p.lastCollection === "string" ? p.lastCollection : current.lastCollection,
        };
      },
    },
  ),
);
