# WU10: real source H264 + FLAC + AAC => official locked v4 task =>
# localhost Native => independently hashed source/output a:0 packet payloads.
$ErrorActionPreference='Stop'
$dir=Join-Path $env:RUNNER_TEMP ('wu10-audio-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $dir -Force)
$source=Join-Path $dir 'two-audio-source.mkv'
$base='http://127.0.0.1:9360'
$headers=@{'X-Quick-Hardsub-Token'='wu10-test-token';Origin=$base}
$bridge=$null
try{
  $fargs=@('-hide_banner','-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=12:duration=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=3','-map','0:v:0','-map','1:a:0','-map','2:a:0','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a:0','flac','-c:a:1','aac','-b:a:1','64k','-f','matroska',$source)
  & ffmpeg @fargs
  if($LASTEXITCODE -ne 0){throw 'Real H264/FLAC/AAC source fixture failed'}
  $sourceStreams=(& ffprobe -v error -show_entries stream=codec_type,codec_name -of json $source)|ConvertFrom-Json
  $srcAudio=@($sourceStreams.streams|Where-Object{$_.codec_type -eq 'audio'})
  if($srcAudio.Count -ne 2 -or $srcAudio[0].codec_name -ne 'flac' -or $srcAudio[1].codec_name -ne 'aac'){throw 'Source must be FLAC a:0 + AAC a:1'}
  $startArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Resolve-Path './windows/native-bridge.ps1'),'-NoBrowser','-Port','9360','-Token','wu10-test-token','-InitialVideo',$source)
  $bridge=Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList $startArgs -RedirectStandardOutput (Join-Path $dir 'bridge-out.log') -RedirectStandardError (Join-Path $dir 'bridge-error.log')
  $ready=$false
  for($i=0;$i -lt 100;$i++){
    Start-Sleep -Milliseconds 250
    try{$health=Invoke-RestMethod -Uri "$base/api/health" -Headers $headers -TimeoutSec 3
      if($health.available){$ready=$true;break}}catch{}
  }
  if(-not $ready){throw 'Windows Native Bridge not ready'}
  $probe=Invoke-RestMethod -Method Post -Uri "$base/api/probe" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 45
  if(-not $probe.ok -or $probe.audioTracks -ne 2){throw 'Real Native probe did not see two audio streams'}
  $probeFile=Join-Path $dir 'probe.json'
  $taskFile=Join-Path $dir 'job.json'
  [IO.File]::WriteAllText($probeFile,($probe|ConvertTo-Json -Depth 18),[Text.UTF8Encoding]::new($false))
  $sourceKey='wu10|'+[IO.Path]::GetFileName($source)+'|'+(Get-Item -LiteralPath $source).Length
  & node './scripts/build-wu10-preserved-audio-task.mjs' $probeFile $taskFile $sourceKey
  if($LASTEXITCODE -ne 0){throw 'Official locked v4 compiler failed'}
  # PowerShell 5.1 text decoding can corrupt UTF-8 Chinese warnings:
  # submit the exact raw Node-generated task bytes instead.
  $payload=[IO.File]::ReadAllBytes($taskFile)
  $run=Invoke-RestMethod -Method Post -Uri "$base/api/encode" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 35
  if(-not $run.ok -or -not $run.jobId){throw 'Real Native did not accept locked v4 task'}
  $status=$null
  for($i=0;$i -lt 240;$i++){
    Start-Sleep -Milliseconds 250
    $status=Invoke-RestMethod -Uri "$base/api/jobs/$($run.jobId)" -Headers $headers -TimeoutSec 12
    if($status.state -in @('completed','failed','cancelled')){break}
  }
  if($status.state -ne 'completed'){throw ('Native mixed audio task incomplete: '+($status|ConvertTo-Json -Depth 8 -Compress))}
  $folders=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$run.jobId+'-*'))
  if($folders.Count -ne 1){throw 'Cannot locate exact Native completed-job directory'}
  $artifact=Join-Path $folders[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $artifact)){throw 'Native output missing'}
  $size=(Get-Item -LiteralPath $artifact).Length
  if($size -le 1000 -or $size -ne [long]$status.outputBytes){throw 'Artifact and job receipt byte size differ'}
  $streams=(& ffprobe -v error -show_entries stream=codec_type,codec_name -of json $artifact)|ConvertFrom-Json
  $audio=@($streams.streams|Where-Object{$_.codec_type -eq 'audio'})
  if($audio.Count -ne 2 -or $audio[0].codec_name -ne 'flac' -or $audio[1].codec_name -ne 'aac'){throw 'Output audio mapping/codec mismatch'}
  $packetArgs=@('-v','error','-select_streams','a:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','csv=p=0')
  $sourceHash=@(& ffprobe @packetArgs $source | ForEach-Object{$_.Trim()} | Where-Object{$_ -match '^SHA256:[a-fA-F0-9]{64}$'})
  if($LASTEXITCODE -ne 0){throw 'Source FFprobe hashing failed'}
  $outputHash=@(& ffprobe @packetArgs $artifact | ForEach-Object{$_.Trim()} | Where-Object{$_ -match '^SHA256:[a-fA-F0-9]{64}$'})
  if($LASTEXITCODE -ne 0){throw 'Output FFprobe hashing failed'}
  if($sourceHash.Count -lt 15 -or $sourceHash.Count -ne $outputHash.Count){throw ('Protected packet count differs: input '+$sourceHash.Count+' output '+$outputHash.Count)}
  for($i=0;$i -lt $sourceHash.Count;$i++){
    if($sourceHash[$i] -ne $outputHash[$i]){throw ('Protected FLAC compressed packet SHA256 mismatch #'+$i)}
  }
  $aacArgs=@('-v','error','-select_streams','a:1','-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','csv=p=0')
  $srcAAC=@(& ffprobe @aacArgs $source | ForEach-Object{$_.Trim()} | Where-Object{$_ -match '^SHA256:[a-fA-F0-9]{64}$'})
  $outAAC=@(& ffprobe @aacArgs $artifact | ForEach-Object{$_.Trim()} | Where-Object{$_ -match '^SHA256:[a-fA-F0-9]{64}$'})
  if($srcAAC.Count -lt 3 -or $outAAC.Count -lt 3 -or ($srcAAC -join ',') -eq ($outAAC -join ',')){throw 'Second AAC track did not demonstrate separate encoding'}
  Write-Host ('WU10 REAL NATIVE PASS: '+$sourceHash.Count+' protected FLAC packet SHA256 values identical, independent AAC transcoded, '+$size+' bytes. No general metadata/trim/sync claim.')
}finally{
  if($bridge -and -not $bridge.HasExited){Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue}
  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
