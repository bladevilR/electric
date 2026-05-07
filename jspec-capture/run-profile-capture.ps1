param(
  [string]$Profile = "Profile 4",
  [string]$UserDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data",
  [string]$PageUrl = "https://www.jspec.com.cn/#/dashboard",
  [string]$OutputDir = ".\output",
  [string]$WorkDir = ".\work",
  [int]$WaitMs = 12000
)

$bundledNodeModules = "C:\Users\R\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"

if (Test-Path $bundledNodeModules) {
  $env:NODE_PATH = $bundledNodeModules
  $env:CODEX_NODE_MODULES = $bundledNodeModules
}

node .\capture-from-profile.mjs --profile $Profile --user-data-dir $UserDataDir --page-url $PageUrl --output-dir $OutputDir --work-dir $WorkDir --wait-ms $WaitMs
exit $LASTEXITCODE
