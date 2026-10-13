# Windows Native exact-source sample evidence helpers.
# PowerShell 5.1 compatible. Dot-sourceable in CI without starting the server.
# Tokens identify file-path + stat snapshots, NOT cryptographic content hashes.
function Get-ManualNativeFileStamp([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw 'Manual sample evidence input is missing.'
    }
    $item=Get-Item -LiteralPath $Path -ErrorAction Stop
    return [pscustomobject]@{
        path=[IO.Path]::GetFullPath([string]$item.FullName).ToLowerInvariant()
        bytes=[long]$item.Length
        ticks=[long]$item.LastWriteTimeUtc.Ticks
    }
}

function Get-ManualNativeStampToken($Stamp,[string]$Kind,[string]$Extra='') {
    if (-not $Stamp -or -not $Stamp.path -or [long]$Stamp.bytes -le 0) {
        throw 'Manual sample evidence has invalid file metadata.'
    }
    $text=($Kind+'|'+[string]$Stamp.path+'|'+[string]$Stamp.bytes+'|'+
        [string]$Stamp.ticks+'|'+$Extra)
    $sha=[Security.Cryptography.SHA256]::Create()
    try {
        $data=[Text.Encoding]::UTF8.GetBytes($text)
        $hash=[BitConverter]::ToString($sha.ComputeHash($data)).Replace('-','').ToLowerInvariant()
        return 'stat-sha256:'+ $hash
    } finally { $sha.Dispose() }
}

function New-ManualNativeSampleSnapshot([string]$Source,[string]$Ffmpeg,[string]$Version) {
    $sourceStamp=Get-ManualNativeFileStamp $Source
    $runtimeStamp=Get-ManualNativeFileStamp $Ffmpeg
    if ([string]::IsNullOrWhiteSpace($Version)) {
        throw 'Missing FFmpeg runtime version for manual comparison.'
    }
    return [pscustomobject]@{
        source=(Get-ManualNativeStampToken $sourceStamp 'media-source')
        runtime=(Get-ManualNativeStampToken $runtimeStamp 'ffmpeg-executable' $Version)
        sourceStat=$sourceStamp
        runtimeStat=$runtimeStamp
        runtimeVersion=$Version
    }
}

function New-ManualNativeSampleReceipt(
    $Before,$After,$Options,[string]$ActualEncoder,[double]$ActualDuration
) {
    if (-not $Before -or -not $After -or
        $Before.source -ne $After.source -or
        $Before.runtime -ne $After.runtime) {
        throw 'Manual native sample source/runtime changed during encoding; evidence discarded.'
    }
    if (-not [bool]$Options.sampleExact -or [bool]$Options.withSubtitles -or
        -not [bool]$Options.measureSsim -or -not $ActualEncoder) {
        throw 'Manual comparison receipt requires exact, no-subtitle, source-backed SSIM.'
    }
    $start=[double]$Options.start
    $duration=[double]$Options.duration
    $targetRate=[double]$Options.targetVideoBitrate
    if ([double]::IsNaN($start) -or [double]::IsInfinity($start) -or $start -lt 0 -or
        [double]::IsNaN($duration) -or [double]::IsInfinity($duration) -or
        $duration -le 0 -or $duration -gt 8 -or
        [double]::IsNaN($ActualDuration) -or [double]::IsInfinity($ActualDuration) -or
        $ActualDuration -le 0 -or [double]::IsNaN($targetRate) -or
        [double]::IsInfinity($targetRate) -or $targetRate -lt 0) {
        throw 'Manual sample receipt has invalid time or rate evidence.'
    }
    $preset=[string]$Options.preset
    if ([string]::IsNullOrWhiteSpace($preset)) {
        throw 'Manual sample receipt has no selected encoder preset.'
    }
    $rateMode=if ($targetRate -gt 0) { 'bitrate' } else { 'quality' }
    $method=if ($targetRate -gt 0) { 'windows-native-exact-vbr-v1' } else { 'windows-native-exact-cq-v1' }
    $requestedRate=if ($targetRate -gt 0) { [long]$targetRate } else { 0L }
    $requestedQuality=if ($targetRate -gt 0) { $null } else { [int]$Options.crf }
    $common=[bool]$Options.commonReference
    if($common){
        $ow=[int]$Options.outputWidth;$oh=[int]$Options.outputHeight
        $rw=[int]$Options.referenceWidth;$rh=[int]$Options.referenceHeight
        if($ow -lt 2 -or $oh -lt 2 -or $ow % 2 -or $oh % 2 -or $rw % 2 -or $rh % 2 -or $rw -lt $ow -or $rh -lt $oh -or $rw -gt 16384 -or $rh -gt 16384){throw 'Invalid manual common-reference geometry.'}
    }
    return [pscustomobject]@{
        schemaVersion=1
        method=$method
        referenceMetric=$(if($common){'source-sdr-bicubic-upscale-ssim-v1'}else{'source-sdr-yuv420p-ssim-v1'})
        referenceToken=$(if($common){'direct-source-v0-yuv420p-bicubic-upscale-'+$rw+'x'+$rh+'-ssim-v1'}else{'direct-source-v0-yuv420p-setpts-ssim-v1'})
        filterToken=$(if($common){'candidate-bicubic-common-reference-sdr-yuv420p-v1'}else{'no-video-filters-sdr-yuv420p-v1'})
        outputWidth=$(if($common){$ow}else{0})
        outputHeight=$(if($common){$oh}else{0})
        referenceWidth=$(if($common){$rw}else{0})
        referenceHeight=$(if($common){$rh}else{0})
        sourceToken=[string]$Before.source
        runtimeToken=[string]$Before.runtime
        runtimeVersion=[string]$Before.runtimeVersion
        encoder=$ActualEncoder
        preset=$preset
        multipass=[string]$Options.multipass
        videoStream=0
        requestedStart=$start
        requestedDuration=$duration
        actualDuration=$ActualDuration
        pixelFormat='yuv420p'
        mode=$rateMode
        requestedRate=$requestedRate
        requestedQuality=$requestedQuality
        # Do not report a file content hash or guarantee playback identity.
        identityKind='file-stat-snapshot-not-content-hash'
    }
}
