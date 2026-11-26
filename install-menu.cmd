@echo off
setlocal EnableExtensions
set "LOG=%~dp0install-menu.log"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo [agy-menu] Installing... > "%LOG%"
"%NODE_EXE%" "%~dp0patch-menu.js" install --kill >> "%LOG%" 2>&1
if errorlevel 1 (
  type "%LOG%"
  echo.
  echo [agy-menu] Install failed. See %LOG%
  pause
  exit /b 1
)

type "%LOG%"
echo [agy-menu] Launching Antigravity silently...
"%NODE_EXE%" "%~dp0cli.js" launch-only
exit /b 0
