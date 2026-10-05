// EmberHub Android Intent 插件
//
// Android 无法用 `std::process::Command` 拉起别的 App，需要构造 Intent，并用
// FileProvider 把 App 私有目录里的 ROM 暴露成 `content://` URI 交给目标模拟器。
// 该逻辑用 Kotlin 实现（android/ 工程），Rust 侧只负责把参数转发给 Kotlin 插件。
//
// 仅 Android 生效；桌面端 `launch` 返回错误，方便上层统一调用。

use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

/// Kotlin 插件所在的包名（见 android/src/main/java/com/kadu/emberhub/intent/AndroidIntentPlugin.kt）。
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.kadu.emberhub.intent";

/// 传给 Kotlin `launch` 命令的参数。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPayload {
    pub package_name: String,
    pub path: Option<String>,
    pub mime: Option<String>,
    pub action: Option<String>,
}

/// 传给 Kotlin `install` 命令的参数（本地 APK 路径）。
#[derive(serde::Serialize, Clone)]
pub struct InstallPayload {
    pub path: String,
}

/// 插件运行时状态：持有移动端插件句柄。
pub struct AndroidIntent<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> AndroidIntent<R> {
    /// 启动目标 App 并（可选）传入 ROM。
    /// - `package`：目标模拟器包名，如 `com.retroarch`；
    /// - `path`：ROM 的本地绝对路径；为空表示只打开 App（进设置）；
    /// - `mime`：交给 Intent 的 MIME 类型；为空时由 Kotlin 侧用 `*/*`。
    #[cfg(target_os = "android")]
    pub fn launch(
        &self,
        package: &str,
        path: Option<&str>,
        mime: Option<&str>,
    ) -> Result<(), String> {
        self.handle
            .run_mobile_plugin::<()>(
                "launch",
                LaunchPayload {
                    package_name: package.to_string(),
                    path: path.map(|s| s.to_string()),
                    mime: mime.map(|s| s.to_string()),
                    action: None,
                },
            )
            .map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "android"))]
    pub fn launch(
        &self,
        _package: &str,
        _path: Option<&str>,
        _mime: Option<&str>,
    ) -> Result<(), String> {
        Err("Android Intent 仅在 Android 平台可用。".to_string())
    }

    /// 用系统安装器安装本地 APK。
    /// - `path`：本地 APK 绝对路径（App 私有目录亦可，FileProvider 会暴露成 content://）。
    #[cfg(target_os = "android")]
    pub fn install(&self, path: &str) -> Result<(), String> {
        self.handle
            .run_mobile_plugin::<()>(
                "install",
                InstallPayload {
                    path: path.to_string(),
                },
            )
            .map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "android"))]
    pub fn install(&self, _path: &str) -> Result<(), String> {
        Err("Android Intent 仅在 Android 平台可用。".to_string())
    }
}

/// 通过 `app.android_intent()` 取到插件实例。
pub trait AndroidIntentExt<R: Runtime> {
    fn android_intent(&self) -> &AndroidIntent<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidIntentExt<R> for T {
    fn android_intent(&self) -> &AndroidIntent<R> {
        self.state::<AndroidIntent<R>>().inner()
    }
}

/// 初始化插件（在 Tauri Builder 里 `.plugin(...)` 调用）。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("android-intent")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidIntentPlugin")?;

            app.manage(AndroidIntent::<R> {
                #[cfg(target_os = "android")]
                handle,
                #[cfg(not(target_os = "android"))]
                _marker: std::marker::PhantomData,
            });
            Ok(())
        })
        .build()
}
