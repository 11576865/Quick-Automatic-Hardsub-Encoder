# WU21: genuine >4GiB playable MKV, AV packets before/after 4GiB.
# The stage is a SPARSE Matroska with valid EBML Void filler, NOT 4GiB of
# encoded video. The output is written in full through the production 1MiB
# streamed copier into a regular Windows file and independently decoded.
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){
    throw 'WU21 >4GiB Matroska acceptance requires hosted Windows Runner.'
}
. (Join-Path $PSScriptRoot '../windows/output-safety.ps1')
$work=Join-Path $env:RUNNER_TEMP ('wu21-playable-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work|Out-Null
try{
    $base=Join-Path $work 'actual-h264-aac.mkv'
    $source=Join-Path $work 'sparse-playable-source-over4gib.mkv'
    $temp=Join-Path $work '.verified-output.quick-hardsub-wu21.tmp'
    $target=Join-Path $work 'user-published-output.mkv'
    # LIVE Matroska has unknown segment size and no stale Cues after inserting
    # compliant segment-level EBML Void between actual AV clusters.
    & ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=256x144:rate=8:duration=6' -f lavfi -i 'sine=frequency=660:sample_rate=48000:duration=6' -map '0:v:0' -map '1:a:0' -c:v libx264 -preset ultrafast -crf 31 -g 8 -c:a aac -b:a 64k -f matroska -live 1 -cluster_time_limit 700 $base
    if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $base -PathType Leaf)){
        throw 'WU21 FFmpeg failed to encode short real H264/AAC live MKV.'
    }
    & node './scripts/build-wu21-playable-over4gib-mkv.cjs' $base $source
    if($LASTEXITCODE -ne 0){throw 'WU21 failed to build >4GiB EBML MKV fixture.'}
    $size=[long](Get-Item -LiteralPath $source).Length
    if($size -le [long]4294967296){throw 'WU21 source has not crossed unsigned 4GiB boundary.'}
    $available=[UInt64]0;$total=[UInt64]0;$free=[UInt64]0
    if(-not [QheWinFileIdentity]::GetDiskFreeSpaceEx($work,[ref]$available,[ref]$total,[ref]$free)){
        throw 'WU21 real destination volume free-space query failed.'
    }
    $required=[UInt64]$size+[UInt64]1073741824
    if($available -lt $required){
        throw ('WU21 insufficient REAL output space: have '+$available+' need '+$required)
    }
    function Test-Wu21Matroska([string]$Path) {
        $streamsJson=(& ffprobe -v error -count_frames -show_entries 'stream=index,codec_name,codec_type,nb_read_frames' -of json $Path | Out-String)
        if($LASTEXITCODE -ne 0){throw 'WU21 full FFprobe frame scan failed.'}
        $streams=($streamsJson|ConvertFrom-Json).streams
        $video=@($streams|Where-Object {$_.codec_type -eq 'video' -and $_.codec_name -eq 'h264'})
        $audio=@($streams|Where-Object {$_.codec_type -eq 'audio' -and $_.codec_name -eq 'aac'})
        if($video.Count -ne 1 -or $audio.Count -ne 1 -or [long]$video[0].nb_read_frames -ne 48 -or [long]$audio[0].nb_read_frames -lt 250){
            throw ('WU21 AV streams / full frame counts invalid: '+$streamsJson)
        }
        foreach($selector in @('v:0','a:0')){
            $positions=@(& ffprobe -v error -select_streams $selector -show_entries 'packet=pos' -of csv=p=0 $Path)
            if($LASTEXITCODE -ne 0 -or $positions.Count -lt 40){
                throw ('WU21 full demux failed for '+$selector)
            }
            $first=[long]($positions[0].Trim())
            $last=[long]($positions[$positions.Count-1].Trim())
            if($first -gt [long]65536 -or $last -le [long]4294967296){
                throw ('WU21 no verified media packets after 4GiB: '+$selector+' first='+$first+' last='+$last)
            }
        }
        return [pscustomobject]@{
            VideoFrames=[long]$video[0].nb_read_frames
            AudioFrames=[long]$audio[0].nb_read_frames
            Bytes=[long](Get-Item -LiteralPath $Path).Length
        }
    }
    $initial=Test-Wu21Matroska $source
    if($initial.Bytes -ne $size){throw 'WU21 source length changed during demux.'}
    # Decode BOTH AV streams, rather than trusting Matroska headers.
    $srcVideo=Join-Path $work 'source-video.framemd5'
    $srcAudio=Join-Path $work 'source-audio.framemd5'
    & ffmpeg -hide_banner -loglevel error -i $source -map '0:v:0' -f framemd5 $srcVideo
    if($LASTEXITCODE -ne 0){throw 'WU21 source video was not fully decoded.'}
    & ffmpeg -hide_banner -loglevel error -i $source -map '0:a:0' -f framemd5 $srcAudio
    if($LASTEXITCODE -ne 0){throw 'WU21 source audio was not fully decoded.'}
    $videoDecodedHash=(Get-FileHash -LiteralPath $srcVideo -Algorithm SHA256).Hash
    $audioDecodedHash=(Get-FileHash -LiteralPath $srcAudio -Algorithm SHA256).Hash
    $sourceSha=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    [IO.File]::WriteAllText($target,'WU21 OLD USER FILE MUST SURVIVE UNTIL FINAL PUBLICATION',[Text.Encoding]::UTF8)
    $oldSha=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    $snapshot=Get-NativePublishDestinationSnapshot $target
    Assert-NativeOutputVolumeSpace $target $size
    $copied=Copy-NativeStageToOutputTemporary $source $temp $size
    if([long]$copied -ne $size -or [long](Get-Item -LiteralPath $temp).Length -ne $size -or (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash -ne $sourceSha){
        throw 'WU21 actual >4GiB Native copied temp is corrupt.'
    }
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $oldSha){
        throw 'WU21 old user file changed before verified publish.'
    }
    Publish-NativeProtectedOutput $temp $target @($source) $snapshot
    if([long](Get-Item -LiteralPath $target).Length -ne $size -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $sourceSha){
        throw 'WU21 actual published >4GiB file SHA/length mismatch.'
    }
    $final=Test-Wu21Matroska $target
    if($final.VideoFrames -ne $initial.VideoFrames -or $final.AudioFrames -ne $initial.AudioFrames){
        throw 'WU21 decoded media frame counts changed after publication.'
    }
    $outVideo=Join-Path $work 'published-video.framemd5'
    $outAudio=Join-Path $work 'published-audio.framemd5'
    & ffmpeg -hide_banner -loglevel error -i $target -map '0:v:0' -f framemd5 $outVideo
    if($LASTEXITCODE -ne 0){throw 'WU21 published video was not fully decoded.'}
    & ffmpeg -hide_banner -loglevel error -i $target -map '0:a:0' -f framemd5 $outAudio
    if($LASTEXITCODE -ne 0){throw 'WU21 published audio was not fully decoded.'}
    if((Get-FileHash -LiteralPath $outVideo -Algorithm SHA256).Hash -ne $videoDecodedHash -or
       (Get-FileHash -LiteralPath $outAudio -Algorithm SHA256).Hash -ne $audioDecodedHash){
        throw 'WU21 decoded media hashes differ after publication.'
    }
    $peak=[long][Diagnostics.Process]::GetCurrentProcess().PeakWorkingSet64
    if($peak -gt [long]805306368){
        throw ('WU21 high memory use suggests full MKV buffering: '+$peak)
    }
    Write-Host ('WU21 REAL OVER-4GIB PLAYABLE MATROSKA PASS: bytes='+$size+
        '; videoFrames='+$final.VideoFrames+
        '; audioFrames='+$final.AudioFrames+
        '; packetsAfter4GiB=true'+
        '; fullSha256='+$sourceSha+
        '; decodedVideoHash='+$videoDecodedHash+
        '; decodedAudioHash='+$audioDecodedHash+
        '; peakWorkingSetBytes='+$peak+
        '; encodedPayloadOver4GiB=false'+
        '; sparseInputEbmlVoid=true'+
        '; regularOutputCopy=true')
}finally{
    if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop}
}
