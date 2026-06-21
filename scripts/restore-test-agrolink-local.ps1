param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [string]$EnvPath = ".\.env",
    [string]$TestMongoUri = $env:RESTORE_TEST_MONGODB_URI,
    [string]$RestoreRoot = ".\restore-test-output"
)

$ErrorActionPreference = "Stop"

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
        environment = 'local-restore-test'
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

function Get-DatabaseNameFromMongoUri {
    param([string]$Uri)

    $withoutQuery = ($Uri -split '\?', 2)[0]
    $lastSlash = $withoutQuery.LastIndexOf('/')

    if ($lastSlash -lt 0 -or $lastSlash -eq ($withoutQuery.Length - 1)) {
        return ''
    }

    return [Uri]::UnescapeDataString($withoutQuery.Substring($lastSlash + 1))
}

function Assert-SafeRestoreUri {
    param(
        [string]$ProductionUri,
        [string]$RestoreUri
    )

    if (-not $RestoreUri) {
        throw 'RESTORE_TEST_MONGODB_URI is required. It must point to a separate test database.'
    }

    if ($ProductionUri -and $RestoreUri -eq $ProductionUri) {
        throw 'RESTORE_TEST_MONGODB_URI must not equal MONGODB_URI.'
    }

    $restoreDbName = Get-DatabaseNameFromMongoUri -Uri $RestoreUri

    if (-not $restoreDbName) {
        throw 'RESTORE_TEST_MONGODB_URI must include an explicit database name such as agrolink_restore_test.'
    }

    if ($restoreDbName -notmatch '(?i)(test|restore|sandbox)') {
        throw "Refusing to restore into database '$restoreDbName'. Use a database name containing test, restore, or sandbox."
    }
}

$envValues = Read-DotEnv -Path $EnvPath
$productionMongoUri = $env:MONGODB_URI

if (-not $productionMongoUri -and $envValues.ContainsKey('MONGODB_URI')) {
    $productionMongoUri = $envValues['MONGODB_URI']
}

if (-not $TestMongoUri -and $envValues.ContainsKey('RESTORE_TEST_MONGODB_URI')) {
    $TestMongoUri = $envValues['RESTORE_TEST_MONGODB_URI']
}

Assert-SafeRestoreUri -ProductionUri $productionMongoUri -RestoreUri $TestMongoUri
Require-Command -Name 'mongorestore'

$backupDirectory = Resolve-Path -Path $BackupPath
$manifestPath = Join-Path $backupDirectory 'manifest.json'
$dbArchive = Join-Path $backupDirectory 'mongodb.archive.gz'
$filesArchive = Join-Path $backupDirectory 'uploads-and-storage.zip'

if (-not (Test-Path $manifestPath)) {
    throw "manifest.json was not found in $backupDirectory."
}

if (-not (Test-Path $dbArchive)) {
    throw "mongodb.archive.gz was not found in $backupDirectory."
}

if (-not (Test-Path $filesArchive)) {
    throw "uploads-and-storage.zip was not found in $backupDirectory."
}

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json

if ((Get-FileSha256 -Path $dbArchive) -ne $manifest.database.sha256) {
    throw 'Database archive SHA-256 hash does not match manifest.json.'
}

if ((Get-FileSha256 -Path $filesArchive) -ne $manifest.files.sha256) {
    throw 'Files archive SHA-256 hash does not match manifest.json.'
}

$testName = "restore-test-$($manifest.backupName)-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$restoreDirectory = Join-Path (Resolve-Path -Path (New-Item -ItemType Directory -Force -Path $RestoreRoot).FullName) $testName
New-Item -ItemType Directory -Force -Path $restoreDirectory | Out-Null

Write-JsonLine -Level 'info' -Message 'Starting AgroLink restore test.' -Details @{
    event = 'restore_test.started'
    backup = $manifest.backupName
    restoreDirectory = $restoreDirectory
}

& mongorestore --uri $TestMongoUri --archive=$dbArchive --gzip --drop

if ($LASTEXITCODE -ne 0) {
    throw "mongorestore failed with exit code $LASTEXITCODE."
}

Expand-Archive -Path $filesArchive -DestinationPath $restoreDirectory -Force

$fileCount = (Get-ChildItem -Path $restoreDirectory -Recurse -File | Measure-Object).Count
$reportPath = Join-Path $backupDirectory 'restore-test-report.json'

$report = [ordered]@{
    app = 'AgroLink'
    backupName = $manifest.backupName
    testedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    status = 'passed'
    restoredDatabaseName = Get-DatabaseNameFromMongoUri -Uri $TestMongoUri
    restoredFilesDirectory = $restoreDirectory
    restoredFileCount = $fileCount
}

$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

$manifest.restoreTest.testedAtUtc = $report.testedAtUtc
$manifest.restoreTest.reportFile = 'restore-test-report.json'
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $manifestPath -Encoding UTF8

Write-JsonLine -Level 'info' -Message 'AgroLink restore test completed.' -Details @{
    event = 'restore_test.completed'
    backup = $manifest.backupName
    status = 'passed'
    report = $reportPath
    restoredFileCount = $fileCount
}
