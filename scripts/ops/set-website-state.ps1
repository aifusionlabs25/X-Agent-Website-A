[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('offline', 'online')]
    [string]$State,

    [switch]$DryRun,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ProjectRoot = 'C:\AI Fusion Labs\X AGENTS\REPOS\x-agent-website-a'
$Scope = 'robs-projects-e72bad73'
$SiteUrl = 'https://xagent.aifusionlabs.app'
$MaintenanceVariable = 'MAINTENANCE_MODE'
$MaintenanceMarker = 'System Upgrade in Progress'
$DesiredValue = if ($State -eq 'offline') { 'true' } else { 'false' }
$ActionLabel = if ($State -eq 'offline') { 'TAKE THE WEBSITE OFFLINE' } else { 'RESTORE THE WEBSITE' }
$ExpectedDescription = if ($State -eq 'offline') { 'the maintenance screen' } else { 'the live X Agents homepage' }
$LogDirectory = Join-Path $env:LOCALAPPDATA 'AI Fusion Labs\X Agents Website Control'
$LogPath = Join-Path $LogDirectory 'website-control.log'

function Write-ControlLog {
    param([string]$Message)

    if (-not (Test-Path -LiteralPath $LogDirectory)) {
        New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    }

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
    Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message"
}

function Pause-BeforeExit {
    if (-not $NoPause) {
        Write-Host ''
        [void](Read-Host 'Press Enter to close')
    }
}

function Stop-WithMessage {
    param([string]$Message)

    Write-Host ''
    Write-Host $Message -ForegroundColor Red
    Write-ControlLog "FAILED: $Message"
    Pause-BeforeExit
    exit 1
}

function Get-PublicSiteState {
    try {
        $request = [System.Net.HttpWebRequest]::Create($SiteUrl)
        $request.AllowAutoRedirect = $true
        $request.Timeout = 15000
        $request.UserAgent = 'AI-Fusion-Labs-Website-Control/1.0'
        $response = $request.GetResponse()
    }
    catch [System.Net.WebException] {
        if ($null -eq $_.Exception.Response) {
            return [pscustomobject]@{
                StatusCode = 0
                IsMaintenance = $false
                Error = $_.Exception.Message
            }
        }

        $response = $_.Exception.Response
    }

    try {
        $statusCode = [int]$response.StatusCode
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        try {
            $body = $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }

        return [pscustomobject]@{
            StatusCode = $statusCode
            IsMaintenance = $body.Contains($MaintenanceMarker)
            Error = $null
        }
    }
    finally {
        $response.Dispose()
    }
}

Clear-Host
Write-Host 'X AGENTS WEBSITE CONTROL' -ForegroundColor Cyan
Write-Host '========================' -ForegroundColor DarkGray
Write-Host ''
Write-Host "Site:   $SiteUrl"
Write-Host "Action: $ActionLabel" -ForegroundColor $(if ($State -eq 'offline') { 'Yellow' } else { 'Green' })
Write-Host ''

if ($DryRun) {
    Write-Host 'DRY RUN ONLY - no Vercel setting or deployment will be changed.' -ForegroundColor Yellow
    Write-Host "Would set $MaintenanceVariable=$DesiredValue in Production."
    Write-Host 'Would rebuild the current production deployment and verify the public URL.'
    Write-ControlLog "Dry run completed for requested state '$State'."
    Pause-BeforeExit
    exit 0
}

$confirmationWord = if ($State -eq 'offline') { 'OFFLINE' } else { 'RESTORE' }
Write-Host "This will deploy $ExpectedDescription to the public website." -ForegroundColor Yellow
$confirmation = Read-Host "Type $confirmationWord to continue"

if ($confirmation -cne $confirmationWord) {
    Write-Host ''
    Write-Host 'Cancelled. The website was not changed.' -ForegroundColor DarkYellow
    Write-ControlLog "Cancelled requested state '$State'."
    Pause-BeforeExit
    exit 0
}

if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Stop-WithMessage 'Vercel CLI is not installed or is not available in PATH.'
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.vercel\project.json'))) {
    Stop-WithMessage "The expected Vercel project link was not found at $ProjectRoot\.vercel\project.json."
}

Write-ControlLog "Requested production state '$State'."
Write-Host ''
Write-Host '1/3 Updating the production safety switch...' -ForegroundColor Cyan
$DesiredValue | & vercel env update $MaintenanceVariable production --yes --scope $Scope --cwd $ProjectRoot --no-color
if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage 'Vercel did not accept the maintenance-mode update. The website was not redeployed.'
}

Write-Host ''
Write-Host '2/3 Rebuilding the current production deployment...' -ForegroundColor Cyan
& vercel redeploy $SiteUrl --target production --scope $Scope --cwd $ProjectRoot --no-color
if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "The production redeploy failed after the setting changed. Run the RESTORE shortcut if the requested state appears later. Log: $LogPath"
}

Write-Host ''
Write-Host '3/3 Verifying the public website...' -ForegroundColor Cyan
$verified = $false
$lastResult = $null

for ($attempt = 1; $attempt -le 18; $attempt++) {
    $lastResult = Get-PublicSiteState
    $verified = if ($State -eq 'offline') {
        $lastResult.StatusCode -eq 503 -and $lastResult.IsMaintenance
    }
    else {
        $lastResult.StatusCode -ge 200 -and $lastResult.StatusCode -lt 500 -and -not $lastResult.IsMaintenance
    }

    if ($verified) {
        break
    }

    Write-Host "Waiting for the production domain to update ($attempt/18)..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 5
}

if (-not $verified) {
    $observed = if ($null -eq $lastResult) { 'no response' } else { "HTTP $($lastResult.StatusCode), maintenance=$($lastResult.IsMaintenance)" }
    Stop-WithMessage "Deployment finished, but public verification did not reach the expected state. Observed: $observed. Check $SiteUrl and use the RESTORE shortcut if needed."
}

$successMessage = if ($State -eq 'offline') {
    'SUCCESS: The public website is now showing the maintenance screen.'
}
else {
    'SUCCESS: The public X Agents website is back online.'
}

Write-Host ''
Write-Host $successMessage -ForegroundColor Green
Write-Host $SiteUrl -ForegroundColor Cyan
Write-ControlLog "$successMessage Verified HTTP $($lastResult.StatusCode)."
Pause-BeforeExit

