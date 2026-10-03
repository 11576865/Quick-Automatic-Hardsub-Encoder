# Local compression evidence persistence for Windows Native.
# The store is intentionally local-only and contains no full source paths.

$script:CompressionHistorySchemaVersion = 1
$script:CompressionHistoryMaxRecords = 500

function Get-CompressionHistoryPath {
    $base = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($base)) { $base = $env:TEMP }
    $dir = Join-Path $base 'QuickAutomaticHardsubEncoder'
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $dir -Force)
    }
    return Join-Path $dir 'compression-history-v1.json'
}

function New-EmptyCompressionHistory {
    return [ordered]@{
        schemaVersion = $script:CompressionHistorySchemaVersion
        records = @()
    }
}

function Read-CompressionHistory {
    $path = Get-CompressionHistoryPath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return New-EmptyCompressionHistory
    }

    try {
        $root = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([int]$root.schemaVersion -ne $script:CompressionHistorySchemaVersion) {
            return New-EmptyCompressionHistory
        }
        return [ordered]@{
            schemaVersion = $script:CompressionHistorySchemaVersion
            records = @($root.records | Where-Object { $_ })
        }
    } catch {
        try {
            $backup = $path + '.corrupt-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            Move-Item -LiteralPath $path -Destination $backup -Force
        } catch {}
        return New-EmptyCompressionHistory
    }
}

function Write-CompressionHistory($Root) {
    $path = Get-CompressionHistoryPath
    $temp = $path + '.tmp'
    $json = $Root | ConvertTo-Json -Depth 12 -Compress
    [IO.File]::WriteAllText($temp, $json, (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try {
            [IO.File]::Replace($temp, $path, $null)
            return
        } catch {}
    }
    Move-Item -LiteralPath $temp -Destination $path -Force
}

function Add-CompressionHistoryRecord($Record) {
    $root = Read-CompressionHistory
    $records = @($root.records)
    $start = [Math]::Max(0, $records.Count - ($script:CompressionHistoryMaxRecords - 1))
    $trimmed = New-Object 'System.Collections.Generic.List[object]'
    for ($i = $start; $i -lt $records.Count; $i++) {
        if ($records[$i]) { $trimmed.Add($records[$i]) }
    }

    if (-not $Record.evidenceVersion) { $Record.evidenceVersion = 1 }
    $Record.recordedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $trimmed.Add($Record)

    Write-CompressionHistory ([ordered]@{
        schemaVersion = $script:CompressionHistorySchemaVersion
        records = @($trimmed.ToArray())
    })
    return [long]$Record.recordedAt
}

function Get-CompressionHistorySnapshot {
    $root = Read-CompressionHistory
    return [pscustomobject]@{
        schemaVersion = [int]$root.schemaVersion
        count = @($root.records).Count
        records = [object[]]@($root.records)
    }
}

function Add-ClientCompressionEvidence($InputRecord) {
    if (-not $InputRecord) { throw 'Compression evidence record is missing.' }
    $kind = [string]$InputRecord.evidenceKind
    if ($kind -notin @('quality-sample','manual-sample')) {
        throw 'Unsupported compression evidence kind.'
    }
    $sourceIdentity = [string]$InputRecord.sourceIdentity
    if ($sourceIdentity -cnotmatch '^src-[0-9a-f]{8}$') {
        throw 'Invalid source evidence identity.'
    }

    $allowed = @(
        'evidenceVersion','evidenceKind','evidenceScope','sourceIdentity','runtimeIdentity',
        'backend','codec','preset','crf','targetSsim','ssim','averageSsim',
        'sampleBitrate','averageSpeed','sampleCount','sampleMeasurements','testedCrfs','width',
        'height','fps','sourceCodec','sourcePixelFormat','sourceVideoBitrate',
        'duration'
    )
    $record = [ordered]@{}
    foreach ($key in $allowed) {
        $property = $InputRecord.PSObject.Properties[$key]
        if ($property -and $null -ne $property.Value) {
            $record[$key] = $property.Value
        }
    }
    $record.evidenceKind = $kind
    $record.evidenceScope = if($kind -eq 'quality-sample'){'observation'}else{'source'}
    $record.sourceIdentity = $sourceIdentity
    $record.backend = 'windows-native'
    $recordedAt = Add-CompressionHistoryRecord $record
    $snapshot = Get-CompressionHistorySnapshot
    $snapshot | Add-Member -NotePropertyName ok -NotePropertyValue $true -Force
    $snapshot | Add-Member -NotePropertyName recordedAt -NotePropertyValue $recordedAt -Force
    return $snapshot
}
