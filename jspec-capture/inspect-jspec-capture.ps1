param(
  [string]$CaptureDir = ".",
  [string]$OutputDir = ""
)

$bundledNode = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$node = if (Test-Path $bundledNode) { $bundledNode } else { "node" }

$argsList = @(
  ".\inspect-jspec-capture.mjs",
  "--capture-dir", $CaptureDir
)

if ($OutputDir) {
  $argsList += @("--output-dir", $OutputDir)
}

& $node @argsList
exit $LASTEXITCODE
