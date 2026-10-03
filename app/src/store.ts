// 全局状态：存储源与当前选中源（持久化到 localStorage）。
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SourceConfig, StorageKind } from "./storage/types";

/** 当前支持的存储类型；用于过滤历史遗留数据（例如已移除的 FTP）。 */
const VALID_KINDS: StorageKind[] = ["local", "webdav"];

function sanitizeSources(sources: unknown): SourceConfig[] {
  if (!Array.isArray(sources)) return [];
  return sources.filter(
    (s): s is SourceConfig =>
      !!s && typeof s === "object" && VALID_KINDS.includes((s as SourceConfig).kind),
  );
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
