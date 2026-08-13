param(
  [int]$Port = 5177,
  [string]$Standard = ""
)

$portableNode = Join-Path $PSScriptRoot "runtime\node\node.exe"
$bundledNode = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$node = if (Test-Path $portableNode) { $portableNode } elseif (Test-Path $bundledNode) { $bundledNode } else { "node" }

$argsList = @(
  ".\server.mjs",
  "--port", "$Port"
)

if ($Standard) {
  $argsList += @("--standard", $Standard)
}

& $node @argsList
exit $LASTEXITCODE
