// 启动 + 按需下载。
// EmberHub 只做两件事：① 按需从存储源下载 ROM；② 用 ROM 路径拉起模拟器。
// 不配置模拟器、不管理模拟器生命周期（不关闭、不重启）。
import { tauri } from "../lib/tauri";
import { basename, dirname, isAbsolute, joinPath, stripExt } from "../lib/path";
import type { SourceConfig, StorageProvider } from "../storage/types";
import type { Game } from "./scan";

/** 按引号规则把命令行切分为 token（去掉引号）。 */
export function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur !== "") {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

function fileUri(abs: string): string {
  let p = abs.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  return "file://" + encodeURI(p).replace(/#/g, "%23");
}

/** 替换启动命令占位符。 */
export function substitute(cmd: string, abs: string): string {
  return cmd
    .replace(/\{file\.path\}/g, abs)
    .replace(/\{file\.uri\}/g, fileUri(abs))
    .replace(/\{file\.name\}/g, basename(abs))
    .replace(/\{file\.basename\}/g, stripExt(basename(abs)))
    .replace(/\{file\.dir\}/g, dirname(abs));
}

export interface LaunchPlan {
  exe: string;
  args: string[];
  workdir?: string;
}

/** 根据 ROM 的本地绝对路径生成启动计划。 */
export function buildLaunchPlan(game: Game, romAbs: string, baseDirAbs?: string): LaunchPlan {
  if (!game.launch || game.launch.trim() === "") {
    throw new Error("该游戏/平台没有配置 launch 命令（在 games.json 里加 `launch`）");
  }

  const tokens = splitCommand(substitute(game.launch, romAbs));
  if (tokens.length === 0) throw new Error("launch 命令为空。");

  let exe = tokens[0];
  if (!isAbsolute(exe) && baseDirAbs) exe = joinPath(baseDirAbs, exe);
  const args = tokens.slice(1);

  return { exe, args, workdir: dirname(exe) };
}

/** 确保 ROM 在本地：本地源直接返回绝对路径；远程源按需下载到缓存。 */
export async function ensureLocalRom(
  game: Game,
  provider: StorageProvider,
  source: SourceConfig,
  onStatus?: (s: string) => void,
): Promise<string> {
  const romRel = game.files[0];
  if (!romRel) throw new Error("该游戏没有指定 ROM 文件。");

  // 本地源：直接用绝对路径
  const local = provider.absolute?.(romRel);
  if (local) return local;

  // 远程源：按需下载到缓存
  if (!provider.downloadTo) throw new Error("该存储源不支持按需下载。");

  const cache = await tauri.cacheDir();
  const dest = joinPath(cache, source.id, romRel);
  if (await tauri.fileExists(dest)) {
    onStatus?.("已命中本地缓存");
    return dest;
  }

  onStatus?.(`下载中… ${basename(romRel)}`);
  await provider.downloadTo(romRel, dest);
  onStatus?.("下载完成");
  return dest;
}

/** 启动游戏：必要时先按需下载，再拉起模拟器。 */
export async function launchGame(
  game: Game,
  provider: StorageProvider,
  source: SourceConfig,
  onStatus?: (s: string) => void,
): Promise<void> {
  const romAbs = await ensureLocalRom(game, provider, source, onStatus);
  const baseDirAbs = game._baseDir ? provider.absolute?.(game._baseDir) : undefined;
  const plan = buildLaunchPlan(game, romAbs, baseDirAbs);
  await tauri.launchEmulator(plan.exe, plan.args, plan.workdir);
}
