param(
  [int]$Port = 5177,
  [string]$Standard = "",
  [string]$NodePath = "",
  [string]$LogFile = "",
  [switch]$NoBrowser,
  [switch]$NoPause,
  [int]$KeepAliveSeconds = 0
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsRoot = Join-Path $root "logs"
if (-not $LogFile) {
  $LogFile = Join-Path $logsRoot "startup.log"
}
$serverOutputLog = Join-Path $logsRoot "server.stdout.log"
$serverErrorLog = Join-Path $logsRoot "server.stderr.log"
$isWindowsHost = $env:OS -eq "Windows_NT"

try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $LogFile) -Force | Out-Null
  New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
  Set-Content -LiteralPath $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting trading assistant." -Encoding UTF8
} catch {
  Write-Host ""
  Write-Host "Startup failed: the log directory could not be created."
  Write-Host $_.Exception.Message
  if (-not $NoPause) {
    Read-Host "Press Enter to close this window"
  }
  exit 1
}

function Write-StartupMessage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  Write-Host $Message
  try {
    Add-Content -LiteralPath $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" -Encoding UTF8
  } catch {
    Write-Host "Warning: could not append to startup log: $($_.Exception.Message)"
  }
}

function Stop-Startup {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message,
    [string]$Details = ""
  )

  Write-Host ""
  Write-StartupMessage "Startup failed: $Message"
  if ($Details) {
    Write-StartupMessage $Details
  }
  Write-StartupMessage "Startup log: $LogFile"
  Write-StartupMessage "Server output: $serverOutputLog"
  Write-StartupMessage "Server errors: $serverErrorLog"
  Write-Host ""
  Write-Host "Please send the files in the logs folder to support."
  if (-not $NoPause) {
    Read-Host "Press Enter to close this window"
  }
  exit 1
}

$portableNode = Join-Path $root "runtime\node\node.exe"
$bundledNode = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$node = ""
if ($NodePath) {
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    Stop-Startup -Message "Node runtime was not found." -Details "Requested Node path does not exist: $NodePath"
  }
  $node = $NodePath
} elseif (Test-Path -LiteralPath $portableNode -PathType Leaf) {
  $node = $portableNode
} elseif (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
  $node = $bundledNode
} else {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $node = $nodeCommand.Source
  }
}

if (-not $node) {
  Stop-Startup -Message "Node runtime was not found." -Details "Expected portable runtime: $portableNode"
}

Write-StartupMessage "Using Node runtime: $node"
$workbenchUrl = "http://127.0.0.1:$Port/"
$healthUrl = "http://127.0.0.1:$Port/api/health"

try {
  $existing = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
  if ($existing.ok) {
    if (-not $NoBrowser) {
      Start-Process -FilePath $workbenchUrl | Out-Null
    }
    Write-StartupMessage "Already running: $workbenchUrl"
    exit 0
  }
} catch {
  # Not running yet. Continue with startup.
}

$argsList = @("server.mjs", "--port", "$Port")
if ($Standard -and (Test-Path $Standard)) {
  $argsList += @("--standard", $Standard)
}

try {
  Remove-Item -LiteralPath $serverOutputLog -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $serverErrorLog -Force -ErrorAction SilentlyContinue
  $startProcessArguments = @{
    FilePath = $node
    ArgumentList = $argsList
    WorkingDirectory = $root
    RedirectStandardOutput = $serverOutputLog
    RedirectStandardError = $serverErrorLog
    PassThru = $true
  }
  if ($isWindowsHost) {
    $startProcessArguments.WindowStyle = "Hidden"
  }
  $server = Start-Process @startProcessArguments
} catch {
  Stop-Startup -Message "The local service process could not be started." -Details $_.Exception.Message
}

for ($i = 0; $i -lt 60; $i += 1) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
    if ($health.ok) {
      if (-not $NoBrowser) {
        Start-Process -FilePath $workbenchUrl | Out-Null
      }
      Write-StartupMessage "Started: $workbenchUrl"
      Write-StartupMessage "Keep this window open while using the system."
      $serviceReady = $true
      break
    }
  } catch {
    if ($server.HasExited) {
      break
    }
  }
}

$serviceReady = $serviceReady -eq $true
if ($serviceReady) {
  if ($KeepAliveSeconds -gt 0) {
    $keepAliveDeadline = (Get-Date).AddSeconds($KeepAliveSeconds)
    while ((Get-Date) -lt $keepAliveDeadline) {
      if ($server.HasExited) {
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if (-not $server.HasExited) {
      Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $server.Id -ErrorAction SilentlyContinue
    }
    Write-StartupMessage "Launcher verification completed."
    exit 0
  }

  while (-not $server.HasExited) {
    Start-Sleep -Seconds 2
  }
}

$failureDetails = "Browser cannot connect to 127.0.0.1:$Port yet."
if ($server.HasExited) {
  $failureDetails = "The local service exited with code $($server.ExitCode)."
  if (Test-Path -LiteralPath $serverErrorLog) {
    $serverErrors = (Get-Content -LiteralPath $serverErrorLog -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
    if ($serverErrors) {
      $failureDetails = "$failureDetails$([Environment]::NewLine)$serverErrors"
    }
  }
}
Stop-Startup -Message "The local service did not become ready." -Details $failureDetails
