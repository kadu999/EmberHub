// Tauri 插件构建脚本：登记 Android 工程目录（tauri-build 会据此生成 tauri.settings.gradle）。
const COMMANDS: &[&str] = &["launch", "install"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
