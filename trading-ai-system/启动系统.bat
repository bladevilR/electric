@echo off
setlocal
cd /d "%~dp0"

set "PORT=5177"
set "STANDARD=%~dp0data\standard-96.sample.json"

start "" "%~dp0一分钟上手.html"
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%/'"

if exist "%STANDARD%" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-system.ps1" -Port %PORT% -Standard "%STANDARD%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-system.ps1" -Port %PORT%
)

endlocal
