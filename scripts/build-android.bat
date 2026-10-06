@echo off
rem EmberHub - 打 Android 包（APK / AAB）。双击本文件即可。
rem 执行 scripts\build-android.ps1，产物输出到仓库根 release\android\。
rem 前置：JDK + Android SDK/NDK，且已执行过 pnpm tauri android init。
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android.ps1" %*
set code=%errorlevel%
echo.
if not "%code%"=="0" (
  echo [失败] Android 打包未成功，退出码 %code%。请查看上方输出。
) else (
  echo [完成] Android 产物在 release\android\（发布前需签名）
)
pause
endlocal
exit /b %code%
