param(
  [Parameter(Mandatory = $true)]
  [string]$VideoPath,
  [Parameter(Mandatory = $true)]
  [string]$AudioPath,
  [string]$OutputPath = "",
  [string]$FfmpegPath = "",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$recordingRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$systemRoot = Split-Path -Parent $recordingRoot

if (-not (Test-Path -LiteralPath $VideoPath -PathType Leaf)) {
  throw "原始录屏不存在：$VideoPath"
}
if (-not (Test-Path -LiteralPath $AudioPath -PathType Leaf)) {
  throw "TTS 音轨不存在：$AudioPath"
}
$videoExtension = [System.IO.Path]::GetExtension($VideoPath).ToLowerInvariant()
$audioExtension = [System.IO.Path]::GetExtension($AudioPath).ToLowerInvariant()
if ($videoExtension -ne ".mp4") {
  throw "原始录屏必须是 MP4。"
}
if ($audioExtension -notin @(".wav", ".mp3", ".m4a", ".aac")) {
  throw "TTS 音轨必须是 WAV、MP3、M4A 或 AAC。"
}

$resolvedVideo = (Resolve-Path -LiteralPath $VideoPath).Path
$resolvedAudio = (Resolve-Path -LiteralPath $AudioPath).Path
if (-not $OutputPath) {
  $OutputPath = Join-Path `
    (Split-Path -Parent $resolvedVideo) `
    "$([System.IO.Path]::GetFileNameWithoutExtension($resolvedVideo))-TTS成片.mp4"
}
$fullOutput = [System.IO.Path]::GetFullPath($OutputPath)
if ($fullOutput -eq $resolvedVideo -or $fullOutput -eq $resolvedAudio) {
  throw "成片输出不能覆盖原始录屏或 TTS 音轨。"
}

Write-Host "TTS mux inputs validated: $resolvedVideo + $resolvedAudio"
if ($ValidateOnly) {
  exit 0
}

$ffmpeg = if ($FfmpegPath) {
  $FfmpegPath
} else {
  Join-Path $systemRoot "runtime\ffmpeg\ffmpeg.exe"
}
if (-not (Test-Path -LiteralPath $ffmpeg -PathType Leaf)) {
  throw "FFmpeg 缺失：$ffmpeg"
}

& $ffmpeg `
  -hide_banner `
  -loglevel warning `
  -y `
  -i $resolvedVideo `
  -i $resolvedAudio `
  -map "0:v:0" `
  -map "1:a:0" `
  -c:v copy `
  -c:a aac `
  -b:a 160k `
  -af apad `
  -shortest `
  -movflags "+faststart" `
  $fullOutput
if ($LASTEXITCODE -ne 0) {
  throw "TTS 音轨合成失败，FFmpeg 退出码为 $LASTEXITCODE。"
}
if (-not (Test-Path -LiteralPath $fullOutput -PathType Leaf)) {
  throw "FFmpeg 没有生成成片：$fullOutput"
}
Write-Host "TTS 成片已生成：$fullOutput"
