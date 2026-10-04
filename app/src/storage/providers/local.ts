// LocalProvider：本地文件夹。0 依赖。
import { tauri } from "../../lib/tauri";
import { joinPath } from "../../lib/path";
import type { RemoteEntry, StorageProvider } from "../types";

export class LocalProvider implements StorageProvider {
  readonly kind = "local" as const;
  readonly key: string;

  constructor(private readonly root: string) {
    this.key = `local:${root}`;
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const abs = path ? joinPath(this.root, path) : this.root;
    const entries = await tauri.listLocalDir(abs);
    return entries.map((e) => ({
      // 统一暴露相对根的路径，保证与 WebDAV 行为一致
      path: path ? joinPath(path, e.name) : e.name,
      name: e.name,
      isDir: e.is_dir,
      size: e.size,
    }));
  }

  readText(path: string): Promise<string> {
    return tauri.readLocalText(joinPath(this.root, path));
  }

  absolute(path: string): string {
    return joinPath(this.root, path);
  }
}
