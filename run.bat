@echo off
chcp 65001 >nul
title Neutron Browser
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
echo 🚀 正在启动 Neutron Browser...
".\node_modules\electron\dist\electron.exe" .
