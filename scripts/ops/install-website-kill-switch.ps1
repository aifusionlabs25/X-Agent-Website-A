[CmdletBinding()]
param(
    [string]$SourceScript
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourceScript)) {
    $SourceScript = Join-Path $PSScriptRoot 'set-website-state.ps1'
}

$InstallDirectory = Join-Path $env:LOCALAPPDATA 'AI Fusion Labs\X Agents Website Control'
$InstalledScript = Join-Path $InstallDirectory 'set-website-state.ps1'
$DesktopDirectory = [Environment]::GetFolderPath('Desktop')
$PowerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path -LiteralPath $SourceScript)) {
    throw "Control script not found: $SourceScript"
}

New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
Copy-Item -LiteralPath $SourceScript -Destination $InstalledScript -Force

$shell = New-Object -ComObject WScript.Shell

$shortcuts = @(
    @{
        Name = 'X Agents Website - TAKE OFFLINE.lnk'
        State = 'offline'
        Description = 'Show the emergency maintenance page on xagent.aifusionlabs.app'
        IconIndex = 131
    },
    @{
        Name = 'X Agents Website - RESTORE ONLINE.lnk'
        State = 'online'
        Description = 'Restore the public X Agents website'
        IconIndex = 167
    }
)

foreach ($item in $shortcuts) {
    $shortcutPath = Join-Path $DesktopDirectory $item.Name
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $PowerShellPath
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$InstalledScript`" -State $($item.State)"
    $shortcut.WorkingDirectory = $InstallDirectory
    $shortcut.Description = $item.Description
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,$($item.IconIndex)"
    $shortcut.Save()
}

Write-Host "Installed website controls in: $InstallDirectory"
Write-Host "Created desktop shortcuts in: $DesktopDirectory"

