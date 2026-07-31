@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

call "%~dp0recording\开始自动录制.bat"
exit /b %ERRORLEVEL%
