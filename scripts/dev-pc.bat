@echo off
rem EmberHub - 启动 PC（Windows 桌面）开发模式。双击本文件即可。
rem 自动加载 VS 环境并执行 scripts\dev-pc.ps1。
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-pc.ps1" %*
set code=%errorlevel%
echo.
if not "%code%"=="0" echo [失败] 开发模式退出，退出码 %code%。
pause
endlocal
exit /b %code%
