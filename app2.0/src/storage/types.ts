// 存储抽象层：统一接口。
// 直连优先，想加哪个 Provider 就实现这个接口即可。
// 详见 docs/ARCHITECTURE.md 第 5 节

export type StorageKind = "openlist";

/** 用户配置的一个存储源 */
export interface SourceConfig {
  id: string;
  name: string;
  kind: StorageKind;
  /** 游戏库根目录（相对存储源根，默认 Roms） */
  romsPath?: string;
  /** 模拟器目录（相对存储源根，默认 Emulators） */
  emulatorsPath?: string;
  /** 下载目录（默认程序数据目录，可改） */
  downloadDir?: string;
  /** openlist: 服务地址（ip:端口 或完整 http(s) 地址） */
  server?: string;
  /** openlist: 选中的资源源挂载路径，如 /EmberHub_Baidu */
  mountPath?: string;
  username?: string;
  password?: string;
}

/** 由 OpenList 地址 + 资源源挂载路径推导 WebDAV 根地址 */
export function openlistDavUrl(source: SourceConfig): string {
  const server = (source.server ?? "").trim().replace(/\/+$/, "");
  if (!server) return "";
  const withScheme = /^https?:\/\//i.test(server) ? server : `http://${server}`;
  let mount = (source.mountPath ?? "").trim();
  if (mount && !mount.startsWith("/")) mount = "/" + mount;
  return `${withScheme}/dav${mount}`;
}

/** 远端文件/目录条目，`path` 为相对根的 posix 路径 */
export interface RemoteEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified?: string | null;
}

export interface StorageProvider {
  readonly kind: StorageKind;
  /** 稳定标识（kind + 根地址），用于缓存 key */
  readonly key: string;
  /** 列出某路径下的条目（path 为相对根的 posix 路径，"" 表示根） */
  list(path: string): Promise<RemoteEntry[]>;
  /** 读取文本文件 */
  readText(path: string): Promise<string>;
  /** 把远端文件下载到本地 dest（远程源实现；本地源无需） */
  downloadTo?(path: string, dest: string): Promise<number>;
}
