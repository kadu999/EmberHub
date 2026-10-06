@echo off
rem EmberHub - 打 PC（Windows 桌面）包。双击本文件即可。
rem 自动加载 VS 环境并执行 scripts\build-pc.ps1，
rem 产物输出到仓库根 release\desktop\（含 portable\ 便携版）。
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-pc.ps1" %*
set code=%errorlevel%
echo.
if not "%code%"=="0" (
  echo [失败] PC 打包未成功，退出码 %code%。请查看上方输出。
) else (
  echo [完成] PC 产物在 release\desktop\
)
pause
endlocal
exit /b %code%
