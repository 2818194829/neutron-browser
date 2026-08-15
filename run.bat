@echo off
title Neutron Browser
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
echo [1/2] Building TypeScript...
call npm run build:ts
if errorlevel 1 (
  echo [ERROR] Build failed. See output above.
  pause
  exit /b 1
)
echo [2/2] Starting Neutron Browser...
".\node_modules\electron\dist\electron.exe" .