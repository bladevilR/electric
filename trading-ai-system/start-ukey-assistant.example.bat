@echo off
setlocal
cd /d "%~dp0"

set "PORT=5177"
set "OPENAI_BASE_URL=https://kimi.a7m.com.cn/v1"
set "OPENAI_MODEL=kimi-k2.6"
set "OPENAI_API_KEY=replace-with-your-key"
set "STANDARD=%~dp0data\standard-96.sample.json"

start "" "http://127.0.0.1:%PORT%"
if exist "%STANDARD%" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-system.ps1" -Port %PORT% -Standard "%STANDARD%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-system.ps1" -Port %PORT%
)
endlocal
