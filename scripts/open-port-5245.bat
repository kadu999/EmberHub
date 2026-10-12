@echo off
chcp 65001 >nul
setlocal
rem 端口：默认 5245，可传参覆盖，例如： scripts\open-port-5245.bat 8000
if "%~1"=="" (set "PORT=5245") else (set "PORT=%~1")
set "RULE=EmberHub HTTP %PORT%"

rem 需要管理员权限：没有就自提权重开（带原参数）
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo 需要管理员权限，正在请求提权...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

echo ==========================================
echo   放开入站 TCP 端口 %PORT%
echo ==========================================
echo.

rem 先删同名旧规则，避免重复
netsh advfirewall firewall delete rule name="%RULE%" >nul 2>&1

netsh advfirewall firewall add rule name="%RULE%" dir=in action=allow protocol=TCP localport=%PORT% profile=any
if errorlevel 1 goto fail

echo.
echo [OK] 已放开 %PORT% 端口（入站 TCP，适用 域/专用/公用 网络）
goto show

:fail
echo.
echo [FAIL] 添加规则失败，请确认以管理员身份运行。

:show
echo.
echo 当前规则：
netsh advfirewall firewall show rule name="%RULE%"
echo.
pause
