// 启动逻辑：解析 Pegasus 的 launch 命令，替换占位符，调用模拟器。
// EmberHub 只负责「用哪个 ROM 启动哪个模拟器」，不做复杂的模拟器管理。
import { tauri } from "../lib/tauri";
import { basename, dirname, isAbsolute, joinPath, stripExt } from "../lib/path";
import type { StorageProvider } from "../storage/types";
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

/** 替换 Pegasus 支持的启动占位符。 */
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

/** 生成启动计划；无法启动时抛出带说明的错误。 */
export function buildLaunchPlan(game: Game, provider: StorageProvider): LaunchPlan {
  if (!game.launch || game.launch.trim() === "") {
    throw new Error("该游戏/集合没有配置 launch 命令（在 metadata.pegasus.txt 里加 `launch:`）");
  }
  if (!provider.absolute) {
    throw new Error("远程存储源暂不支持直接启动，需要先下载到本地。");
  }
  const romRel = game.files[0];
  if (!romRel) throw new Error("该游戏没有指定 ROM 文件。");

  const romAbs = provider.absolute(romRel);
  if (!romAbs) throw new Error("无法解析 ROM 的本地路径。");

  const baseDirAbs = game._baseDir ? provider.absolute(game._baseDir) : undefined;

  const tokens = splitCommand(substitute(game.launch, romAbs));
  if (tokens.length === 0) throw new Error("launch 命令为空。");

  let exe = tokens[0];
  if (!isAbsolute(exe) && baseDirAbs) {
    exe = joinPath(baseDirAbs, exe);
  }
  const args = tokens.slice(1);

  let workdir: string | undefined;
  if (game.workdir && game.workdir.trim() !== "") {
    const wd = substitute(game.workdir, romAbs);
    workdir = isAbsolute(wd) ? wd : baseDirAbs ? joinPath(baseDirAbs, wd) : undefined;
  } else {
    workdir = dirname(exe);
  }

  return { exe, args, workdir };
}

/** 启动游戏。 */
export async function launchGame(game: Game, provider: StorageProvider): Promise<void> {
  const plan = buildLaunchPlan(game, provider);
  await tauri.launchEmulator(plan.exe, plan.args, plan.workdir);
}
