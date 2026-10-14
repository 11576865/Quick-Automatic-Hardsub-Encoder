# WU05: real B-frame/AAC source -> Native Stream Copy Trim -> completed
# output-clock decoded presentation and first video/audio packet timestamps.
$ErrorActionPreference='Stop'
$dir=Join-Path $env:RUNNER_TEMP ('wu05-timeline-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $dir -Force)
$source=Join-Path $dir 'source.mkv'
$base='http://127.0.0.1:9358'
$headers=@{'X-Quick-Hardsub-Token'='wu05-test-token';Origin=$base}
$bridge=$null
try{
  $createArgs=@('-hide_banner','-nostdin','-v','error','-y','-f','lavfi','-i',
    'testsrc2=size=320x180:rate=12:duration=6','-f','lavfi','-i',
    'sine=frequency=440:sample_rate=48000:duration=6','-map','0:v:0',
    '-map','1:a:0','-c:v','libx264','-g','24','-bf','2',
    '-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-f','matroska',$source)
  & ffmpeg @createArgs
  if($LASTEXITCODE -ne 0){throw 'H264 B-frame/AAC source fixture failed'}
  $src=(& ffprobe -v error -select_streams v:0 -show_entries stream=has_b_frames -of json $source)|ConvertFrom-Json
  if([int]$src.streams[0].has_b_frames -lt 1){throw 'Synthetic source lacks B-frame dependency'}
  $startArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',
    (Resolve-Path './windows/native-bridge.ps1'),'-NoBrowser','-Port','9358',
    '-Token','wu05-test-token','-InitialVideo',$source)
  $bridge=Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList $startArgs -RedirectStandardOutput (Join-Path $dir 'bridge-out.log') -RedirectStandardError (Join-Path $dir 'bridge-error.log')
  $ready=$false
  for($i=0;$i -lt 80;$i++){
    Start-Sleep -Milliseconds 250
    try{$health=Invoke-RestMethod -Uri "$base/api/health" -Headers $headers -TimeoutSec 3
      if($health.available){$ready=$true;break}}catch{}
  }
  if(-not $ready){throw 'Windows Native Bridge did not start'}
  $probe=Invoke-RestMethod -Method Post -Uri "$base/api/probe" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 45
  if(-not $probe.ok){throw 'Source Native media probe failed'}
  $probeFile=Join-Path $dir 'probe.json'
  $taskFile=Join-Path $dir 'formal-task.json'
  [IO.File]::WriteAllText($probeFile,($probe|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
  & node './scripts/build-wu05-native-task.mjs' $probeFile $taskFile
  if($LASTEXITCODE -ne 0){throw 'Copy trim formal compiler failed'}
  $request=Get-Content -Raw -LiteralPath $taskFile|ConvertFrom-Json
  $run=Invoke-RestMethod -Method Post -Uri "$base/api/encode" -Headers $headers -ContentType 'application/json' -Body ($request|ConvertTo-Json -Depth 16 -Compress) -TimeoutSec 35
  if(-not $run.ok -or -not $run.jobId){throw 'Native copy trim task did not start'}
  $status=$null
  for($i=0;$i -lt 180;$i++){
    Start-Sleep -Milliseconds 250
    $status=Invoke-RestMethod -Uri "$base/api/jobs/$($run.jobId)" -Headers $headers -TimeoutSec 12
    if($status.state -in @('completed','failed','cancelled')){break}
  }
  if($status.state -ne 'completed'){throw ('Native copy trim incomplete: '+($status|ConvertTo-Json -Compress))}
  $receipt=Invoke-RestMethod -Uri "$base/api/jobs/$($run.jobId)/cut-timeline" -Headers $headers -TimeoutSec 80
  if(-not $receipt.ok -or $receipt.jobId -ne $run.jobId -or
    $receipt.scope -ne 'completed-artifact-first-boundary' -or
    $receipt.artifactBytes -ne $status.outputBytes -or
    $receipt.verificationStatus -ne 'output-first-boundary-observed-source-packet-and-sync-unverified'){
    throw ('Invalid cut timeline receipt: '+($receipt|ConvertTo-Json -Compress))
  }
  if($receipt.requestedIn -ne 2.4 -or $receipt.requestedOut -ne 4.8 -or
    $null -eq $receipt.actualFirstPresentation -or $null -eq $receipt.firstVideoPacketPts -or
    $null -eq $receipt.firstVideoPacketDts -or
    @($receipt.audioTimeMapping).Count -ne 1 -or
    $null -eq $receipt.audioTimeMapping[0].outputFirstPts -or
    $null -ne $receipt.copiedPacketRange){
    throw 'Timestamp or independent source mapping boundary is missing/overclaimed'
  }
  $folders=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$run.jobId+'-*'))
  if($folders.Count -ne 1){throw 'Native completed private output not located'}
  $artifact=Join-Path $folders[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $artifact)){throw 'Native output MKV missing'}
  $fargs=@('-v','error','-select_streams','v:0','-read_intervals','%+#128',
    '-show_frames','-show_entries','frame=best_effort_timestamp_time',
    '-of','json',$artifact)
  $frames=(& ffprobe @fargs)|ConvertFrom-Json
  $first=@($frames.frames|Where-Object{$_.best_effort_timestamp_time -ne $null})|Select-Object -First 1
  if(-not $first){throw 'Independent decoded first frame missing'}
  $observed=[double]::Parse([string]$first.best_effort_timestamp_time,[Globalization.CultureInfo]::InvariantCulture)
  if([Math]::Abs($observed-[double]$receipt.actualFirstPresentation) -gt .002){
    throw 'Output first decoded presentation differs from independent FFprobe'
  }
  Write-Host ('WU05 real Native B-frame PASS: decoded first '+$receipt.actualFirstPresentation+
    ', packet video PTS/DTS '+$receipt.firstVideoPacketPts+'/'+$receipt.firstVideoPacketDts+
    ', first audio PTS '+$receipt.audioTimeMapping[0].outputFirstPts+
    ', output bytes '+$receipt.artifactBytes+'. Source packet mapping remains unverified.')
}finally{
  if($bridge -and -not $bridge.HasExited){Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue}
  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
