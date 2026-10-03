// 全局状态：存储源与当前选中源（持久化到 localStorage）。
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SourceConfig } from "./storage/types";

/** 从旧的 WebDAV 完整地址解析出 server 与挂载路径。 */
function parseDavUrl(url: string): { server: string; mountPath: string } {
  try {
    const u = new URL(url);
    return { server: u.host, mountPath: u.pathname.replace(/^\/dav/, "") };
  } catch {
    return { server: url, mountPath: "" };
  }
}

/** 迁移单个存储源：丢弃已移除的类型（如 FTP），旧的 webdav → openlist。 */
function migrateSource(s: unknown): SourceConfig | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (o.kind === "local" || o.kind === "openlist") return o as unknown as SourceConfig;
  if (o.kind === "webdav") {
    const { server, mountPath } = parseDavUrl(String(o.url ?? ""));
    return { ...o, kind: "openlist", server, mountPath } as SourceConfig;
  }
  return null;
}

function sanitizeSources(sources: unknown): SourceConfig[] {
  if (!Array.isArray(sources)) return [];
  return sources.map(migrateSource).filter((s): s is SourceConfig => s !== null);
}

interface AppStore {
  sources: SourceConfig[];
  activeSourceId: string | null;
  /** 下载目录（空 = 使用程序目录） */
  downloadDir: string;
  /** 扫描信号：自增以请求游戏库重新扫描 */
  scanToken: number;
  addSource: (s: SourceConfig) => void;
  removeSource: (id: string) => void;
  setActiveSource: (id: string | null) => void;
  setDownloadDir: (dir: string) => void;
  requestScan: () => void;
}

export const useStore = create<AppStore>()(
  persist(
    (set) => ({
      sources: [],
      activeSourceId: null,
      downloadDir: "",
      scanToken: 0,
      addSource: (s) =>
        set((st) => ({
          sources: [...st.sources, s],
          activeSourceId: st.activeSourceId ?? s.id,
        })),
      removeSource: (id) =>
        set((st) => ({
          sources: st.sources.filter((x) => x.id !== id),
          activeSourceId: st.activeSourceId === id ? null : st.activeSourceId,
        })),
      setActiveSource: (id) => set({ activeSourceId: id }),
      setDownloadDir: (dir) => set({ downloadDir: dir }),
      requestScan: () => set((st) => ({ scanToken: st.scanToken + 1 })),
    }),
    {
      name: "emberhub",
      // 合并时过滤掉不支持的存储源，避免旧数据（如已移除的 FTP）导致渲染崩溃
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppStore>;
        const sources = sanitizeSources(p.sources);
        const activeSourceId =
          p.activeSourceId && sources.some((s) => s.id === p.activeSourceId)
            ? p.activeSourceId
            : null;
        return { ...current, ...p, sources, activeSourceId };
      },
    },
  ),
);
