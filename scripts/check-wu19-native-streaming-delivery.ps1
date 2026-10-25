# WU19: 96 MiB actual byte writes; partial-write failure and same-stage retry.
# Cross-volume is VERIFIED only if Win32 volume serials differ.
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){
    throw 'WU19 actual Windows streaming test requires hosted RUNNER_TEMP.'
}
. (Join-Path $PSScriptRoot '../windows/output-safety.ps1')
$work=Join-Path $env:RUNNER_TEMP ('wu19-stream-'+[guid]::NewGuid().ToString('N'))
$otherWork=$null
New-Item -ItemType Directory -Force -Path $work|Out-Null
try {
    $stage=Join-Path $work 'original-verified-stage.mkv'
    $target=Join-Path $work 'existing-user-output.mkv'
    $temp=Join-Path $work '.user-output.quick-hardsub-wu19.tmp'
    # Actual binary stage bytes, not just a mocked byte count or sparse file.
    $block=New-Object byte[] 1048576
    for($i=0;$i -lt 1024;$i++){ $block[$i]=[byte](($i*37+11) % 256) }
    for($i=1024;$i -lt $block.Length;$i+=1024){
        [Array]::Copy($block,0,$block,$i,1024)
    }
    $writer=[IO.File]::Open($stage,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
        for($i=0;$i -lt 96;$i++){$writer.Write($block,0,$block.Length)}
        $writer.Flush($true)
    }finally{$writer.Dispose()}
    $stageBytes=[long](Get-Item -LiteralPath $stage).Length
    if($stageBytes -ne [long]100663296){throw '96MiB real stage was not written'}
    $stageSha=(Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash
    [IO.File]::WriteAllText($target,'ORIGINAL USER OUTPUT MUST SURVIVE PARTIAL WRITE',[Text.Encoding]::UTF8)
    $oldSha=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    $chosen=Get-NativePublishDestinationSnapshot $target

    # CI-only partial failure occurs after at least 5MiB of actual destination
    # writes; expected old output must remain byte-identical.
    $denied=$false
    try{[void](Copy-NativeStageToOutputTemporary $stage $temp $stageBytes ([long]5242880))}
    catch{if($_.Exception.Message -match 'partial destination write failed after actual bytes'){
        $denied=$true
    }else{throw}}
    if(-not $denied){throw 'WU19 stream failure was not injected after real writes'}
    $partial=[long](Get-Item -LiteralPath $temp).Length
    if($partial -lt 5242880 -or $partial -ge $stageBytes){
        throw 'WU19 denied streaming copy did not leave only partial bytes'
    }
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $oldSha -or
       (Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -ne $stageSha){
        throw 'WU19 interrupted staging changed old user output or verified stage'
    }
    Remove-Item -LiteralPath $temp -Force
    if(Test-Path -LiteralPath $temp){throw 'WU19 partial temp was not cleaned'}
    # Full retry from SAME 96MiB stage, no encoding, original target replaced
    # only after entire temp byte count and hash match stage.
    $copied=Copy-NativeStageToOutputTemporary $stage $temp $stageBytes
    if([long]$copied -ne $stageBytes -or
       (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash -ne $stageSha){
        throw 'WU19 real streaming retry produced mismatched bytes'
    }
    Publish-NativeProtectedOutput $temp $target @($stage) $chosen
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $stageSha){
        throw 'WU19 verified stage was not atomically published after retry'
    }
    # A different DRIVE LETTER does not establish another volume. Compare
    # actual Win32 volume serials from open file handles before claiming proof.
    $actualSourceVolume=(Get-NativeExistingFileIdentity $stage).Split('/')[0]
    $crossStatus='NOT_VERIFIED'
    $candidate=[Environment]::GetFolderPath('LocalApplicationData')
    if($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)){
        $otherWork=Join-Path $candidate ('qhe-wu19-cross-'+[guid]::NewGuid().ToString('N'))
        New-Item -Path $otherWork -ItemType Directory -Force|Out-Null
        $probe=Join-Path $otherWork 'volume-probe.tmp'
        [IO.File]::WriteAllText($probe,'VOLUME ID PROBE',[Text.Encoding]::UTF8)
        $otherVolume=(Get-NativeExistingFileIdentity $probe).Split('/')[0]
        if($otherVolume -ne $actualSourceVolume){
            $dest=Join-Path $otherWork 'destination.mkv'
            $copy=Join-Path $otherWork '.cross-volume-verifying.tmp'
            $n=Copy-NativeStageToOutputTemporary $stage $copy $stageBytes
            if([long]$n -ne $stageBytes -or
               (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash -ne $stageSha){
                throw 'Cross-volume copied bytes do not match actual 96MiB source'
            }
            $snapshot=Get-NativePublishDestinationSnapshot $dest
            Publish-NativeProtectedOutput $copy $dest @($stage) $snapshot
            if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $stageSha){
                throw 'Cross-volume destination publish mismatched disk SHA'
            }
            $crossStatus='DISTINCT_WINDOWS_VOLUMES_VERIFIED'
        }else{
            $crossStatus='SAME_VOLUME_SERIAL_NO_CROSS_VOLUME_CLAIM'
        }
    }else{
        $crossStatus='SECOND_WINDOWS_VOLUME_NOT_ACCESSIBLE'
    }
    Write-Host ('WU19 WINDOWS STREAMED DELIVERY PASS: actualBytes='+$stageBytes+
        '; injectedPartialBytes='+$partial+
        '; sameStageRetrySha='+$stageSha+
        '; crossVolume='+$crossStatus)
}finally{
    if($otherWork -and (Test-Path -LiteralPath $otherWork)){
        Remove-Item -LiteralPath $otherWork -Recurse -Force -ErrorAction Stop
    }
    if(Test-Path -LiteralPath $work){
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop
    }
}
