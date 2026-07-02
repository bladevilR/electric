param(
  [int]$Port = 5177,
  [string]$Standard = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$portableNode = Join-Path $root "runtime\node\node.exe"
$bundledNode = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$node = if (Test-Path $portableNode) { $portableNode } elseif (Test-Path $bundledNode) { $bundledNode } else { "node" }
$workbenchUrl = "http://127.0.0.1:$Port/"
$healthUrl = "http://127.0.0.1:$Port/api/health"

try {
  $existing = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
  if ($existing.ok) {
    Start-Process -FilePath $workbenchUrl | Out-Null
    Write-Host "Already running: $workbenchUrl"
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
  $server = Start-Process -FilePath $node -ArgumentList $argsList -WorkingDirectory $root -WindowStyle Hidden -PassThru
} catch {
  Write-Host ""
  Write-Host "Startup failed: Node runtime was not found."
  Write-Host "Please unzip the whole package first and make sure runtime\\node\\node.exe exists."
  Write-Host "You can also install Node.js on this computer."
  Write-Host $_.Exception.Message
  pause
  exit 1
}

for ($i = 0; $i -lt 60; $i += 1) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
    if ($health.ok) {
      Start-Process -FilePath $workbenchUrl | Out-Null
      Write-Host "Started: $workbenchUrl"
      Write-Host "You may close this window. The background service will keep running."
      exit 0
    }
  } catch {
    if ($server.HasExited) {
      break
    }
  }
}

Write-Host ""
Write-Host "Startup did not complete. Browser cannot connect to 127.0.0.1:$Port yet."
Write-Host "Please check:"
Write-Host "1. The package was fully unzipped before running."
Write-Host "2. runtime\\node\\node.exe exists, or Node.js is installed."
Write-Host "3. Port 5177 is not occupied by another program."
Write-Host "4. Windows security software did not block node.exe or PowerShell."
Write-Host ""
Write-Host "You can send this window text to support."
pause
exit 1
