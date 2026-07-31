param(
  [int]$Port = 5177,
  [int]$DebugPort = 9223,
  [string]$NodePath = "",
  [string]$FfmpegPath = "",
  [string]$FfprobePath = "",
  [switch]$ValidatePlanOnly,
  [switch]$NoOpenExplorer
)

$ErrorActionPreference = "Stop"
$recordingRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$systemRoot = Split-Path -Parent $recordingRoot
$planPath = Join-Path $recordingRoot "demo-plan.json"
$tourPath = Join-Path $recordingRoot "run-demo-tour.mjs"
$ttsBuilderPath = Join-Path $recordingRoot "build-tts-assets.mjs"

function Quote-NativeArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

function Start-NativeProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [switch]$RedirectInput,
    [switch]$RedirectOutput,
    [switch]$Hidden
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument -Value ([string]$_) }) -join " ")
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $Hidden.IsPresent
  $startInfo.RedirectStandardInput = $RedirectInput.IsPresent
  $startInfo.RedirectStandardOutput = $RedirectOutput.IsPresent
  $startInfo.RedirectStandardError = $RedirectOutput.IsPresent
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Process failed to start: $FilePath"
  }
  return $process
}

function Resolve-Node {
  if ($NodePath) {
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
      throw "Node runtime not found: $NodePath"
    }
    return (Resolve-Path -LiteralPath $NodePath).Path
  }
  $portableNode = Join-Path $systemRoot "runtime\node\node.exe"
  if (Test-Path -LiteralPath $portableNode -PathType Leaf) {
    return $portableNode
  }
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }
  throw "Node runtime is missing. Expected: $portableNode"
}

function Invoke-PlanValidation {
  param([Parameter(Mandatory = $true)][string]$ResolvedNode)
  $output = & $ResolvedNode $tourPath --validate-only --plan $planPath
  if ($LASTEXITCODE -ne 0) {
    throw "Recording plan validation failed."
  }
  $result = $output | ConvertFrom-Json
  Write-Host "Recording plan validated: $($result.stepCount) steps, $($result.totalHoldMs) ms"
  return $result
}

$node = Resolve-Node
$plan = Invoke-PlanValidation -ResolvedNode $node
if ($ValidatePlanOnly) {
  exit 0
}

if ($env:OS -ne "Windows_NT") {
  throw "正式录制只能在 Windows 10/11 真机运行。"
}

function Resolve-RequiredFile {
  param(
    [string]$Requested,
    [Parameter(Mandatory = $true)][string]$DefaultPath,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $candidate = if ($Requested) { $Requested } else { $DefaultPath }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "$Label 缺失：$candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Resolve-Edge {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  throw "未找到 Microsoft Edge。请先安装或修复 Edge。"
}

function Test-Health {
  param([Parameter(Mandatory = $true)][string]$Uri)
  try {
    $result = Invoke-RestMethod -Uri $Uri -TimeoutSec 2
    return $result.ok -eq $true
  } catch {
    return $false
  }
}

function Wait-Until {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Condition,
    [int]$TimeoutSeconds = 30,
    [string]$FailureMessage = "等待超时"
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) {
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw $FailureMessage
}

function Stop-ProcessTree {
  param([System.Diagnostics.Process]$Process)
  if (-not $Process -or $Process.HasExited) {
    return
  }
  try {
    $taskkill = Start-Process -FilePath "taskkill.exe" `
      -ArgumentList @("/PID", "$($Process.Id)", "/T", "/F") `
      -WindowStyle Hidden -Wait -PassThru
    if ($taskkill.ExitCode -ne 0 -and -not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

$ffmpeg = Resolve-RequiredFile `
  -Requested $FfmpegPath `
  -DefaultPath (Join-Path $systemRoot "runtime\ffmpeg\ffmpeg.exe") `
  -Label "FFmpeg"
$ffprobe = Resolve-RequiredFile `
  -Requested $FfprobePath `
  -DefaultPath (Join-Path $systemRoot "runtime\ffmpeg\ffprobe.exe") `
  -Label "ffprobe"
$edge = Resolve-Edge

Add-Type -AssemblyName System.Windows.Forms
$primaryScreen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($primaryScreen.Width -lt 1920 -or $primaryScreen.Height -lt 1080) {
  throw "主屏分辨率必须至少为 1920×1080，当前为 $($primaryScreen.Width)×$($primaryScreen.Height)。"
}

$driveName = [System.IO.Path]::GetPathRoot($systemRoot).TrimEnd("\").TrimEnd(":")
$drive = Get-PSDrive -Name $driveName
if ($drive.Free -lt 2GB) {
  throw "磁盘剩余空间不足 2GB，无法保证录制完成。"
}

$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runRoot = Join-Path $recordingRoot "recordings\$runStamp"
$signalsRoot = Join-Path $runRoot "signals"
$screenshotsRoot = Join-Path $runRoot "failure-screenshots"
$edgeProfile = Join-Path $runRoot "edge-profile"
$timelinePath = Join-Path $runRoot "timeline.json"
$readyFile = Join-Path $signalsRoot "tour.ready"
$goFile = Join-Path $signalsRoot "recording.go"
$videoPath = Join-Path $runRoot "系统演示-无声.mp4"
$recordingReportPath = Join-Path $runRoot "录制报告.json"
$tourStdoutPath = Join-Path $runRoot "tour.stdout.log"
$tourStderrPath = Join-Path $runRoot "tour.stderr.log"
$ffmpegLogPath = Join-Path $runRoot "ffmpeg.log"
$ttsOutput = Join-Path $runRoot "tts"
New-Item -ItemType Directory -Path $signalsRoot, $screenshotsRoot, $edgeProfile -Force | Out-Null

$healthUrl = "http://127.0.0.1:$Port/api/health"
$baseUrl = "http://127.0.0.1:$Port"
$pageUrl = "$baseUrl$($plan.url)"
$serviceProcess = $null
$edgeProcess = $null
$tourProcess = $null
$ffmpegProcess = $null
$ownsService = $false
$recordingSucceeded = $false

try {
  if (-not (Test-Health -Uri $healthUrl)) {
    $serviceProcess = Start-NativeProcess `
      -FilePath "powershell.exe" `
      -Arguments @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (Join-Path $systemRoot "start-system.ps1"),
        "-Port", "$Port",
        "-Standard", (Join-Path $systemRoot "data\standard-96.sample.json"),
        "-NodePath", $node,
        "-NoBrowser",
        "-NoPause"
      ) `
      -Hidden
    $ownsService = $true
  }
  Wait-Until `
    -Condition { Test-Health -Uri $healthUrl } `
    -TimeoutSeconds 60 `
    -FailureMessage "本地服务 60 秒内未通过健康检查，请回传 logs 目录。"

  $edgeProcess = Start-NativeProcess `
    -FilePath $edge `
    -Arguments @(
      "--remote-debugging-port=$DebugPort",
      "--user-data-dir=$edgeProfile",
      "--kiosk",
      "--no-first-run",
      "--disable-session-crashed-bubble",
      "--disable-features=msEdgeFirstRunExperience",
      $pageUrl
    )

  Wait-Until `
    -Condition {
      try {
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/version" -TimeoutSec 1
        return [bool]$version.webSocketDebuggerUrl
      } catch {
        return $false
      }
    } `
    -TimeoutSeconds 30 `
    -FailureMessage "Edge 远程调试端点未就绪。可能被单位策略禁用。"

  $tourProcess = Start-NativeProcess `
    -FilePath $node `
    -Arguments @(
      $tourPath,
      "--plan", $planPath,
      "--debug-port", "$DebugPort",
      "--base-url", $baseUrl,
      "--ready-file", $readyFile,
      "--go-file", $goFile,
      "--timeline", $timelinePath,
      "--screenshot-dir", $screenshotsRoot
    ) `
    -RedirectOutput `
    -Hidden

  Wait-Until `
    -Condition {
      if ($tourProcess.HasExited) {
        return $false
      }
      return Test-Path -LiteralPath $readyFile -PathType Leaf
    } `
    -TimeoutSeconds 45 `
    -FailureMessage "自动演示 45 秒内未完成预热。"

  $filter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30"
  $ffmpegProcess = Start-NativeProcess `
    -FilePath $ffmpeg `
    -Arguments @(
      "-hide_banner",
      "-loglevel", "warning",
      "-y",
      "-f", "gdigrab",
      "-framerate", "30",
      "-draw_mouse", "0",
      "-i", "desktop",
      "-vf", $filter,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      $videoPath
    ) `
    -RedirectInput `
    -RedirectOutput `
    -Hidden

  Start-Sleep -Milliseconds 1200
  if ($ffmpegProcess.HasExited) {
    $ffmpegError = $ffmpegProcess.StandardError.ReadToEnd()
    throw "FFmpeg 启动后立即退出：$ffmpegError"
  }
  Set-Content -LiteralPath $goFile -Value (Get-Date -Format "o") -Encoding UTF8

  $tourDeadline = (Get-Date).AddMilliseconds([int]$plan.maxDurationMs + 30000)
  while (-not $tourProcess.HasExited -and (Get-Date) -lt $tourDeadline) {
    Start-Sleep -Milliseconds 200
  }
  if (-not $tourProcess.HasExited) {
    Stop-ProcessTree -Process $tourProcess
    throw "自动演示超过最大时长，已停止录制。"
  }

  Start-Sleep -Milliseconds 1800
  if (-not $ffmpegProcess.HasExited) {
    $ffmpegProcess.StandardInput.WriteLine("q")
    $ffmpegProcess.StandardInput.Flush()
  }
  if (-not $ffmpegProcess.WaitForExit(30000)) {
    Stop-ProcessTree -Process $ffmpegProcess
    throw "FFmpeg 未能在 30 秒内正常封装 MP4。"
  }
  $ffmpegErrorLog = $ffmpegProcess.StandardError.ReadToEnd()
  Set-Content -LiteralPath $ffmpegLogPath -Value $ffmpegErrorLog -Encoding UTF8
  $tourOutput = $tourProcess.StandardOutput.ReadToEnd()
  $tourError = $tourProcess.StandardError.ReadToEnd()
  Set-Content -LiteralPath $tourStdoutPath -Value $tourOutput -Encoding UTF8
  Set-Content -LiteralPath $tourStderrPath -Value $tourError -Encoding UTF8
  if ($tourProcess.ExitCode -ne 0) {
    throw "自动演示失败：$tourError"
  }
  if ($ffmpegProcess.ExitCode -ne 0) {
    throw "FFmpeg 退出码为 $($ffmpegProcess.ExitCode)，请查看 $ffmpegLogPath"
  }

  $probeJson = & $ffprobe `
    -v error `
    -show_entries "format=duration,size:stream=codec_name,width,height,avg_frame_rate" `
    -of json `
    $videoPath
  if ($LASTEXITCODE -ne 0) {
    throw "ffprobe 无法读取录制文件。"
  }
  $probe = $probeJson | ConvertFrom-Json
  $videoStream = $probe.streams | Where-Object { $_.width -and $_.height } | Select-Object -First 1
  $durationSeconds = [double]$probe.format.duration
  $sizeBytes = [int64]$probe.format.size
  $checks = [ordered]@{
    fileExists = Test-Path -LiteralPath $videoPath -PathType Leaf
    codecIsH264 = $videoStream.codec_name -eq "h264"
    resolutionIs1080p = $videoStream.width -eq 1920 -and $videoStream.height -eq 1080
    durationUnderFiveMinutes = $durationSeconds -lt 300
    sizeUnder200MB = $sizeBytes -lt 200MB
  }
  $failedChecks = @($checks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })
  if ($failedChecks.Count -gt 0) {
    throw "录制产物不符合比赛要求：$($failedChecks -join ', ')"
  }

  & $node $ttsBuilderPath `
    --plan $planPath `
    --timeline $timelinePath `
    --output $ttsOutput
  if ($LASTEXITCODE -ne 0) {
    throw "TTS 配音资产生成失败。"
  }

  $report = [ordered]@{
    ok = $true
    generatedAt = Get-Date -Format "o"
    videoPath = $videoPath
    durationSeconds = [math]::Round($durationSeconds, 3)
    sizeBytes = $sizeBytes
    video = [ordered]@{
      codec = $videoStream.codec_name
      width = $videoStream.width
      height = $videoStream.height
      averageFrameRate = $videoStream.avg_frame_rate
    }
    checks = $checks
    timelinePath = $timelinePath
    ttsDirectory = $ttsOutput
  }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $recordingReportPath -Encoding UTF8
  $recordingSucceeded = $true

  Write-Host ""
  Write-Host "录制成功：$videoPath"
  Write-Host "时长：$([math]::Round($durationSeconds, 1)) 秒"
  Write-Host "大小：$([math]::Round($sizeBytes / 1MB, 1)) MB"
  Write-Host "解说稿、SSML 和字幕：$ttsOutput"
  if (-not $NoOpenExplorer) {
    Start-Process -FilePath "explorer.exe" -ArgumentList @("/select,", $videoPath) | Out-Null
  }
} catch {
  $message = $_.Exception.Message
  Write-Host ""
  Write-Host "录制失败：$message" -ForegroundColor Red
  Write-Host "请把整个目录发回：$runRoot"
  $failureReport = [ordered]@{
    ok = $false
    generatedAt = Get-Date -Format "o"
    error = $message
    runDirectory = $runRoot
    timelinePath = $timelinePath
  }
  $failureReport | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordingReportPath -Encoding UTF8
  exit 1
} finally {
  if ($ffmpegProcess -and -not $ffmpegProcess.HasExited) {
    try {
      $ffmpegProcess.StandardInput.WriteLine("q")
      $ffmpegProcess.StandardInput.Flush()
      $ffmpegProcess.WaitForExit(5000) | Out-Null
    } catch {
      Stop-ProcessTree -Process $ffmpegProcess
    }
  }
  Stop-ProcessTree -Process $tourProcess
  Stop-ProcessTree -Process $edgeProcess
  if ($ownsService) {
    Stop-ProcessTree -Process $serviceProcess
  }
}

if (-not $recordingSucceeded) {
  exit 1
}
exit 0
