@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PORT=5177"
set "STANDARD=%~dp0data\standard-96.sample.json"
set "LOG_DIR=%~dp0logs"
set "STARTUP_LOG=%LOG_DIR%\startup.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-system.ps1" -Port %PORT% -Standard "%STANDARD%" -LogFile "%STARTUP_LOG%" -NoPause
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo ============================================================
  echo 启动失败，窗口将保持打开，错误码：%EXIT_CODE%
  echo 错误日志：%STARTUP_LOG%
  echo 请把 logs 文件夹发给技术支持。
  echo ============================================================
  echo.
  pause
)

endlocal & exit /b %EXIT_CODE%
