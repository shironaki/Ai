$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$HostScript = Join-Path $Root "scripts\windows_host.ps1"
$TaskName = "Ai Windows Runtime (pc1)"

if (-not (Test-Path $HostScript)) {
    throw "Windows host script not found: $HostScript"
}

$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Argument = '-NoProfile -ExecutionPolicy Bypass -File "' + $HostScript + '" -Role standby -DeviceId pc1'
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Argument
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Starts the Ai Windows standby runtime at Windows logon." -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Role: standby"
Write-Host "Device: pc1"
Write-Host "Entry point: $HostScript"
