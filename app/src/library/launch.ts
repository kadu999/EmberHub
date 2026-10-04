// 启动 + 按需下载。
// 启动命令来源：Roms 的 launch 优先 → 否则用 Emulators 的 config.json。
// 不配置模拟器、不管理模拟器生命周期（不关闭、不重启）。
import { tauri } from "../lib/tauri";
import { basename, dirname, isAbsolute, joinPath, stripExt } from "../lib/path";
import type { SourceConfig, StorageProvider } from "../storage/types";
import { ensureEmulator, ensureRom } from "./ensure";
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

/** Windows 上部分模拟器（如 PCSX2）不认正斜杠路径，需要转成反斜杠。 */
const IS_WINDOWS = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
function nativePath(p: string): string {
  return IS_WINDOWS ? p.replace(/\//g, "\\") : p;
}

export interface LaunchPlan {
  exe: string;
  args: string[];
  workdir?: string;
}

/** 由一条启动命令生成启动计划。 */
export function buildLaunchPlan(launchCmd: string, romAbs: string, baseDirAbs?: string): LaunchPlan {
  if (!launchCmd || launchCmd.trim() === "") throw new Error("没有配置 launch 命令。");
  const tokens = splitCommand(substitute(launchCmd, romAbs));
  if (tokens.length === 0) throw new Error("launch 命令为空。");

  let exe = tokens[0];
  if (!isAbsolute(exe) && baseDirAbs) exe = joinPath(baseDirAbs, exe);
  return { exe, args: tokens.slice(1), workdir: dirname(exe) };
}

/** 启动游戏：先确保 ROM 在本地，再按 Roms 优先 / Emulators 配置拉起模拟器。 */
export async function launchGame(
  game: Game,
  provider: StorageProvider,
  source: SourceConfig,
  onStatus?: (s: string) => void,
): Promise<void> {
  // 1) Roms 的 launch 优先（自定义命令，默认解压压缩包）
  if (game.launch && game.launch.trim() !== "") {
    const romAbs = nativePath(await ensureRom(provider, source, game, onStatus, true));
    const plan = buildLaunchPlan(game.launch, romAbs);
    onStatus?.("启动中…");
    await tauri.launchEmulator(plan.exe, plan.args, plan.workdir);
    return;
  }

  // 2) 否则用 Emulators/<平台>/config.json；是否解压由 config.extract 决定（默认解压）
  const { dir, config } = await ensureEmulator(provider, source, game.collection, onStatus);
  const romAbs = nativePath(await ensureRom(provider, source, game, onStatus, config.extract !== false));
  const exe = nativePath(isAbsolute(config.exe) ? config.exe : joinPath(dir, config.exe));
  const args = (config.args ?? []).map((a) => substitute(a, romAbs));
  const workdir = nativePath(config.workdir ? joinPath(dir, config.workdir) : dirname(exe));
  onStatus?.("启动中…");
  await tauri.launchEmulator(exe, args, workdir);
}
