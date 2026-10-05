# EmberHub 2.0（app2.0）

Capacitor 版 App 壳，与仓库根 `app/`（Tauri 版）**并存、互不影响**。
本次只完成第一步：**窗口 / 全屏**功能的移植，验证 Capacitor 方案。

## 现状

- Vite + React + TS + Capacitor 8
- `src/platform/window.ts`：全屏抽象
  - Web/调试：标准 Fullscreen API
  - Android：本地 `Fullscreen` 插件（Kotlin，沉浸式隐藏系统栏）
- `src/App.tsx`：最小界面，按钮 + F11 切换全屏

## 开发

环境要求：**JDK 21**（Capacitor 7/8 的 android 模块要求 Java 21；本机已装到 `~/.jdks/jdk-21.0.2`）+ Android SDK。

```bash
cd app2.0
pnpm install

# 浏览器预览（走标准 Fullscreen API）
pnpm dev

# 构建并同步到 Android 工程
pnpm build && pnpm sync

# 出调试 APK（注意用 JDK 21）
cd android
$env:JAVA_HOME="$env:USERPROFILE\.jdks\jdk-21.0.2"; $env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk

# 或用 Android Studio 打开
pnpm open:android
```

## 自定义插件

`android/app/src/main/java/com/kadu/emberhub2/FullscreenPlugin.kt` 是本地 Capacitor 插件
（`@CapacitorPlugin(name = "Fullscreen")`），在 `MainActivity.kt` 里注册。
前端通过 `src/platform/window.ts` 的 `registerPlugin("Fullscreen")` 调用。

> Kotlin 工具链：在 `android/build.gradle` 加了 `kotlin-gradle-plugin:2.2.10`，
> 在 `android/app/build.gradle` 应用 `kotlin-android` 并设 `jvmTarget = '21'`。


## 与 1.0 的关系

`app/`（Tauri 版）保持不动。后续会把 `app/src/domain`、`shared` 等纯 TS 逻辑
逐步移植到 `app2.0`，平台相关部分走 Capacitor 插件。
