@echo off
rem EmberHub - start the PC (Windows desktop) dev mode.
rem Runs scripts\dev-pc.ps1.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-pc.ps1" %*
set code=%errorlevel%
echo.
if not "%code%"=="0" echo [FAILED] Dev mode exited. Exit code: %code%.
pause
endlocal
exit /b %code%
