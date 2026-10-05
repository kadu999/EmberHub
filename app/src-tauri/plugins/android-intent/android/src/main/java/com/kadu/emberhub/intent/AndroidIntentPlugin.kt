package com.kadu.emberhub.intent

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

/**
 * Rust 侧 `run_mobile_plugin("launch", ...)` 的参数。
 * 字段名与 Rust `LaunchPayload`（camelCase）一一对应。
 */
@InvokeArg
class LaunchArgs {
    var packageName: String? = null
    var path: String? = null
    var mime: String? = null
    var action: String? = null
}

/**
 * 用 Intent 启动目标模拟器 App：
 * - 有 `path`：用 FileProvider 把 ROM 暴露为 `content://` 并随 Intent 传入；
 * - 无 `path`：仅用 launch intent 打开 App（用于进模拟器自身设置）。
 */
@TauriPlugin
class AndroidIntentPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun launch(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(LaunchArgs::class.java)
            val pkg = args.packageName?.takeIf { it.isNotEmpty() }

            val intent: Intent
            val path = args.path
            if (!path.isNullOrEmpty()) {
                val file = File(path)
                if (!file.exists()) {
                    invoke.reject("要交给模拟器的文件不存在：$path")
                    return
                }
                val uri: Uri = FileProvider.getUriForFile(
                    activity,
                    "${activity.packageName}.fileprovider",
                    file
                )
                intent = Intent(args.action ?: Intent.ACTION_VIEW)
                intent.setDataAndType(uri, args.mime ?: "*/*")
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else {
                if (pkg == null) {
                    invoke.reject("缺少目标模拟器包名（packageName）")
                    return
                }
                intent = activity.packageManager.getLaunchIntentForPackage(pkg)
                    ?: run {
                        invoke.reject("未找到已安装的模拟器：$pkg")
                        return
                    }
            }

            // 指定目标 App（可空：交由系统按 MIME 选择）
            pkg?.let { intent.setPackage(it) }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.applicationContext.startActivity(intent)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "启动模拟器失败")
        }
    }
}
