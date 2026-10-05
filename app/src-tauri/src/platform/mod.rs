// 平台相关命令的分发：桌面与移动在此分叉，其余命令保持共享。
// 详见 docs/PROJECT_LAYOUT.md 第 7 节「移动端扩展点」。
//
// - `launch_emulator`：桌面用系统命令拉起可执行文件；Android 不可用（走 Intent）。
// - `android_launch_app`：Android 用 Intent + FileProvider 启动目标 App；桌面不可用。

#[cfg(not(target_os = "android"))]
mod desktop;
#[cfg(target_os = "android")]
mod android;

#[cfg(not(target_os = "android"))]
pub use desktop::{android_install_apk, android_launch_app, launch_emulator};
#[cfg(target_os = "android")]
pub use android::{android_install_apk, android_launch_app, launch_emulator};
