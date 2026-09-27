function Publish-VerifiedOutput([string]$Temporary, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Temporary -PathType Leaf) -or
        (Get-Item -LiteralPath $Temporary).Length -le 0) {
        throw '临时成品不存在或为空；旧成品未改动。'
    }
    if (Test-Path -LiteralPath $Destination) {
        [IO.File]::Replace($Temporary, $Destination, $null)
    } else {
        [IO.File]::Move($Temporary, $Destination)
    }
}
