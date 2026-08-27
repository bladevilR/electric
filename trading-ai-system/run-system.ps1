param(
  [int]$Port = 5177,
  [string]$Standard = ""
)

$portableNode = Join-Path $PSScriptRoot "runtime\node\node.exe"
$node = if (Test-Path $portableNode) { $portableNode } else { "node" }

$argsList = @(
  ".\server.mjs",
  "--port", "$Port"
)

if ($Standard) {
  $argsList += @("--standard", $Standard)
}

& $node @argsList
exit $LASTEXITCODE
