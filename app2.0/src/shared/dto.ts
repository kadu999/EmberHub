// 壳与前端之间传输的 DTO（Electron preload / Capacitor 都用这组形状）。
export interface DavEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string | null;
}

export interface LocalEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface DavAuth {
  root: string;
  username: string;
  password: string;
}
