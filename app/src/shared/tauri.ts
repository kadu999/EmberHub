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

export interface DavAuth {
  root: string;
  username: string;
  password: string;
}

export const tauri = {
  /** 当前运行平台（windows / linux / macos / android / ios） */
  hostOs: () => invoke<string>("host_os"),

  // ---- 本地文件系统 ----
  listLocalDir: (path: string) => invoke<LocalEntry[]>("list_local_dir", { path }),
  /** 递归列出目录下所有文件（相对 root 的 posix 路径） */
  listLocalFiles: (path: string) => invoke<string[]>("list_local_files", { path }),

  // ---- WebDAV ----
  webdavList: (auth: DavAuth, path: string) =>
    invoke<DavEntry[]>("webdav_list", { ...auth, path }),
  webdavReadText: (auth: DavAuth, path: string) =>
    invoke<string>("webdav_read_text", { ...auth, path }),

  // ---- 下载 / 解压 / 本地文件 ----
  webdavDownload: (auth: DavAuth, path: string, dest: string) =>
    invoke<number>("webdav_download", { ...auth, path, dest }),
  defaultDownloadDir: () => invoke<string>("default_download_dir"),
  pathSize: (path: string) => invoke<number>("path_size", { path }),
  pathExists: (path: string) => invoke<boolean>("path_exists", { path }),
  fileExists: (path: string) => invoke<boolean>("file_exists", { path }),
  ensureDir: (path: string) => invoke<void>("ensure_dir", { path }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  writeTextFile: (path: string, content: string) =>
    invoke<void>("write_text_file", { path, content }),
  removePath: (path: string) => invoke<void>("remove_path", { path }),
  extractArchive: (path: string, destDir: string) =>
    invoke<void>("extract_archive", { path, destDir }),

  /** 指定失败日志目录（<下载目录>/logs）；下载目录变化时重新调用。 */
  logInit: (dir: string) => invoke<void>("log_init", { dir }),

  /** 启动外部模拟器，返回进程 PID */
  launchEmulator: (exePath: string, args: string[] = [], workdir?: string) =>
    invoke<number>("launch_emulator", { exePath, args, workdir }),

  /** Android：用 Intent + FileProvider 启动目标 App，并把 ROM 以 content:// 传入（path 为空则只打开 App） */
  androidLaunchApp: (
    pkg: string,
    path?: string,
    mime?: string,
    component?: string,
    extras?: Record<string, string>,
  ) =>
    invoke<void>("android_launch_app", { package: pkg, path, mime, component, extras }),

  /** Android：用系统安装器安装本地 APK（会弹安装确认） */
  installApk: (path: string) => invoke<void>("android_install_apk", { path }),

  /** Android：共享存储根下的 EmberHub 目录（如 /sdcard/EmberHub） */
  sharedStorageDir: () => invoke<string>("android_shared_storage_dir"),
  /** Android：是否已获得「所有文件访问（共享存储）」权限 */
  hasAllFilesAccess: () => invoke<boolean>("android_has_all_files_access"),
  /** Android：跳转系统设置请求「所有文件访问（共享存储）」权限 */
  requestAllFilesAccess: () => invoke<void>("android_request_all_files_access"),
};
