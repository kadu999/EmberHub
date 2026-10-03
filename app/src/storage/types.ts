// 存储抽象层：统一接口。
// 直连优先，想加哪个 Provider 就实现这个接口即可。
// 详见 docs/ARCHITECTURE.md 第 5 节

export type StorageKind = "local" | "webdav";

/** 用户配置的一个存储源 */
export interface SourceConfig {
  id: string;
  name: string;
  kind: StorageKind;
  /** 游戏库根目录（相对存储源根，默认 Roms） */
  romsPath?: string;
  /** local: 根目录绝对路径 */
  root?: string;
  /** webdav: 服务地址 */
  url?: string;
  username?: string;
  password?: string;
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
  /** 列出某路径下的条目（path 为相对根的 posix 路径，"" 表示根） */
  list(path: string): Promise<RemoteEntry[]>;
  /** 读取文本文件 */
  readText(path: string): Promise<string>;
  /** 读取文件并返回 data URL（用于图片） */
  readFileDataUrl(path: string): Promise<string>;
}
