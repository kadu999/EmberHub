// Tauri 命令的前端封装。所有系统操作都从这里走。
// 详见 docs/ARCHITECTURE.md 第 4 节

import { invoke } from "@tauri-apps/api/core";

export interface LocalEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface DavEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string | null;
}

export interface AppInfo {
  name: string;
  version: string;
  tagline: string;
}

export interface DavAuth {
  root: string;
  username: string;
  password: string;
}

export const tauri = {
  /** 读取应用信息 */
  appInfo: () => invoke<AppInfo>("app_info"),

  // ---- 本地文件系统 ----
  listLocalDir: (path: string) => invoke<LocalEntry[]>("list_local_dir", { path }),
  readLocalText: (path: string) => invoke<string>("read_local_text", { path }),
  readLocalBase64: (path: string) => invoke<string>("read_local_base64", { path }),

  // ---- WebDAV ----
  webdavList: (auth: DavAuth, path: string) =>
    invoke<DavEntry[]>("webdav_list", { ...auth, path }),
  webdavReadText: (auth: DavAuth, path: string) =>
    invoke<string>("webdav_read_text", { ...auth, path }),
  webdavReadBase64: (auth: DavAuth, path: string) =>
    invoke<string>("webdav_read_base64", { ...auth, path }),

  /** 启动外部模拟器，返回进程 PID */
  launchEmulator: (exePath: string, args: string[] = []) =>
    invoke<number>("launch_emulator", { exePath, args }),
};
