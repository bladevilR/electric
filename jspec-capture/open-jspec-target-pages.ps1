param(
  [string]$Targets = "actual_load_96,settle_day",
  [string]$DebugUrl = "http://127.0.0.1:9333",
  [int]$WaitMs = 60000
)

$ErrorActionPreference = "Stop"

$node = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (!(Test-Path $node)) {
  $node = "node"
}

& $node "$PSScriptRoot\open-jspec-target-pages.mjs" `
  --targets $Targets `
  --debug-url $DebugUrl `
  --wait-ms $WaitMs
