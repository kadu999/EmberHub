package com.kadu.emberhub.intent

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Environment
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

/** Rust 侧 `run_mobile_plugin("install", ...)` 的参数。 */
@InvokeArg
class InstallArgs {
    var path: String? = null
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

    /**
     * 用系统安装器安装本地 APK：
     * 把 App 私有目录里的 APK 用 FileProvider 暴露成 content://，
     * 以 `application/vnd.android.package-archive` 交给系统包安装器（会弹安装确认）。
     */
    @Command
    fun install(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(InstallArgs::class.java)
            val path = args.path
            if (path.isNullOrEmpty()) {
                invoke.reject("缺少 APK 路径")
                return
            }
            val file = File(path)
            if (!file.exists()) {
                invoke.reject("APK 不存在：$path")
                return
            }
            val uri: Uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.applicationContext.startActivity(intent)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "安装 APK 失败")
        }
    }

    /**
     * 返回可移除外置存储（SD 卡）上的 App 私有目录；没有 SD 卡时 resolve(null)。
     * 该目录（/storage/XXXX-XXXX/Android/data/<包名>/files/…）属于 App 自己，读写**不需要存储权限**。
     */
    @Command
    fun external_files_dir(invoke: Invoke) {
        try {
            val dirs = activity.getExternalFilesDirs(null)
            // dirs[0] 是内置主存储；其后为可移除外置存储（SD 卡）
            val sd = dirs.drop(1).firstOrNull { it != null && Environment.isExternalStorageRemovable(it) }
                ?: dirs.drop(1).firstOrNull { it != null }
            if (sd != null) {
                invoke.resolve(sd.absolutePath)
            } else {
                invoke.resolve()
            }
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "获取外置存储目录失败")
        }
    }

    /** 共享存储根目录下的 EmberHub 目录（如 /sdcard/EmberHub）。 */
    @Command
    fun shared_storage_dir(invoke: Invoke) {
        try {
            val root = Environment.getExternalStorageDirectory()
            invoke.resolve(File(root, "EmberHub").absolutePath)
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "获取共享存储目录失败")
        }
    }

    /** 是否已获得「所有文件访问（共享存储）」权限。 */
    @Command
    fun has_all_files_access(invoke: Invoke) {
        try {
            val ok = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                Environment.isExternalStorageManager()
            } else {
                activity.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
            }
            invoke.resolve(ok)
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "检查存储权限失败")
        }
    }

    /** 跳转系统设置，请求「所有文件访问（共享存储）」权限。 */
    @Command
    fun request_all_files_access(invoke: Invoke) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                val i = Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                i.data = Uri.parse("package:" + activity.packageName)
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.applicationContext.startActivity(i)
            } else {
                activity.requestPermissions(
                    arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE),
                    0
                )
            }
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "请求存储权限失败")
        }
    }
}
