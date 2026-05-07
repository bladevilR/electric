param(
  [int]$Port = 9333,
  [string]$Url = "https://www.jspec.com.cn/#/dashboard"
)

$chromePaths = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

$chromePath = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromePath) {
  throw "Google Chrome was not found in the default install path."
}

$profileDir = Join-Path $env:LOCALAPPDATA "JspecChromeDebug"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$profileDir",
  "--new-window",
  $Url
)

Write-Host "Chrome started on port $Port."
Write-Host "If the page is not signed in yet, finish the normal login flow in that window."
Write-Host "For one-shot dashboard capture: .\\run-capture.ps1 -DebugUrl http://127.0.0.1:$Port"
Write-Host "For JSPEC platform data capture: .\\run-jspec-session.ps1 -DebugUrl http://127.0.0.1:$Port"
