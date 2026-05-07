param(
  [string]$DebugUrl = "http://127.0.0.1:9333",
  [string]$OutputDir = ".\output",
  [int]$DurationMinutes = 30,
  [switch]$All,
  [switch]$NoOpenDashboard
)

$bundledNode = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledNodeModules = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"

if (Test-Path $bundledNodeModules) {
  $env:NODE_PATH = $bundledNodeModules
  $env:CODEX_NODE_MODULES = $bundledNodeModules
}

$node = if (Test-Path $bundledNode) { $bundledNode } else { "node" }
$durationMs = $DurationMinutes * 60 * 1000

$argsList = @(
  ".\capture-jspec-session.mjs",
  "--debug-url", $DebugUrl,
  "--output-dir", $OutputDir,
  "--duration-ms", $durationMs
)

if ($All) {
  $argsList += "--all"
}

if ($NoOpenDashboard) {
  $argsList += "--no-open-dashboard"
}

& $node @argsList
exit $LASTEXITCODE
