// Android 平台：无法用 std::process::Command 启动外部 App，
// 改用 Intent + FileProvider 把 ROM 以 content:// 交给目标模拟器（Kotlin 插件实现）。
use tauri::AppHandle;
use tauri_plugin_android_intent::AndroidIntentExt;

/// Android 上不存在「可执行文件」概念，调用方应改用 `android_launch_app`。
pub fn launch_emulator(
    _exe_path: String,
    _args: Vec<String>,
    _workdir: Option<String>,
) -> Result<u32, String> {
    Err("Android 端请使用 Intent 启动模拟器（android_launch_app）。".to_string())
}

/// 用 Intent 启动目标模拟器 App；`path` 为空表示只打开 App（进设置）。
pub fn android_launch_app(
    app: &AppHandle,
    package: String,
    path: Option<String>,
    mime: Option<String>,
    component: Option<String>,
    extras: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    if package.trim().is_empty() {
        return Err("缺少目标模拟器包名。".to_string());
    }
    app.android_intent()
        .launch(&package, path.as_deref(), mime.as_deref(), component.as_deref(), extras)
}

/// 用系统安装器安装本地 APK（App 私有目录里的 APK 由 FileProvider 暴露为 content://）。
pub fn android_install_apk(app: &AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("缺少 APK 路径。".to_string());
    }
    app.android_intent().install(&path)
}

/// 共享存储根下的 EmberHub 目录（如 /sdcard/EmberHub）。
pub fn android_shared_storage_dir(app: &AppHandle) -> Result<String, String> {
    app.android_intent().shared_storage_dir()
}

/// 是否已获得「所有文件访问（共享存储）」权限。
pub fn android_has_all_files_access(app: &AppHandle) -> Result<bool, String> {
    app.android_intent().has_all_files_access()
}

/// 跳转系统设置，请求「所有文件访问（共享存储）」权限。
pub fn android_request_all_files_access(app: &AppHandle) -> Result<(), String> {
    app.android_intent().request_all_files_access()
}

/// 是否已允许「安装未知应用」（安装模拟器 APK 需要）。
pub fn android_can_install_packages(app: &AppHandle) -> Result<bool, String> {
    app.android_intent().can_install_packages()
}

/// 跳转系统设置，请求「安装未知应用」权限。
pub fn android_request_install_packages(app: &AppHandle) -> Result<(), String> {
    app.android_intent().request_install_packages()
}

/// 目标模拟器 App（按包名）是否已安装。
pub fn android_is_package_installed(app: &AppHandle, package: String) -> Result<bool, String> {
    if package.trim().is_empty() {
        return Err("缺少目标模拟器包名。".to_string());
    }
    app.android_intent().is_package_installed(&package)
}
