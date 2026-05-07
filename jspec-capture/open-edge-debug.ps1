param(
  [int]$Port = 9222,
  [string]$Url = "https://www.jspec.com.cn/#/dashboard"
)

$edgePaths = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

$edgePath = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edgePath) {
  throw "Microsoft Edge was not found in the default install path."
}

$profileDir = Join-Path $env:LOCALAPPDATA "JspecEdgeDebug"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

Start-Process -FilePath $edgePath -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$profileDir",
  "--new-window",
  $Url
)

Write-Host "Edge started on port $Port."
Write-Host "If the page is not signed in yet, finish the normal login flow in that window."
Write-Host "Then run: .\\run-capture.ps1"
