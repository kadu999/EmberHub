// 桌面平台：用系统命令拉起模拟器可执行文件。
use std::process::Command;

/// 启动外部模拟器并传入参数（如 ROM 路径），返回进程 PID。
pub fn launch_emulator(
    exe_path: String,
    args: Vec<String>,
    workdir: Option<String>,
) -> Result<u32, String> {
    let mut cmd = Command::new(&exe_path);
    cmd.args(&args);
    if let Some(dir) = workdir {
        if !dir.trim().is_empty() {
            cmd.current_dir(dir);
        }
    }
    match cmd.spawn() {
        Ok(child) => Ok(child.id()),
        Err(e) => Err(format!("failed to launch `{}`: {}", exe_path, e)),
    }
}

/// 桌面端没有 Android Intent。
pub fn android_launch_app(
    _app: &tauri::AppHandle,
    _package: String,
    _path: Option<String>,
    _mime: Option<String>,
) -> Result<(), String> {
    Err("Android Intent 仅在 Android 平台可用。".to_string())
}
