// 平台差异接口：桌面与移动在此分叉，业务层（domain/）只依赖它。
// 详见 docs/PROJECT_LAYOUT.md 第 7 节「移动端扩展点」。
import type { Os } from "./detect";

/** 启动附加参数：移动端（Android）用，桌面端忽略。 */
export interface LaunchOptions {
  /** Android：目标 App 包名（缺省用 exePath 作为包名） */
  package?: string;
  /** Android：要交给模拟器的 ROM 绝对路径（缺省只打开 App） */
  romPath?: string;
  /** Android：交给 Intent 的 MIME 类型（缺省按扩展名推断） */
  mime?: string;
}

export interface Platform {
  /** 当前运行平台 */
  readonly os: Os;
  /** 是否移动端 */
  readonly isMobile: boolean;
  /**
   * 启动外部模拟器。
   * - 桌面：拉起可执行文件，返回进程 PID（忽略 opts）。
   * - Android：Intent + FileProvider 启动目标 App，返回 0。
   */
  launchEmulator(
    exePath: string,
    args: string[],
    workdir?: string,
    opts?: LaunchOptions,
  ): Promise<number>;
}
