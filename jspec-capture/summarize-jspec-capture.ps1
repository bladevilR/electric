param(
  [Parameter(Mandatory = $true)]
  [string]$CaptureDir,
  [string]$OutputDir = ""
)

$bundledNode = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledNodeModules = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"

if (Test-Path $bundledNodeModules) {
  $env:NODE_PATH = $bundledNodeModules
  $env:CODEX_NODE_MODULES = $bundledNodeModules
}

$node = if (Test-Path $bundledNode) { $bundledNode } else { "node" }

$argsList = @(
  ".\summarize-jspec-capture.mjs",
  "--capture-dir", $CaptureDir
)

if ($OutputDir) {
  $argsList += @("--output-dir", $OutputDir)
}

& $node @argsList
exit $LASTEXITCODE
