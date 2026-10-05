// 确保资源就位（当前阶段：下载目录 + 媒体缓存；ROM/模拟器下载后续补）。
import { native } from "../shared/native";
import { joinPath } from "../shared/path";
import type { SourceConfig, StorageProvider } from "../storage/types";

/** 默认下载目录只解析一次（壳侧也会缓存，这里避免重复取）。 */
let defaultDirPromise: Promise<string> | null = null;
function defaultDownloadDir(): Promise<string> {
  if (!defaultDirPromise) {
    defaultDirPromise = native.fs.defaultDownloadDir().catch((e) => {
      defaultDirPromise = null;
      throw e;
    });
  }
  return defaultDirPromise;
}

/** 下载目录：存储源设置优先，其次壳的默认目录。 */
export async function getDownloadDir(source?: SourceConfig): Promise<string> {
  if (source?.downloadDir && source.downloadDir.trim() !== "") {
    return source.downloadDir.trim();
  }
  return defaultDownloadDir();
}

/** 资源源的短标识（隔离各源的媒体缓存，避免切换资源源时串源）。 */
function sourceSlug(provider: StorageProvider): string {
  let h = 5381;
  for (let i = 0; i < provider.key.length; i++) {
    h = ((h << 5) + h + provider.key.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/** 媒体缓存根目录（所有资源源共用这一层，下面按源标识分目录）。 */
export async function mediaCacheRoot(): Promise<string> {
  return joinPath(await getDownloadDir(), ".cache", "media");
}

/** 在途下载去重：同一目标只下载一次 */
const inFlight = new Map<string, Promise<string>>();

/** 确保媒体文件（封面/视频）在本地；返回本地绝对路径。 */
export async function ensureLocalMedia(
  provider: StorageProvider,
  relPath: string,
): Promise<string> {
  if (!provider.downloadTo) throw new Error("该存储源不支持下载。");

  const dl = await getDownloadDir();
  // 媒体缓存：<下载目录>/.cache/media/<源标识>/<镜像路径>
  const dest = joinPath(dl, ".cache", "media", sourceSlug(provider), relPath);
  if (await native.fs.fileExists(dest)) return dest;

  const running = inFlight.get(dest);
  if (running) return running;

  const task = provider
    .downloadTo(relPath, dest)
    .then(() => dest)
    .finally(() => {
      inFlight.delete(dest);
    });
  inFlight.set(dest, task);
  return task;
}
