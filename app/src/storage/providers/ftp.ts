// FtpProvider：自建 FTP 资源服务器（账号密码）。
// 通过 Rust 侧 suppaftp 实现列目录 / 读取 / 下载（支持断点续传）。
import { tauri, type FtpAuth } from "../../lib/tauri";
import type { RemoteEntry, StorageProvider } from "../types";

export class FtpProvider implements StorageProvider {
  readonly kind = "ftp" as const;
  private readonly auth: FtpAuth;

  constructor(host: string, port: number, username: string, password: string, base: string) {
    this.auth = { host, port, username, password, base };
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const entries = await tauri.ftpList(this.auth, path);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDir: e.is_dir,
      size: e.size,
    }));
  }

  readText(path: string): Promise<string> {
    return tauri.ftpReadText(this.auth, path);
  }

  readFileDataUrl(path: string): Promise<string> {
    return tauri.ftpReadBase64(this.auth, path);
  }

  downloadTo(path: string, dest: string): Promise<number> {
    return tauri.ftpDownload(this.auth, path, dest);
  }
}
