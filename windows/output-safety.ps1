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

# WU15: the user's file chooser authorizes a destination, not the destruction
# of an already authorized INPUT or a private staged result. This is an
# independent safeguard before atomic publishing (which alone cannot prevent
# a successful-but-destructive overwrite of the source).
function Assert-NativePublishDestinationSafe([string]$Destination,[string[]]$ProtectedPaths) {
    if([string]::IsNullOrWhiteSpace($Destination) -or
       -not [IO.Path]::IsPathRooted($Destination)){
        throw 'Native output destination must be an absolute file path.'
    }
    $full=[IO.Path]::GetFullPath($Destination)
    foreach($protected in @($ProtectedPaths)){
        if([string]::IsNullOrWhiteSpace($protected)){continue}
        $other=[IO.Path]::GetFullPath($protected)
        if([string]::Equals($full,$other,[StringComparison]::OrdinalIgnoreCase)){
            throw 'Refusing to overwrite an authorized source or verified staged output.'
        }
    }
    # Reject existing link aliases that could redirect even a non-equal
    # destination to an input elsewhere. File.Replace must not follow them.
    if(Test-Path -LiteralPath $full){
        $existing=Get-Item -LiteralPath $full -Force -ErrorAction Stop
        if($existing.PSIsContainer){throw 'Output destination is a directory.'}
        if(([IO.FileAttributes]$existing.Attributes -band
            [IO.FileAttributes]::ReparsePoint) -ne 0){
            throw 'Output destination is a symbolic link/reparse point; choose a regular file.'
        }
    }
    return $full
}
