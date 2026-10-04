param(
  [ValidateSet("standby","active")]
  [string]$Role = "standby",
  [string]$DeviceId = "pc1"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  throw "Python venv not found: $Python"
}

$env:WINDOWS_RUNTIME_ROLE = $Role
$env:WINDOWS_DEVICE_ID = $DeviceId
$env:BOT_REPO_DIR = $Root

Write-Host "Windows runtime: role=$Role device=$DeviceId"
Write-Host "Repository: $Root"
Write-Host "Starting shared-lease runtime..."
& $Python (Join-Path $Root "scripts\windows_runtime.py")
exit $LASTEXITCODE
