package com.kadu.emberhub2

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // 注册本地插件（需在 super.onCreate 之前）
        registerPlugin(FullscreenPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
