// Tauri 命令的前端封装。所有系统操作都从这里走。
// 详见 docs/ARCHITECTURE.md 第 4 节

import { invoke } from "@tauri-apps/api/core";

export interface LocalEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface AppInfo {
  name: string;
  version: string;
  tagline: string;
}

export const tauri = {
  /** 读取应用信息 */
  appInfo: () => invoke<AppInfo>("app_info"),

  /** 列出本地目录 */
  listLocalDir: (path: string) => invoke<LocalEntry[]>("list_local_dir", { path }),

  /** 启动外部模拟器，返回进程 PID */
  launchEmulator: (exePath: string, args: string[] = []) =>
    invoke<number>("launch_emulator", { exePath, args }),
};
