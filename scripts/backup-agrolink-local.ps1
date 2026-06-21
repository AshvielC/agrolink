param(
    [string]$EnvPath = ".\.env",
    [string]$BackupRoot = $env:BACKUP_ROOT,
    [int]$RetentionCount = 0
)

$ErrorActionPreference = "Stop"

if (-not $BackupRoot) {
    $BackupRoot = ".\backups"
}

if ($RetentionCount -le 0) {
    if ($env:BACKUP_RETENTION_COUNT -match '^\d+$') {
        $RetentionCount = [int]$env:BACKUP_RETENTION_COUNT
    } else {
        $RetentionCount = 10
    }
}

function Read-DotEnv {
    param([string]$Path)

    $values = @{}

    if (-not (Test-Path $Path)) {
        return $values
    }

    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()

        if (-not $trimmed -or $trimmed.StartsWith('#')) {
            continue
        }

        $parts = $trimmed -split '=', 2

        if ($parts.Count -ne 2) {
            continue
        }

        $key = $parts[0].Trim()
        $value = $parts[1].Trim()

        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        $values[$key] = $value
    }

    return $values
}

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found in PATH. Install MongoDB Database Tools and restart your terminal."
    }
}

function Write-JsonLine {
    param(
        [string]$Level,
        [string]$Message,
        [hashtable]$Details = @{}
    )

    $entry = [ordered]@{
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
        service = 'AgroLink'
        environment = 'local-backup'
        level = $Level
        message = $Message
    }

    foreach ($key in $Details.Keys) {
        $entry[$key] = $Details[$key]
    }

    Write-Host ($entry | ConvertTo-Json -Compress -Depth 8)
}

function Get-FileSha256 {
    param([string]$Path)

    return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Get-GitCommit {
    try {
        return (git rev-parse HEAD 2>$null).Trim()
    } catch {
        return ''
    }
}

function Remove-OldBackups {
    param(
        [string]$Root,
        [int]$Keep
    )

    if ($Keep -le 0 -or -not (Test-Path $Root)) {
        return
    }

    $oldBackups = Get-ChildItem -Path $Root -Directory -Filter 'agrolink-*' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $Keep

    foreach ($backup in $oldBackups) {
        Remove-Item -Path $backup.FullName -Recurse -Force
        Write-JsonLine -Level 'info' -Message 'Removed old local backup.' -Details @{
            event = 'backup.retention.removed'
            backup = $backup.Name
        }
    }
}

$envValues = Read-DotEnv -Path $EnvPath
$mongoUri = $env:MONGODB_URI

if (-not $mongoUri -and $envValues.ContainsKey('MONGODB_URI')) {
    $mongoUri = $envValues['MONGODB_URI']
}

if (-not $mongoUri) {
    throw 'MONGODB_URI was not found in the environment or .env file.'
}

Require-Command -Name 'mongodump'

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupName = "agrolink-$timestamp"
$backupRootFull = Resolve-Path -Path (New-Item -ItemType Directory -Force -Path $BackupRoot).FullName
$backupDirectory = Join-Path $backupRootFull $backupName
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null

$dbArchive = Join-Path $backupDirectory 'mongodb.archive.gz'
$filesStaging = Join-Path $backupDirectory 'files'
$filesArchive = Join-Path $backupDirectory 'uploads-and-storage.zip'
$manifestPath = Join-Path $backupDirectory 'manifest.json'

Write-JsonLine -Level 'info' -Message 'Starting AgroLink local backup.' -Details @{
    event = 'backup.started'
    backup = $backupName
}

& mongodump --uri $mongoUri --archive=$dbArchive --gzip

if ($LASTEXITCODE -ne 0) {
    throw "mongodump failed with exit code $LASTEXITCODE."
}

$pathsToBackup = @(
    'public/uploads/products',
    'public/uploads/profiles',
    'storage/user-documents',
    'storage/report-evidence'
)

New-Item -ItemType Directory -Force -Path $filesStaging | Out-Null
$includedPaths = @()

foreach ($relativePath in $pathsToBackup) {
    if (Test-Path $relativePath) {
        $destination = Join-Path $filesStaging $relativePath
        $destinationParent = Split-Path -Parent $destination

        New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
        Copy-Item -Path $relativePath -Destination $destinationParent -Recurse -Force
        $includedPaths += $relativePath
    }
}

Compress-Archive -Path (Join-Path $filesStaging '*') -DestinationPath $filesArchive -Force
Remove-Item -Path $filesStaging -Recurse -Force

$manifest = [ordered]@{
    app = 'AgroLink'
    backupName = $backupName
    createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    gitCommit = Get-GitCommit
    database = [ordered]@{
        file = 'mongodb.archive.gz'
        sha256 = Get-FileSha256 -Path $dbArchive
    }
    files = [ordered]@{
        file = 'uploads-and-storage.zip'
        sha256 = Get-FileSha256 -Path $filesArchive
        includedPaths = $includedPaths
    }
    restoreTest = [ordered]@{
        required = $true
        testedAtUtc = $null
        reportFile = $null
    }
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $manifestPath -Encoding UTF8

Remove-OldBackups -Root $backupRootFull -Keep $RetentionCount

Write-JsonLine -Level 'info' -Message 'AgroLink local backup completed.' -Details @{
    event = 'backup.completed'
    backup = $backupName
    path = $backupDirectory
    databaseArchive = 'mongodb.archive.gz'
    fileArchive = 'uploads-and-storage.zip'
    manifest = 'manifest.json'
}
