@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PORT=5177"
set "STANDARD=%~dp0data\standard-96.sample.json"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-system.ps1" -Port %PORT% -Standard "%STANDARD%"

endlocal
