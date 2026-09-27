function Publish-VerifiedOutput([string]$Temporary, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Temporary -PathType Leaf) -or
        (Get-Item -LiteralPath $Temporary).Length -le 0) {
        throw 'Temporary output is missing or empty; existing output is unchanged.'
    }
    if (Test-Path -LiteralPath $Destination) {
        $backupName = '.' + [IO.Path]::GetFileName($Destination) + '.backup-' + [guid]::NewGuid().ToString('N')
        $backup = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination))) $backupName
        [IO.File]::Replace($Temporary, $Destination, $backup)
        try { [IO.File]::Delete($backup) } catch {}
    } else {
        [IO.File]::Move($Temporary, $Destination)
    }
}
