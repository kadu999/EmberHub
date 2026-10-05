// WebDavProvider：对接 OpenList / NAS / Nextcloud。
// 通过各壳的原生能力发送 PROPFIND / GET（Electron 主进程 net；Android 走 CapacitorHttp），绕过浏览器 CORS。
import { native, type DavAuth } from "../../shared/native";
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
    const entries = await native.dav.list(this.auth, path);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDir: e.is_dir,
      size: e.size,
      modified: e.modified,
    }));
  }

  readText(path: string): Promise<string> {
    return native.dav.readText(this.auth, path);
  }

  downloadTo(path: string, dest: string): Promise<number> {
    return native.dav.download(this.auth, path, dest);
  }
}
