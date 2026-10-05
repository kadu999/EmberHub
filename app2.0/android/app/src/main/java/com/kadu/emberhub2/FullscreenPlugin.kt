package com.kadu.emberhub2

import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 本地 Capacitor 插件：全屏（沉浸式隐藏系统栏）。
 * 对应 1.0（Tauri）里 `getCurrentWindow().setFullscreen(...)` 在 Android 上的行为。
 */
@CapacitorPlugin(name = "Fullscreen")
class FullscreenPlugin : Plugin() {

    private var fullscreen = false

    @PluginMethod
    fun setFullscreen(call: PluginCall) {
        val target = call.getBoolean("fullscreen", false) ?: false
        activity.runOnUiThread {
            val controller =
                WindowInsetsControllerCompat(activity.window, activity.window.decorView)
            if (target) {
                controller.hide(WindowInsetsCompat.Type.systemBars())
                controller.systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars())
            }
            fullscreen = target
            val ret = JSObject()
            ret.put("fullscreen", target)
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun isFullscreen(call: PluginCall) {
        val ret = JSObject()
        ret.put("fullscreen", fullscreen)
        call.resolve(ret)
    }
}
