// 启动 + 按需下载。
// 启动命令来源：Roms 的 launch 优先 → 否则用 Emulators 的 emulators.json。
// 不配置模拟器、不管理模拟器生命周期（不关闭、不重启）。
import { tauri } from "../lib/tauri";
import { basename, dirname, extname, isAbsolute, joinPath, nativePath, stripExt } from "../lib/path";
import type { SourceConfig, StorageProvider } from "../storage/types";
import { ensureEmulator, ensureRom, getDownloadDir } from "./ensure";
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

/** 启动命令里除文件路径外可用的上下文变量。 */
export interface LaunchVars {
  /** 游戏平台（Roms 文件夹名） */
  platform?: string;
  /** 游戏标题 */
  title?: string;
  /** 模拟器安装目录（仅 Emulators 配置分支可用） */
  emulatorDir?: string;
}

/** 替换启动命令占位符。 */
export function substitute(cmd: string, abs: string, vars?: LaunchVars): string {
  return cmd
    .replace(/\{file\.path\}/g, abs)
    .replace(/\{file\.uri\}/g, fileUri(abs))
    .replace(/\{file\.name\}/g, basename(abs))
    .replace(/\{file\.basename\}/g, stripExt(basename(abs)))
    .replace(/\{file\.stem\}/g, stripExt(basename(abs)))
    .replace(/\{file\.ext\}/g, extname(abs))
    .replace(/\{file\.dir\}/g, dirname(abs))
    .replace(/\{platform\}/g, vars?.platform ?? "")
    .replace(/\{title\}/g, vars?.title ?? "")
    .replace(/\{emulator\.dir\}/g, vars?.emulatorDir ?? "");
}

export interface LaunchPlan {
  exe: string;
  args: string[];
  workdir?: string;
}

/**
 * 由一条启动命令生成启动计划。
 * - 绝对 `exe`：直接使用。
 * - 相对 `exe`：先在 `baseDirAbs`（通常是下载目录，结构与资源服务器镜像）下查找；
 *   找到就用它，找不到则保持原样，交由系统按 PATH 查找。
 */
export async function buildLaunchPlan(
  launchCmd: string,
  romAbs: string,
  baseDirAbs?: string,
  vars?: LaunchVars,
): Promise<LaunchPlan> {
  if (!launchCmd || launchCmd.trim() === "") throw new Error("没有配置 launch 命令。");
  const tokens = splitCommand(substitute(launchCmd, romAbs, vars));
  if (tokens.length === 0) throw new Error("launch 命令为空。");

  const raw = tokens[0];
  const args = tokens.slice(1);

  if (isAbsolute(raw)) {
    const exe = nativePath(raw);
    return { exe, args, workdir: dirname(exe) };
  }
  if (baseDirAbs) {
    const candidate = joinPath(baseDirAbs, raw);
    if (await tauri.fileExists(candidate)) {
      const exe = nativePath(candidate);
      return { exe, args, workdir: dirname(exe) };
    }
  }
  // 相对路径且下载目录里没有 → 交给系统按 PATH 查找
  return { exe: raw, args, workdir: undefined };
}

/** 启动游戏：先确保 ROM 在本地，再按 Roms 优先 / Emulators 配置拉起模拟器。 */
export async function launchGame(
  game: Game,
  provider: StorageProvider,
  source: SourceConfig,
  onStatus?: (s: string) => void,
): Promise<void> {
  // 1) Roms 的 launch 优先（自定义命令；是否解压由游戏/平台级 extract 决定，默认解压）
  if (game.launch && game.launch.trim() !== "") {
    const romAbs = nativePath(
      await ensureRom(provider, source, game, onStatus, game.extract !== false),
    );
    const plan = await buildLaunchPlan(game.launch, romAbs, await getDownloadDir(source), {
      platform: game.collection,
      title: game.title,
    });
    onStatus?.("启动中…");
    await tauri.launchEmulator(plan.exe, plan.args, plan.workdir);
    return;
  }

  // 2) 否则用 Emulators 的 emulators.json；是否解压由 config.extract 决定（默认解压）
  const { dir, config, args: cfgArgs } = await ensureEmulator(provider, source, game.collection, onStatus);
  const romAbs = nativePath(await ensureRom(provider, source, game, onStatus, config.extract !== false));
  const exe = nativePath(isAbsolute(config.exe) ? config.exe : joinPath(dir, config.exe));
  const vars: LaunchVars = { platform: game.collection, title: game.title, emulatorDir: dir };
  const args = (cfgArgs ?? []).map((a) => substitute(a, romAbs, vars));
  const workdir = nativePath(config.workdir ? joinPath(dir, config.workdir) : dirname(exe));
  onStatus?.("启动中…");
  await tauri.launchEmulator(exe, args, workdir);
}
