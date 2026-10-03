// LocalProvider：本地文件夹。0 依赖，最先实现（M1）。
// 详见 docs/ARCHITECTURE.md 第 5.3 节

import { tauri } from "../../lib/tauri";
import type { DownloadTicket, RemoteEntry, StorageProvider } from "../types";

export class LocalStorageProvider implements StorageProvider {
  readonly id = "local";
  readonly displayName = "本地文件夹";
  readonly needsAuth = false;

  isAuthenticated(): boolean {
    return true;
  }

  async authenticate(): Promise<void> {
    // 本地无需授权
  }

  async logout(): Promise<void> {
    // 本地无需登出
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const entries = await tauri.listLocalDir(path);
    return entries.map((e) => ({
      id: e.path,
      name: e.name,
      size: e.size,
      isDir: e.is_dir,
    }));
  }

  async getDownloadUrl(fileId: string): Promise<DownloadTicket> {
    // 本地文件本就在磁盘上，直接返回 file:// 语义的直链
    return {
      url: fileId,
      headers: {},
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }
}
