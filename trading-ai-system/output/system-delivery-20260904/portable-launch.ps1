param([int]$Port=5301,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$deliveryRoot=$PSScriptRoot
$logRoot=Join-Path $deliveryRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$startupLog=Join-Path $logRoot 'startup.log'

function Write-Log($msg) {
  $timestamp=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "[$timestamp] $msg" | Out-File -LiteralPath $startupLog -Append -Encoding utf8
  Write-Output $msg
}

Write-Log "Initializing Electric Trading AI System..."

$snapshotRoot=Join-Path $deliveryRoot 'data\runtime-snapshot'
$env:TRADING_EVIDENCE_STORE_PATH=Join-Path $snapshotRoot 'trading-evidence.sqlite'
$env:TRADING_VISIBLE_HISTORY_PATH=Join-Path $snapshotRoot 'ukey-visible-history.json'
$env:TRADING_POINT_IN_TIME_STORE_PATH=Join-Path $snapshotRoot 'point-in-time-facts.json'
$env:TRADING_FORECAST_LEDGER_PATH=Join-Path $snapshotRoot 'forecast-ledger.json'
$env:TRADING_OUTCOME_LEDGER_PATH=Join-Path $snapshotRoot 'outcome-ledger.json'
$env:TRADING_LOCAL_LOAD_HISTORY_PATH=Join-Path $snapshotRoot 'local-load-history.json'
$env:TRADING_COLLECTOR_PROFILE_PATH=Join-Path $snapshotRoot 'browser-profile'
$env:TRADING_COLLECTOR_OWNER_STATE=Join-Path $snapshotRoot 'collector-owner.json'
$env:TRADING_COLLECTOR_QUERY_DELAY_MS='45000'
$env:TRADING_CODE_COMMIT_SHA='delivery-20260904-working-copy'

$nodeExe=Join-Path $deliveryRoot 'runtime\node\node.exe'
if(-not (Test-Path -LiteralPath $nodeExe)){
  $nodeCmd=Get-Command 'node' -ErrorAction SilentlyContinue
  if($nodeCmd){
    $nodeExe=$nodeCmd.Source
    Write-Log "Using system Node: $nodeExe"
  } else {
    Write-Log "ERROR: Node runtime not found at $nodeExe"
    exit 1
  }
}

while(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue){$Port++}
Write-Log "Selected port: $Port"

$serverStdout=Join-Path $logRoot 'server.stdout.log'
$serverStderr=Join-Path $logRoot 'server.stderr.log'

$serverProcess=Start-Process -FilePath $nodeExe -ArgumentList @('--no-warnings','server.mjs','--port',"$Port") -WorkingDirectory $deliveryRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $serverStdout -RedirectStandardError $serverStderr

Write-Log "Process launched. PID: $($serverProcess.Id). Health checking..."

$ready=$false
for($attempt=0;$attempt -lt 40;$attempt++){
  try{
    $response=Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
    if($response.StatusCode -eq 200){$ready=$true;break}
  }catch{}
  if($serverProcess.HasExited){
    Write-Log "Server process exited prematurely with code $($serverProcess.ExitCode)."
    break
  }
  Start-Sleep -Milliseconds 500
}

if(-not $ready){
  Write-Log "ERROR: Startup verification timed out. Please check server.stderr.log."
  exit 1
}

$url="http://127.0.0.1:$Port/?view=data-sources&date=2026-02-03&dimension=price&v=delivery-20260904"
if(-not $NoBrowser){
  Start-Process $url
}

Write-Log "System started successfully."
Write-Log "URL: $url"
Write-Log "Process ID: $($serverProcess.Id)"

