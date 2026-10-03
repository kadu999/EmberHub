// 存储抽象层：统一接口。
// 直连优先，想加哪个 Provider 就实现这个接口即可。
// 详见 docs/ARCHITECTURE.md 第 5 节

/** 远端文件/目录条目 */
export interface RemoteEntry {
  /** 远端唯一 ID（网盘 file_id，本地为绝对路径） */
  id: string;
  name: string;
  size: number;
  isDir: boolean;
  modified?: Date;
  /** 若存储能提供缩略图/封面 */
  coverUrl?: string;
}

/** 下载凭证（含直链时效与必要请求头） */
export interface DownloadTicket {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StorageProvider {
  /** 唯一标识，如 'local' | 'aliyundrive' */
  readonly id: string;
  readonly displayName: string;
  /** 是否需要授权（网盘为 true，本地为 false） */
  readonly needsAuth: boolean;

  isAuthenticated(): boolean;
  authenticate(): Promise<void>;
  logout(): Promise<void>;

  /** 列出某路径下的条目 */
  list(path: string): Promise<RemoteEntry[]>;

  /** 获取文件下载直链 */
  getDownloadUrl(fileId: string): Promise<DownloadTicket>;

  /** 上传（可选能力） */
  upload?(
    localPath: string,
    remotePath: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
}
