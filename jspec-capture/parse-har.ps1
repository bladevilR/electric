param(
  [Parameter(Mandatory = $true)]
  [string]$Har,
  [string]$OutputDir = ".\output"
)

node .\parse-har.mjs --har $Har --output-dir $OutputDir
exit $LASTEXITCODE
