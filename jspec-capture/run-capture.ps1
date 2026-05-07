param(
  [string]$DebugUrl = "http://127.0.0.1:9222",
  [string]$PageUrl = "https://www.jspec.com.cn/#/dashboard",
  [string]$OutputDir = ".\output",
  [int]$WaitMs = 8000
)

$bundledNodeModules = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"

if (Test-Path $bundledNodeModules) {
  $env:NODE_PATH = $bundledNodeModules
  $env:CODEX_NODE_MODULES = $bundledNodeModules
}

node .\capture-dashboard.mjs --debug-url $DebugUrl --page-url $PageUrl --output-dir $OutputDir --wait-ms $WaitMs
exit $LASTEXITCODE
