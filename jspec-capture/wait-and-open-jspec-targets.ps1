param(
  [string]$Targets = "user_bid_96,user_default_bid_96,dayahead_user_clearing,dayahead_public_clearing,realtime_public_clearing,realtime_average_price,actual_load_96,settle_day",
  [string]$DebugUrl = "http://127.0.0.1:9333",
  [int]$WaitMs = 60000,
  [int]$TimeoutMinutes = 30
)

$ErrorActionPreference = "Stop"

$node = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (!(Test-Path $node)) {
  $node = "node"
}

& $node "$PSScriptRoot\wait-and-open-jspec-targets.mjs" `
  --targets $Targets `
  --debug-url $DebugUrl `
  --wait-ms $WaitMs `
  --timeout-ms ($TimeoutMinutes * 60 * 1000)

exit $LASTEXITCODE
