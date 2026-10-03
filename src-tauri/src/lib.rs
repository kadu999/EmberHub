// EmberHub - Tauri 薄壳
// 只暴露少量系统操作命令，业务逻辑尽量放在前端 TypeScript。
// 详见 docs/ARCHITECTURE.md

use std::process::Command;

use serde::Serialize;

/// 本地文件/目录条目
#[derive(Serialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 启动外部模拟器并传入参数（如 ROM 路径），返回进程 PID。
#[tauri::command]
fn launch_emulator(exe_path: String, args: Vec<String>) -> Result<u32, String> {
    let mut cmd = Command::new(&exe_path);
    cmd.args(&args);
    match cmd.spawn() {
        Ok(child) => Ok(child.id()),
        Err(e) => Err(format!("failed to launch `{}`: {}", exe_path, e)),
    }
}

/// 列出本地目录内容，供 LocalProvider 使用。
#[tauri::command]
fn list_local_dir(path: String) -> Result<Vec<LocalEntry>, String> {
    let mut entries = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| format!("failed to read `{}`: {}", path, e))?;
    for item in rd {
        let item = item.map_err(|e| e.to_string())?;
        let metadata = item.metadata().map_err(|e| e.to_string())?;
        entries.push(LocalEntry {
            name: item.file_name().to_string_lossy().to_string(),
            path: item.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    Ok(entries)
}

/// 应用信息，供前端展示。
#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "EmberHub",
        "version": env!("CARGO_PKG_VERSION"),
        "tagline": "让每一款老游戏，重新燃烧。",
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            launch_emulator,
            list_local_dir,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
