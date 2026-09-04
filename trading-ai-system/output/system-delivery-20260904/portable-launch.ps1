param([int]$Port=5301,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$deliveryRoot=$PSScriptRoot
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
$logRoot=Join-Path $deliveryRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
while(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue){$Port++}
$nodeExe=Join-Path $deliveryRoot 'runtime\node\node.exe'
$serverProcess=Start-Process -FilePath $nodeExe -ArgumentList @('--no-warnings','server.mjs','--port',"$Port") -WorkingDirectory $deliveryRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'server.stdout.log') -RedirectStandardError (Join-Path $logRoot 'server.stderr.log')
$ready=$false
for($attempt=0;$attempt -lt 40;$attempt++){
 try{$response=Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2;if($response.StatusCode -eq 200){$ready=$true;break}}catch{}
 if($serverProcess.HasExited){break};Start-Sleep -Milliseconds 500
}
if(-not $ready){throw '启动失败，请查看 logs 文件夹中的错误日志。'}
$url="http://127.0.0.1:$Port/?view=data-sources&date=2026-02-03&dimension=price&v=delivery-20260904"
if(-not $NoBrowser){Start-Process $url}
Write-Output "服务已启动：$url"
Write-Output "进程编号：$($serverProcess.Id)"
