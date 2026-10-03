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

export interface FtpEntry {
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

export interface DavAuth {
  root: string;
  username: string;
  password: string;
}

export interface FtpAuth {
  host: string;
  port: number;
  username: string;
  password: string;
  base: string;
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

  // ---- FTP ----
  ftpList: (auth: FtpAuth, path: string) => invoke<FtpEntry[]>("ftp_list", { ...auth, path }),
  ftpReadText: (auth: FtpAuth, path: string) => invoke<string>("ftp_read_text", { ...auth, path }),
  ftpReadBase64: (auth: FtpAuth, path: string) =>
    invoke<string>("ftp_read_base64", { ...auth, path }),
  ftpDownload: (auth: FtpAuth, path: string, dest: string) =>
    invoke<number>("ftp_download", { ...auth, path, dest }),

  // ---- 下载 / 解压 / 本地文件 ----
  webdavDownload: (auth: DavAuth, path: string, dest: string) =>
    invoke<number>("webdav_download", { ...auth, path, dest }),
  defaultDownloadDir: () => invoke<string>("default_download_dir"),
  pathExists: (path: string) => invoke<boolean>("path_exists", { path }),
  fileExists: (path: string) => invoke<boolean>("file_exists", { path }),
  ensureDir: (path: string) => invoke<void>("ensure_dir", { path }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  writeTextFile: (path: string, content: string) =>
    invoke<void>("write_text_file", { path, content }),
  removePath: (path: string) => invoke<void>("remove_path", { path }),
  extractZip: (zipPath: string, destDir: string) =>
    invoke<void>("extract_zip", { zipPath, destDir }),

  /** 启动外部模拟器，返回进程 PID */
  launchEmulator: (exePath: string, args: string[] = [], workdir?: string) =>
    invoke<number>("launch_emulator", { exePath, args, workdir }),
};
