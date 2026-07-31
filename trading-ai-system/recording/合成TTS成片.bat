@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" (
  echo 请把 TTS 的 WAV 或 MP3 文件拖到本批处理文件上。
  pause
  exit /b 2
)

for /f "delims=" %%D in ('dir /b /ad /o-d "%~dp0recordings" 2^>nul') do (
  set "LATEST_RUN=%~dp0recordings\%%D"
  goto :found
)

echo 没有找到录制目录，请先双击“开始自动录制.bat”。
pause
exit /b 3

:found
set "RAW_VIDEO=%LATEST_RUN%\系统演示-无声.mp4"
if not exist "%RAW_VIDEO%" (
  echo 最新录制目录中没有找到“系统演示-无声.mp4”。
  pause
  exit /b 4
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mux-tts.ps1" -VideoPath "%RAW_VIDEO%" -AudioPath "%~f1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
