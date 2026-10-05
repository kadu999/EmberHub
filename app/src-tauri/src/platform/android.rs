// Android：无法用 std::process::Command 启动外部 App，
// 需通过 Intent + FileProvider 把 ROM 以 content:// 交给目标模拟器。
// 在接入 Kotlin 本地插件（src-tauri/plugins/）前，先返回明确错误。
pub fn launch_emulator(
    _exe_path: String,
    _args: Vec<String>,
    _workdir: Option<String>,
) -> Result<u32, String> {
    Err("Android 端启动模拟器尚未实现（需 Intent + FileProvider 插件）".to_string())
}
