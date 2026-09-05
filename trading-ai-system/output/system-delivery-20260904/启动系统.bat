@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "LOG_DIR=%~dp0logs"
set "STARTUP_LOG=%LOG_DIR%\startup.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0portable-launch.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo ============================================================
  echo [提示] 系统未能成功启动，错误码：%EXIT_CODE%
  echo 启动日志：%STARTUP_LOG%
  echo 服务错误日志：%LOG_DIR%\server.stderr.log
  echo 请将 logs 文件夹中的内容发给技术支持。
  echo ============================================================
  echo.
  pause
)

endlocal & exit /b %EXIT_CODE%

