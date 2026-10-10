// HttpProvider：对接纯静态 HTTP 服务器（python -m http.server / nginx autoindex 等）。
// 资源目录结构与网盘一致，仅用普通 GET 读取；列目录由 Rust 侧解析 HTML 列表页完成。
// 纯静态服务器无需账号密码。
// 详见 docs/CLOUD_DRIVE.md
import { tauri } from "../../shared/tauri";
import type { RemoteEntry, StorageProvider } from "../types";

export class HttpProvider implements StorageProvider {
  readonly kind = "http" as const;
  readonly key: string;
  private readonly base: string;

  constructor(base: string) {
    this.base = base.replace(/\/+$/, "");
    this.key = `http:${this.base}`;
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const entries = await tauri.httpList(this.base, path);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDir: e.is_dir,
      size: e.size,
      modified: e.modified,
    }));
  }

  readText(path: string): Promise<string> {
    return tauri.httpReadText(this.base, path);
  }

  downloadTo(path: string, dest: string): Promise<number> {
    return tauri.httpDownload(this.base, path, dest);
  }
}
