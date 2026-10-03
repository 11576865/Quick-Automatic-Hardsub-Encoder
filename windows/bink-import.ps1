function Quote-BinkImportArg([string]$Value) {
    if ($null -eq $Value) { return '""' }
    return '"' + ($Value -replace '"', '\\"') + '"'
}

function Test-Bink2File([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $stream = [IO.File]::OpenRead($Path)
        try {
            if ($stream.Length -lt 4) { return $false }
            $bytes = New-Object byte[] 4
            [void]$stream.Read($bytes, 0, 4)
            $magic = [Text.Encoding]::ASCII.GetString($bytes)
            return $magic.StartsWith('KB2', [StringComparison]::Ordinal)
        } finally {
            $stream.Dispose()
        }
    } catch {
        return $false
    }
}

function Find-RadVideoConverter([string]$Root = '') {
    $candidates = New-Object System.Collections.Generic.List[object]

    $add = {
        param([string]$Path, [string]$Source)
        if (-not $Path) { return }
        try {
            $full = [IO.Path]::GetFullPath($Path)
        } catch {
            return
        }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return }
        $name = [IO.Path]::GetFileName($full).ToLowerInvariant()
        if ($name -notin @('radvideo64.exe', 'binkconv.exe')) { return }
        $mode = if ($name -eq 'radvideo64.exe') { 'radvideo64' } else { 'binkconv' }
        if (-not @($candidates | Where-Object { $_.Path -eq $full }).Count) {
            $candidates.Add([pscustomobject]@{
                Path = $full
                Mode = $mode
                Source = $Source
                Label = if ($mode -eq 'radvideo64') { 'RAD Video Tools · radvideo64.exe' } else { 'RAD Video Tools · binkconv.exe' }
            })
        }
    }

    if ($env:RADVIDEO64) { & $add $env:RADVIDEO64 'RADVIDEO64' }

    if ($env:RADVIDEO_HOME) {
        & $add (Join-Path $env:RADVIDEO_HOME 'radvideo64.exe') 'RADVIDEO_HOME'
        & $add (Join-Path $env:RADVIDEO_HOME 'binkconv.exe') 'RADVIDEO_HOME'
    }

    if ($Root) {
        & $add (Join-Path $Root 'tools\radvideo\radvideo64.exe') 'project-tools'
        & $add (Join-Path $Root 'tools\radvideo\binkconv.exe') 'project-tools'
        $repoRoot = Split-Path -Parent $Root
        if ($repoRoot) {
            & $add (Join-Path $repoRoot 'tools\radvideo\radvideo64.exe') 'project-tools'
            & $add (Join-Path $repoRoot 'tools\radvideo\binkconv.exe') 'project-tools'
        }
    }

    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $base) { continue }
        foreach ($dir in @('RADVideo', 'RAD Video Tools', 'RAD Game Tools')) {
            & $add (Join-Path (Join-Path $base $dir) 'radvideo64.exe') 'installed'
            & $add (Join-Path (Join-Path $base $dir) 'binkconv.exe') 'installed'
        }
    }

    foreach ($commandName in @('radvideo64.exe', 'binkconv.exe')) {
        try {
            $command = Get-Command $commandName -ErrorAction Stop | Select-Object -First 1
            if ($command -and $command.Source) { & $add $command.Source 'PATH' }
        } catch {}
    }

    return @($candidates)[0]
}

function Get-RadBinkConvertArguments($Converter, [string]$InputPath, [string]$OutputPath) {
    if (-not $Converter -or -not $Converter.Path) { throw 'RAD Video Tools converter is unavailable.' }
    if (-not $InputPath -or -not $OutputPath) { throw 'Bink import paths are incomplete.' }

    $input = Quote-BinkImportArg $InputPath
    $output = Quote-BinkImportArg $OutputPath
    if ($Converter.Mode -eq 'radvideo64') {
        return 'binkconv ' + $input + ' ' + $output + ' /#'
    }
    if ($Converter.Mode -eq 'binkconv') {
        return $input + ' ' + $output + ' /#'
    }
    throw 'Unsupported RAD Video Tools converter mode.'
}

function Get-Bink2ImportCapability([string]$Path, [string]$Root = '') {
    $isBink2 = Test-Bink2File $Path
    $converter = if ($isBink2) { Find-RadVideoConverter $Root } else { $null }
    return [pscustomobject]@{
        isBink2 = [bool]$isBink2
        available = [bool]$converter
        converter = $converter
        externalDependency = $true
        bundled = $false
    }
}
