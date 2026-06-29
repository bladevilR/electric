param(
  [string]$CaptureDir = ".\output\session-YYYYMMDD-HHMMSS",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$argsList = @(
  (Join-Path $scriptDir "index-session.mjs"),
  "--capture-dir",
  $CaptureDir
)

if ($OutputDir) {
  $argsList += @("--output-dir", $OutputDir)
}

node @argsList
