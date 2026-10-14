# VVC availability requires an executable encode + Matroska + decode chain.
# The parent native-backend script supplies Invoke-NativeTool and Quote-NativeArg.
function Get-VvcValidationSnapshot($Job){
    $process=$Job.Started.Process
    if(-not $process.HasExited){return [pscustomobject]@{ok=$true;state=if($Job.Cancelled){'cancelling'}else{'validating'};progress=.99;terminal=$false}}
    if($Job.Cancelled){return [pscustomobject]@{ok=$true;state='cancelled';terminal=$true;error=''}}
    if($process.ExitCode -ne 0){return [pscustomobject]@{ok=$true;state='failed';terminal=$true;error=('VVC full-output decode failed: '+[string]$Job.Started.StdErrTask.Result)}}
    return [pscustomobject]@{ok=$true;state='completed';terminal=$true;error=''}
}
function Test-VvcRuntime([string]$Ffmpeg,[string]$Ffprobe){
    $output=Join-Path ([IO.Path]::GetTempPath()) ('quick-hardsub-vvc-'+[guid]::NewGuid().ToString('N')+'.mkv')
    $bytes=0L
    try{
        if(-not $Ffmpeg -or -not $Ffprobe){throw 'VVC requires both FFmpeg and FFprobe.'}
        $args='-hide_banner -nostdin -v error -y -f lavfi -i testsrc2=size=128x128:rate=24 -frames:v 2 -an -c:v libvvenc -preset faster -qp 32 -pix_fmt yuv420p10le -f matroska '+(Quote-NativeArg $output)
        $encode=Invoke-NativeTool $Ffmpeg $args -AllowFailure -TimeoutSeconds 30
        if($encode.ExitCode -ne 0){throw ('VVC encode/MKV writer failed: '+$encode.StdErr)}
        if(-not (Test-Path $output -PathType Leaf)){throw 'VVC probe produced no file.'}
        $bytes=(Get-Item $output).Length
        if($bytes -le 0){throw 'VVC probe output is empty.'}
        $probe=Invoke-NativeTool $Ffprobe ('-v error -select_streams v:0 -count_frames -show_entries stream=codec_name,pix_fmt,nb_read_frames -of json '+(Quote-NativeArg $output)) -TimeoutSeconds 15
        $info=$probe.StdOut | ConvertFrom-Json
        $stream=@($info.streams)[0]
        if($stream.codec_name -ne 'vvc' -or $stream.pix_fmt -ne 'yuv420p10le' -or [int]$stream.nb_read_frames -ne 2){throw 'VVC probe codec/pixel format/frame count differs from the contract.'}
        [void](Invoke-NativeTool $Ffmpeg ('-v error -xerror -i '+(Quote-NativeArg $output)+' -map 0:v:0 -f null -') -TimeoutSeconds 15)
        return [pscustomobject]@{Available=$true;ExitCode=0;Bytes=$bytes;Error='';Protocol='encode-mkv-decode-v1'}
    }catch{
        return [pscustomobject]@{Available=$false;ExitCode=-1;Bytes=$bytes;Error=$_.Exception.Message;Protocol='encode-mkv-decode-v1'}
    }finally{Remove-Item $output -Force -ErrorAction SilentlyContinue}
}
