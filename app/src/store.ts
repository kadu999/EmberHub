// 全局状态：存储源与当前选中源（持久化到 localStorage）。
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SourceConfig } from "./storage/types";

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
    { name: "emberhub" },
  ),
);
