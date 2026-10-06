@echo off
rem EmberHub - build the PC (Windows desktop) package.
rem Runs scripts\build-pc.ps1; output: release\desktop\ (incl. portable\).
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-pc.ps1" %*
set code=%errorlevel%
echo.
if not "%code%"=="0" (
  echo [FAILED] PC build failed. Exit code: %code%. See output above.
) else (
  echo [DONE] PC packages are in release\desktop\
)
pause
endlocal
exit /b %code%
