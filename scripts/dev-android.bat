@echo off
rem EmberHub - 启动 Android 开发（编译并运行到模拟器 / 真机）。双击本文件即可。
rem 执行 scripts\dev-android.ps1；可选参数：-DevHost 192.168.1.12  -TauriVerbose
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-android.ps1" %*
set code=%errorlevel%
echo.
if not "%code%"=="0" echo [失败] Android 开发退出，退出码 %code%。
pause
endlocal
exit /b %code%
