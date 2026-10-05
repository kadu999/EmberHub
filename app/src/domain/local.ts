// 本地已下载状态：扫描下载目录下的 Roms，得到「已完成下载」的游戏 id 集合。
// 游戏 id 与 scan.ts 一致，为相对资源源根的 posix 路径，如 `Roms/GBA/xxx.gba`。
import { tauri } from "../shared/tauri";
import { joinPath } from "../shared/path";
import type { SourceConfig } from "../storage/types";
import { getDownloadDir } from "./ensure";

/**
 * 列出本地已下载的游戏 id 集合。
 * 下载目录不存在 / 读取失败时返回空集合（视为都没下载）。
 */
export async function listDownloadedGames(
  source: SourceConfig,
  romsRoot: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const root = joinPath(await getDownloadDir(source), romsRoot);
    const files = await tauri.listLocalFiles(root);
    for (const rel of files) set.add(joinPath(romsRoot, rel));
  } catch {
    // 忽略：目录不存在或不可读
  }
  return set;
}
