# Assert QHE's Windows Native file-stat snapshot and exact-sample receipt contract.
# No bridge UI or GPU is required. The source is a real FFmpeg-created media file.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../windows/manual-sample-evidence.ps1')
$dir=Join-Path $env:RUNNER_TEMP ('manual-evidence-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -Path $dir -ItemType Directory -Force)
try {
    $source=Join-Path $dir 'source media.mkv'
    & ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=160x90:rate=12:duration=2' -c:v libx264 -preset ultrafast -crf 28 $source
    if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $source)){throw 'Failed to generate real media input.'}
    $ffmpeg=(Get-Command ffmpeg.exe).Source
    $version=((& ffmpeg -version) | Select-Object -First 1)
    if($LASTEXITCODE -ne 0){throw 'FFmpeg version probe exited unsuccessfully.'}
    $before=New-ManualNativeSampleSnapshot $source $ffmpeg ([string]$version)
    $after=New-ManualNativeSampleSnapshot $source $ffmpeg ([string]$version)
    if($before.source -ne $after.source -or $before.runtime -ne $after.runtime){throw 'Stable source/runtime must preserve token.'}
    $opts=[pscustomobject]@{
        sampleExact=$true;withSubtitles=$false;measureSsim=$true
        start=.25;duration=1.5;targetVideoBitrate=0;crf=25
        preset='ultrafast';multipass='disabled'
    }
    $receipt=New-ManualNativeSampleReceipt $before $after $opts 'libx264' 1.5
    if($receipt.schemaVersion -ne 1 -or $receipt.mode -ne 'quality' -or
       $receipt.sourceToken -ne $before.source -or
       $receipt.runtimeToken -ne $before.runtime -or
       $receipt.referenceMetric -ne 'source-sdr-yuv420p-ssim-v1' -or
       $receipt.identityKind -ne 'file-stat-snapshot-not-content-hash'){
        throw 'Manual receipt omitted required native evidence metadata.'
    }
    $opts.targetVideoBitrate=1000000
    $rate=New-ManualNativeSampleReceipt $before $after $opts 'libx264' 1.5
    if($rate.mode -ne 'bitrate' -or $rate.method -ne 'windows-native-exact-vbr-v1' -or $rate.requestedRate -ne 1000000){
        throw 'Native VBR trial mislabeled as CQ evidence.'
    }
    $opts | Add-Member -NotePropertyName commonReference -NotePropertyValue $true
    $opts | Add-Member -NotePropertyName outputWidth -NotePropertyValue 80
    $opts | Add-Member -NotePropertyName outputHeight -NotePropertyValue 44
    $opts | Add-Member -NotePropertyName referenceWidth -NotePropertyValue 160
    $opts | Add-Member -NotePropertyName referenceHeight -NotePropertyValue 90
    $scaled=New-ManualNativeSampleReceipt $before $after $opts 'libx264' 1.5
    if($scaled.referenceMetric -ne 'source-sdr-bicubic-upscale-ssim-v1' -or $scaled.outputWidth -ne 80 -or $scaled.referenceWidth -ne 160){throw 'Scaled receipt lost geometry.'}
    $opts.commonReference=$false
    $opts.withSubtitles=$true
    $rejected=$false
    try{New-ManualNativeSampleReceipt $before $after $opts 'libx264' 1.5 | Out-Null}catch{$rejected=$true}
    if(-not $rejected){throw 'Subtitle-filtered sample was misidentified as source-only Manual evidence.'}
    $opts.withSubtitles=$false
    [IO.File]::AppendAllText($source,'m')
    $mutated=New-ManualNativeSampleSnapshot $source $ffmpeg ([string]$version)
    if($before.source -eq $mutated.source){throw 'Mutated media file retained its source identity.'}
    $rejected=$false
    try{New-ManualNativeSampleReceipt $before $mutated $opts 'libx264' 1.5 | Out-Null}catch{$rejected=$true}
    if(-not $rejected){throw 'Source mutation during sample failed to invalidate trial.'}
    Write-Host 'Windows Native manual evidence stamp, CQ/VBR mode and mutation guard passed.'
}finally{
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
