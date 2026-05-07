param(
  [int]$Port = 5177,
  [string]$Standard = ""
)

$bundledNode = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$node = if (Test-Path $bundledNode) { $bundledNode } else { "node" }

$argsList = @(
  ".\server.mjs",
  "--port", "$Port"
)

if ($Standard) {
  $argsList += @("--standard", $Standard)
}

& $node @argsList
exit $LASTEXITCODE
