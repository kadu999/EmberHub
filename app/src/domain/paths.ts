// 本地数据目录结构（唯一出处，改布局只改这里）。
//
//   <下载目录>/Roms/        已下载游戏（用户数据）
//   <下载目录>/Emulators/   已安装模拟器 + 已装补丁（用户数据）
//   <下载目录>/cache/       可整块删除的缓存（删了自动重建）
//     ├─ library/<源>/      清单：manifest / games / lists / configs
//     ├─ media/<源>/        封面 / 视频
//     ├─ mods/<平台>/       补丁包（zip / cia）
//     ├─ emulators/<平台>/  模拟器压缩包
//     └─ logs/              运行日志
import { joinPath } from "../shared/path";

/** 资源源可读短标识：host_port[_path]（如 192.168.1.147_5245）。 */
export function sourceSlug(key: string): string {
  const i = key.indexOf(":");
  const url = i >= 0 ? key.slice(i + 1) : key;
  const m = /^[a-z]+:\/\/([^/]+)(\/.*)?$/i.exec(url);
  const raw = m ? m[1] + (m[2] ?? "") : url;
  const s = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "default";
}

/** 用户数据：已下载游戏 */
export const romsRoot = (dl: string) => joinPath(dl, "Roms");
/** 用户数据：已安装模拟器（含已装补丁） */
export const emulatorsRoot = (dl: string) => joinPath(dl, "Emulators");

/** 缓存根：可整块删除 */
export const cacheRoot = (dl: string) => joinPath(dl, "cache");
export const libraryRoot = (dl: string) => joinPath(cacheRoot(dl), "library");
export const mediaRoot = (dl: string) => joinPath(cacheRoot(dl), "media");
export const modsCacheDir = (dl: string, platform: string) =>
  joinPath(cacheRoot(dl), "mods", platform);
export const emulatorZipsDir = (dl: string, platform: string) =>
  joinPath(cacheRoot(dl), "emulators", platform);
export const logsRoot = (dl: string) => joinPath(cacheRoot(dl), "logs");
