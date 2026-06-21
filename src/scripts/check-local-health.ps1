param(
    [string]$BaseUrl = "https://localhost:3443",
    [string]$LogPath = ".\logs\local-health-monitor.log"
)

$ErrorActionPreference = "Stop"

$logDirectory = Split-Path -Parent $LogPath

if ($logDirectory -and -not (Test-Path $logDirectory)) {
    New-Item `
        -ItemType Directory `
        -Path $logDirectory `
        -Force | Out-Null
}

function Write-HealthLog {
    param(
        [string]$Level,
        [string]$Message,
        [hashtable]$Details = @{}
    )

    $entry = [ordered]@{
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        level     = $Level
        event     = "local.health_check"
        message   = $Message
    }

    foreach ($key in $Details.Keys) {
        $entry[$key] = $Details[$key]
    }

    $json = $entry | ConvertTo-Json -Compress

    Add-Content `
        -Path $LogPath `
        -Value $json

    Write-Host $json
}

function Test-HealthEndpoint {
    param(
        [string]$Name,
        [string]$Path
    )

    $url = "$BaseUrl$Path"

    try {
        $response = Invoke-WebRequest `
            -Uri $url `
            -Method Get `
            -TimeoutSec 10 `
            -UseBasicParsing

        if ($response.StatusCode -ne 200) {
            throw "Unexpected HTTP status $($response.StatusCode)"
        }

        Write-HealthLog `
            -Level "info" `
            -Message "$Name endpoint is healthy." `
            -Details @{
                endpoint   = $Path
                url        = $url
                statusCode = $response.StatusCode
            }

        return $true
    }
    catch {
        Write-HealthLog `
            -Level "error" `
            -Message "$Name endpoint failed." `
            -Details @{
                endpoint = $Path
                url      = $url
                error    = $_.Exception.Message
            }

        return $false
    }
}

$livenessOk = Test-HealthEndpoint `
    -Name "Liveness" `
    -Path "/healthz"

$readinessOk = Test-HealthEndpoint `
    -Name "Readiness" `
    -Path "/readyz"

if (-not $livenessOk -or -not $readinessOk) {
    Write-Warning "AgroLink local health check failed."
    exit 1
}

Write-Host "AgroLink local health check passed."
exit 0