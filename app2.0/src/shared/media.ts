// 媒体文件名识别（封面 / 视频）。
// 关键字与扩展名来自 manifest.json（见 resource-config.ts），不写死。
import { getActiveResourceConfig } from "../domain/resource-config";
import { extname } from "./path";

/** 从目录文件名列表中挑一个封面 */
export function pickCoverName(names: string[]): string | undefined {
  const { imageExts, coverNames } = getActiveResourceConfig().media;
  const exts = new Set(imageExts);
  const imgs = names.filter((n) => exts.has(extname(n)));
  if (imgs.length === 0) return undefined;

  const priority = coverNames.map((s) => s.toLowerCase());
  const score = (n: string): number => {
    const l = n.toLowerCase();
    const i = priority.findIndex((p) => l.includes(p));
    return i < 0 ? priority.length : i;
  };
  return [...imgs].sort((a, b) => score(a) - score(b))[0];
}

/** 从目录文件名列表中挑一个视频 */
export function pickVideoName(names: string[]): string | undefined {
  const { videoExts, videoNames } = getActiveResourceConfig().media;
  const exts = new Set(videoExts);
  const vids = names.filter((n) => exts.has(extname(n)));
  if (vids.length === 0) return undefined;

  const priority = videoNames.map((s) => s.toLowerCase());
  if (priority.length === 0) return vids[0];
  const hit = vids.find((n) => {
    const l = n.toLowerCase();
    return priority.some((p) => l.includes(p));
  });
  return hit ?? vids[0];
}
