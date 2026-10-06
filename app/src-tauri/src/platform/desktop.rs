// 桌面平台：用系统命令拉起模拟器可执行文件。
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;

/// 当前由本进程拉起的模拟器（用于「同一目标不重复启动」）。
struct Running {
    key: String,
    child: std::process::Child,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);

/// 启动目标标识：exe + 参数（同一游戏 = 同一 key）。
fn proc_key(exe_path: &str, args: &[String]) -> String {
    format!("{}\u{1}{}", exe_path.to_lowercase(), args.join("\u{1}"))
}

/// 结束「已在运行的同类模拟器」：先软关（发 WM_CLOSE，让它正常保存配置/存档），
/// 稍等仍在则强杀。覆盖上一次 EmberHub 会话留下的进程（App 启动游戏后会关闭自己）。
#[cfg(windows)]
fn kill_existing(exe_path: &str) {
    use std::os::windows::process::CommandExt;
    use std::time::Duration;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let name = match Path::new(exe_path).file_name().and_then(|s| s.to_str()) {
        Some(n) if !n.is_empty() => n.to_string(),
        _ => return,
    };
    let _ = Command::new("taskkill")
        .args(["/IM", &name, "/T"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    std::thread::sleep(Duration::from_millis(1200));
    let _ = Command::new("taskkill")
        .args(["/IM", &name, "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn kill_existing(_exe_path: &str) {}

/// 启动外部模拟器并传入参数（如 ROM 路径），返回进程 PID。
/// 同一时间只允许一个模拟器：同一目标不重复启动，换目标先关旧的。
pub fn launch_emulator(
    exe_path: String,
    args: Vec<String>,
    workdir: Option<String>,
) -> Result<u32, String> {
    let key = proc_key(&exe_path, &args);

    // 同一目标且仍在运行 → 不重复启动。
    if let Ok(mut guard) = RUNNING.lock() {
        let same_alive = match guard.as_mut() {
            Some(r) if r.key == key => matches!(r.child.try_wait(), Ok(None)),
            _ => false,
        };
        if same_alive {
            return Ok(guard.as_ref().map(|r| r.child.id()).unwrap_or(0));
        }
        *guard = None;
    }

    // 关旧启新：结束已在运行的同类模拟器（可能来自上一次会话）。
    kill_existing(&exe_path);

    let mut cmd = Command::new(&exe_path);
    cmd.args(&args);
    if let Some(dir) = workdir {
        if !dir.trim().is_empty() {
            cmd.current_dir(dir);
        }
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch `{}`: {}", exe_path, e))?;
    let pid = child.id();
    if let Ok(mut guard) = RUNNING.lock() {
        *guard = Some(Running { key, child });
    }
    Ok(pid)
}

/// 桌面端没有 Android Intent。
pub fn android_launch_app(
    _app: &tauri::AppHandle,
    _package: String,
    _path: Option<String>,
    _mime: Option<String>,
    _component: Option<String>,
    _extras: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    Err("Android Intent 仅在 Android 平台可用。".to_string())
}

/// 桌面端没有 Android 安装器。
pub fn android_install_apk(_app: &tauri::AppHandle, _path: String) -> Result<(), String> {
    Err("Android APK 安装仅在 Android 平台可用。".to_string())
}

/// 桌面端没有 Android 共享存储。
pub fn android_shared_storage_dir(_app: &tauri::AppHandle) -> Result<String, String> {
    Err("Android 共享存储仅在 Android 平台可用。".to_string())
}

/// 桌面端恒为「有权限」（无意义）。
pub fn android_has_all_files_access(_app: &tauri::AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// 桌面端没有 Android 权限请求。
pub fn android_request_all_files_access(_app: &tauri::AppHandle) -> Result<(), String> {
    Err("Android 共享存储仅在 Android 平台可用。".to_string())
}

/// 桌面端恒为「有权限」（无意义）。
pub fn android_can_install_packages(_app: &tauri::AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// 桌面端没有 Android 权限请求。
pub fn android_request_install_packages(_app: &tauri::AppHandle) -> Result<(), String> {
    Err("安装未知应用仅在 Android 平台可用。".to_string())
}

/// 桌面端没有「已安装的 App」概念。
pub fn android_is_package_installed(
    _app: &tauri::AppHandle,
    _package: String,
) -> Result<bool, String> {
    Err("检查已安装 App 仅在 Android 平台可用。".to_string())
}

/// 桌面端没有 Android ABI 概念。
pub fn android_device_abi(_app: &tauri::AppHandle) -> Result<String, String> {
    Ok(String::new())
}

/// 桌面端没有「原生库目录」概念。
pub fn android_native_library_dir(
    _app: &tauri::AppHandle,
    _package: String,
) -> Result<Option<String>, String> {
    Ok(None)
}
