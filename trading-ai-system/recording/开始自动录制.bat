@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title 电力交易 AI - 自动录制
echo.
echo ============================================================
echo   电力交易 AI 比赛演示 - 一键自动录制
echo ============================================================
echo.
echo 请确认：
echo   1. UKey 已插好，需要的登录已提前完成
echo   2. 没有打开聊天、密码或其他敏感窗口
echo   3. 录制期间不要操作鼠标和键盘
echo.
echo 即将自动启动系统、全屏浏览器并录制，无需继续操作。
echo.
timeout /t 5 /nobreak >nul

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0record-demo.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo 录制没有成功。请把 recording\recordings 下最新的整个目录发回。
  pause
)
exit /b %EXIT_CODE%
