@echo off
setlocal
rem Usage: open-port-5244.bat [port]   (default 5244)
if "%~1"=="" (set "PORT=5244") else (set "PORT=%~1")
set "RULE=EmberHub HTTP %PORT%"

rem Need admin: self-elevate (keep args) if not elevated
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

echo ==========================================
echo   Allow inbound TCP port %PORT%
echo ==========================================
echo.

rem Remove an old rule with the same name to avoid duplicates
netsh advfirewall firewall delete rule name="%RULE%" >nul 2>&1

netsh advfirewall firewall add rule name="%RULE%" dir=in action=allow protocol=TCP localport=%PORT% profile=any
if errorlevel 1 goto fail

echo.
echo [OK] Inbound TCP %PORT% allowed (all profiles).
goto show

:fail
echo.
echo [FAIL] Failed to add rule. Please run as administrator.

:show
echo.
echo Current rule:
netsh advfirewall firewall show rule name="%RULE%"
echo.
pause
