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

function Open-WorkbenchBrowser {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  if ($isWindowsHost) {
    $browserCandidates = @(
      @{ Name = "Google Chrome"; Command = "chrome.exe"; Paths = @(
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
      ) },
      @{ Name = "Microsoft Edge"; Command = "msedge.exe"; Paths = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
      ) }
    )

    foreach ($browser in $browserCandidates) {
      $browserPath = $browser.Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
      if (-not $browserPath) {
        $browserCommand = Get-Command $browser.Command -ErrorAction SilentlyContinue
        if ($browserCommand) {
          $browserPath = $browserCommand.Source
        }
      }
      if ($browserPath) {
        Start-Process -FilePath $browserPath -ArgumentList $Url | Out-Null
        Write-StartupMessage "Opened in $($browser.Name): $Url"
        return
      }
    }
  }

  Start-Process -FilePath $Url | Out-Null
  Write-StartupMessage "Opened in the system browser: $Url"
}

function Stop-ExistingTradingService {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Health,
    [Parameter(Mandatory = $true)]
    [int]$ServicePort,
    [Parameter(Mandatory = $true)]
    [string]$HealthUrl
  )

  if ($Health.name -ne "trading-ai-system") {
    Stop-Startup -Message "Port $ServicePort is occupied by another application." -Details "The existing service was not identified as trading-ai-system, so it was not stopped."
  }

  $existingProcessId = 0
  if ($Health.pid) {
    $existingProcessId = [int]$Health.pid
  } elseif ($isWindowsHost) {
    $listener = Get-NetTCPConnection -LocalPort $ServicePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      $existingProcessId = [int]$listener.OwningProcess
    }
  }

  if ($existingProcessId -le 0) {
    Stop-Startup -Message "The existing trading assistant could not be restarted safely." -Details "No owning process ID was available for port $ServicePort. Close the old launch window and try again."
  }

  try {
    Stop-Process -Id $existingProcessId -Force -ErrorAction Stop
  } catch {
    Stop-Startup -Message "The existing trading assistant could not be stopped." -Details $_.Exception.Message
  }

  for ($i = 0; $i -lt 20; $i += 1) {
    Start-Sleep -Milliseconds 250
    try {
      Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 1 | Out-Null
    } catch {
      Write-StartupMessage "Stopped existing trading assistant process $existingProcessId."
      return
    }
  }

  Stop-Startup -Message "The existing trading assistant did not release port $ServicePort." -Details "Stopped process ID: $existingProcessId"
}

if (-not $env:TRADING_VISIBLE_HISTORY_PATH) {
  if ($isWindowsHost) {
    if (-not $env:LOCALAPPDATA) {
      Stop-Startup -Message "The Windows user data directory is unavailable." -Details "LOCALAPPDATA is empty, so cumulative trading history cannot be stored safely."
    }
    $tradingUserDataRoot = Join-Path $env:LOCALAPPDATA "ElectricTradingAI\data"
  } else {
    $tradingUserDataRoot = Join-Path $root "data"
  }

  try {
    New-Item -ItemType Directory -Path $tradingUserDataRoot -Force | Out-Null
  } catch {
    Stop-Startup -Message "The cumulative trading history directory could not be created." -Details $_.Exception.Message
  }
  $env:TRADING_VISIBLE_HISTORY_PATH = Join-Path $tradingUserDataRoot "ukey-visible-history.json"
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
    Stop-ExistingTradingService -Health $existing -ServicePort $Port -HealthUrl $healthUrl
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
        Open-WorkbenchBrowser -Url $workbenchUrl
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
