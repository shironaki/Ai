$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$HostScript = Join-Path $Root "scripts\windows_host.ps1"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$ValueName = "Ai Windows Runtime (pc1)"

if (-not (Test-Path $HostScript)) {
    throw "Windows host script not found: $HostScript"
}

$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Command = '"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Role active -DeviceId pc1' -f $PowerShell, $HostScript

New-Item -Path $RunKey -Force | Out-Null
New-ItemProperty -Path $RunKey -Name $ValueName -Value $Command -PropertyType String -Force | Out-Null

Write-Host "Installed user logon autostart: $ValueName"
Write-Host "Role: active"
Write-Host "Device: pc1"
Write-Host "Entry point: $HostScript"
Write-Host "No administrator privileges required."
