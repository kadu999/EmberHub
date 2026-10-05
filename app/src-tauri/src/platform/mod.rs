// 平台相关命令的分发：桌面与移动在此分叉，其余命令保持共享。
// 详见 docs/PROJECT_LAYOUT.md 第 7 节「移动端扩展点」。

#[cfg(not(target_os = "android"))]
mod desktop;
#[cfg(target_os = "android")]
mod android;

#[cfg(not(target_os = "android"))]
pub use desktop::launch_emulator;
#[cfg(target_os = "android")]
pub use android::launch_emulator;
