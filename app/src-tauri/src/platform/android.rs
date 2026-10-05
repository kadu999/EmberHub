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
) -> Result<(), String> {
    if package.trim().is_empty() {
        return Err("缺少目标模拟器包名。".to_string());
    }
    app.android_intent()
        .launch(&package, path.as_deref(), mime.as_deref())
}
