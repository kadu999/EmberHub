@echo off
rem EmberHub relay station (OpenList) - one-click manager
rem Double-click this file, or pass an action: setup / start / stop / restart / open / status
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openlist.ps1" %*
endlocal
