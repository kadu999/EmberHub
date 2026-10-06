@echo off
rem EmberHub - start Android dev (compile and run on emulator / device).
rem Runs scripts\dev-android.ps1. Optional args: -DevHost 192.168.1.12 -TauriVerbose
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-android.ps1" %*
set code=%errorlevel%
echo.
if not "%code%"=="0" echo [FAILED] Android dev exited. Exit code: %code%.
pause
endlocal
exit /b %code%
