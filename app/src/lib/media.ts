// 媒体文件名识别（封面 / 视频）
import { extname } from "./path";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "webm", "avi", "mkv"];
const COVER_PRIORITY = [
  "boxfront",
  "box_front",
  "box2dfront",
  "cover",
  "front",
  "tile",
  "banner",
  "logo",
  "screenshot",
  "titlescreen",
];

/** 从目录文件名列表中挑一个封面 */
export function pickCoverName(names: string[]): string | undefined {
  const imgs = names.filter((n) => IMAGE_EXTS.includes(extname(n)));
  if (imgs.length === 0) return undefined;
  const score = (n: string): number => {
    const l = n.toLowerCase();
    for (let i = 0; i < COVER_PRIORITY.length; i++) {
      if (l.includes(COVER_PRIORITY[i])) return i;
    }
    return COVER_PRIORITY.length;
  };
  return [...imgs].sort((a, b) => score(a) - score(b))[0];
}

/** 从目录文件名列表中挑一个视频 */
export function pickVideoName(names: string[]): string | undefined {
  const vids = names.filter((n) => VIDEO_EXTS.includes(extname(n)));
  if (vids.length === 0) return undefined;
  return vids.find((n) => n.toLowerCase().includes("video")) ?? vids[0];
}
