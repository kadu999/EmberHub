@echo off
rem EmberHub HTTP static server (Python GUI) - double-click to run
setlocal
set "PY="
for %%C in (pyw pythonw py python python3) do (
  if not defined PY (
    where %%C >nul 2>nul && set "PY=%%C"
  )
)
if not defined PY (
  echo [ERROR] Python 3 not found. Please install Python 3 and enable "Add python.exe to PATH".
  echo         https://www.python.org/downloads/
  pause
  exit /b 1
)
start "" %PY% "%~dp0http-server.py"
endlocal
