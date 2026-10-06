@echo off
rem EmberHub - build the Android package (APK / AAB).
rem Runs scripts\build-android.ps1; output: release\android\.
rem Needs JDK + Android SDK/NDK and a prior "pnpm tauri android init".
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android.ps1" %*
set code=%errorlevel%
echo.
if not "%code%"=="0" (
  echo [FAILED] Android build failed. Exit code: %code%. See output above.
) else (
  echo [DONE] Android packages are in release\android\ (sign before publishing).
)
pause
endlocal
exit /b %code%
