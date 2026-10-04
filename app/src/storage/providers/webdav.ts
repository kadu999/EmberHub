// WebDavProvider：对接 OpenList / NAS / Nextcloud。
// 通过 Rust 侧发送 PROPFIND / GET，绕过浏览器 CORS 与自定义方法限制。
import { tauri, type DavAuth } from "../../lib/tauri";
import type { RemoteEntry, StorageProvider } from "../types";

export class WebDavProvider implements StorageProvider {
  readonly kind = "openlist" as const;
  readonly key: string;
  private readonly auth: DavAuth;

  constructor(url: string, username: string, password: string) {
    this.auth = { root: url, username, password };
    this.key = `openlist:${url}`;
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const entries = await tauri.webdavList(this.auth, path);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDir: e.is_dir,
      size: e.size,
      modified: e.modified,
    }));
  }

  readText(path: string): Promise<string> {
    return tauri.webdavReadText(this.auth, path);
  }

  downloadTo(path: string, dest: string): Promise<number> {
    return tauri.webdavDownload(this.auth, path, dest);
  }
}
