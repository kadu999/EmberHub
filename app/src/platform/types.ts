// 平台差异接口：桌面与移动在此分叉，业务层（domain/）只依赖它。
// 详见 docs/PROJECT_LAYOUT.md 第 7 节「移动端扩展点」。
import type { Os } from "./detect";

export interface Platform {
  /** 当前运行平台 */
  readonly os: Os;
  /** 是否移动端 */
  readonly isMobile: boolean;
  /**
   * 启动外部模拟器。
   * - 桌面：拉起可执行文件，返回进程 PID。
   * - Android：Intent + FileProvider 启动目标 App（待实现）。
   */
  launchEmulator(exePath: string, args: string[], workdir?: string): Promise<number>;
}
