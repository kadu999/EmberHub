# Android 打包：生成 APK / AAB 并导出到仓库根 release/android/。
#
# 前置条件同 scripts/dev-android.ps1（JDK + Android SDK/NDK + rust android target），
# 且已执行过 pnpm tauri android init。
#
# 用法:  powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1
#        （或直接双击 scripts\build-android.bat）

$ErrorActionPreference = 'Stop'

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  throw '未设置 ANDROID_HOME / ANDROID_SDK_ROOT。请先安装 Android SDK（Android Studio）。'
}
if (-not $env:NDK_HOME) {
  Write-Host '警告：未设置 NDK_HOME，Tauri 可能找不到 Android NDK。' -ForegroundColor Yellow
}

# 脚本位于 scripts/，应用在仓库根的 app/
$repoRoot = Split-Path $PSScriptRoot -Parent
$appRoot  = Join-Path $repoRoot 'app'
Set-Location $appRoot
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
pnpm tauri android build

# 导出 APK/AAB 到 release/android/（与构建缓存解耦）
# 只取发布产物：release APK（排除 debug 与 baselineProfiles）与 AAB
$outputsDir = Join-Path $appRoot 'src-tauri\gen\android\app\build\outputs'
$releaseDir = Join-Path $repoRoot 'release\android'
if (Test-Path $outputsDir) {
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  $apks = Get-ChildItem -Path (Join-Path $outputsDir 'apk') -Recurse -File -Filter '*.apk' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\release\\' -and $_.FullName -notmatch '\\baselineProfiles\\' }
  $aabs = Get-ChildItem -Path (Join-Path $outputsDir 'bundle') -Recurse -File -Filter '*.aab' -ErrorAction SilentlyContinue
  @($apks) + @($aabs) | ForEach-Object { Copy-Item -Force $_.FullName $releaseDir }
  Write-Host '已导出 APK/AAB 到 release\android\（发布前需用 keystore 签名）' -ForegroundColor Green
} else {
  Write-Host "未找到 Android 构建产物目录（构建可能失败）：$outputsDir" -ForegroundColor Yellow
}
