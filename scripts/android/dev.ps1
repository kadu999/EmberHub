# Android 开发：编译并运行到模拟器 / 真机。
#
# 前置条件：
#   - JDK 17+
#   - Android SDK（设置 ANDROID_HOME 或 ANDROID_SDK_ROOT，Android Studio 自带）
#   - Android NDK（设置 NDK_HOME）
#   - rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
#   - 首次需先执行一次：pnpm tauri android init（生成并提交 src-tauri/gen/android）
#
# 用法:  powershell -ExecutionPolicy Bypass -File scripts/android/dev.ps1

$ErrorActionPreference = 'Stop'

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  throw '未设置 ANDROID_HOME / ANDROID_SDK_ROOT。请先安装 Android SDK（Android Studio）。'
}
if (-not $env:NDK_HOME) {
  Write-Host '警告：未设置 NDK_HOME，Tauri 可能找不到 Android NDK。' -ForegroundColor Yellow
}

# 脚本位于 scripts/android/，应用在仓库根的 app/
$appRoot = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'app'
if (-not (Test-Path (Join-Path $appRoot 'src-tauri\gen\android'))) {
  Write-Host '尚未初始化 Android 工程，请先在 app/ 执行：pnpm tauri android init' -ForegroundColor Yellow
}
Set-Location $appRoot
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
pnpm tauri android dev
