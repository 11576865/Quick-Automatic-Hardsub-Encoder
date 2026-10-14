# Actual Windows localhost Bridge lifecycle for source-owned B16 FLAC
# observation. No browser or strict size adoption; bounded synthetic media.
$ErrorActionPreference='Stop'
$root=Join-Path $env:RUNNER_TEMP ('qhe-b16-native-http-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Force -Path $root)
$server=$null
try{
 $ffmpeg=(Get-Command ffmpeg.exe -ErrorAction Stop).Source
 $source=Join-Path $root 'source.mkv'
 & $ffmpeg -hide_banner -nostdin -loglevel error -y -f lavfi -i 'testsrc2=size=160x90:rate=12:duration=3' -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=3' -f lavfi -i 'sine=frequency=880:sample_rate=48000:duration=3' -map 0:v -map 1:a -map 2:a -c:v ffv1 -c:a pcm_s16le $source
 if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $source -PathType Leaf)){throw 'B16 Native HTTP fixture input unavailable.'}
 $port=8898;$url="http://127.0.0.1:$port"
 $token='qhe-b16-native-http-fixture'
 $headers=@{'X-Quick-Hardsub-Token'=$token;Origin=$url}
 $stdout=Join-Path $root 'bridge-out.log';$stderr=Join-Path $root 'bridge-err.log'
 $server=Start-Process powershell.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -ArgumentList @(
   '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
   (Resolve-Path './windows/native-bridge.ps1').Path,
   '-NoBrowser','-Port',[string]$port,'-Token',$token,'-InitialVideo',$source)
 $ready=$false
 for($i=0;$i -lt 50;$i++){
  Start-Sleep -Milliseconds 300
  try{$health=Invoke-RestMethod "$url/api/health" -Headers $headers -TimeoutSec 2
    if($health.available){$ready=$true;break}}catch{}
 }
 if(-not $ready){throw ('B16 Native Bridge did not start: '+(Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue))}
 $measurement=Invoke-RestMethod -Method Post -Uri "$url/api/source-budget" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 80
 if($measurement.scope -ne 'full-source' -or -not $measurement.measurementId -or @($measurement.audioPacketBytes).Count -ne 2){throw 'Full-source cost measurement missing.'}
 $req=@{request=@{version=1;mode='isolated-flac-encode';start=0.4;end=2.4;outputFormat='matroska';tracks=@(
   @{action='flac';sourceOrdinal=0;range='full';channels=$null;sampleRate=$null},
   @{action='flac';sourceOrdinal=1;range='trim';channels=1;sampleRate=48000})}}
 $body=$req|ConvertTo-Json -Depth 9 -Compress
 $started=Invoke-RestMethod -Method Post -Uri "$url/api/flac-encode-preflight" -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 15
 if($started.state -ne 'running' -or -not $started.jobId){throw 'FLAC Native HTTP request not accepted.'}
 $receipt=$null
 for($i=0;$i -lt 200;$i++){
  Start-Sleep -Milliseconds 250
  $receipt=Invoke-RestMethod -Method Get -Uri "$url/api/flac-encode-preflight" -Headers $headers -TimeoutSec 4
  if($receipt.state -ne 'running'){break}
 }
 if($receipt.state -ne 'ready' -or $receipt.jobId -ne $started.jobId -or
    $receipt.receipt.measurementId -ne $measurement.measurementId -or
    $receipt.receipt.canReplaceFormalBudget -ne $false -or
    $receipt.receipt.canCertifyFinalMux -ne $false -or
    @($receipt.receipt.tracks).Count -ne 2 -or
    [long]$receipt.receipt.tracks[0].packetBytes -le 0 -or
    [long]$receipt.receipt.tracks[1].packetBytes -le 0){
  throw ('B16 Native HTTP FLAC receipt not source-scoped and ready: '+($receipt|ConvertTo-Json -Depth 5 -Compress))
 }
 Write-Host 'B16 Native HTTP FLAC preview ready and bound to first whole-source measurement.'
 $second=Invoke-RestMethod -Method Post -Uri "$url/api/source-budget" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 80
 if(-not $second.measurementId -or $second.measurementId -eq $measurement.measurementId){
  throw 'Source remeasure must generate a distinct measurement ID.'
 }
 $stale=Invoke-RestMethod -Method Get -Uri "$url/api/flac-encode-preflight" -Headers $headers -TimeoutSec 5
 if($stale.state -ne 'unavailable' -or $stale.reason -ne 'source-or-ledger-replaced' -or $null -ne $stale.receipt){
  throw 'Completed FLAC receipt survived its parent source measurement replacement.'
 }
 Write-Host 'B16 Native HTTP same-file remeasurement invalidated cached FLAC proof.'
 # Full executable Native manual task: no sizePlan, because FLAC quality mode
 # cannot claim a predictive exact output byte cost. Nonetheless, completed
 # mixed output must expose actual audio packet totals via FFprobe audit.
 $task=@{
  version=4;operation='transcode';codec='h264';encoder='libx264'
  start=0.4;end=2.4;hasTrimRange=$true;usesTrimInput=$true
  videoStreams=@(0);videoRange='full';expectedVideoTracks=1
  expectedVideoDuration=3.0;expectedAudioTracks=2;expectedDuration=3.0
  audio='copy';audioTrack='all';audioRange='trim'
  audioPlan=@(
   @{sourceOrdinal=0;action='flac';range='full'},
   @{sourceOrdinal=1;action='flac';range='trim';channels=1;sampleRate=48000}
  )
  keepSubtitles=$false;keepAttachments=$false;rateMode='quality'
  budgetPolicy='best-effort';outputFormat='matroska';outputExtension='mkv'
  budgetEvidence=$second
  outputArgs=@('-map','0:v:0','-map','0:a:0','-map','1:a:1',
   '-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p',
   '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0',
   '-c:a:0','flac','-c:a:1','flac','-ac:a:1','1','-ar:a:1','48000',
   '-map_metadata','-1','-map_chapters','-1')
 }
 $encodeBody=@{request=@{task=$task;expectedDuration=3.0;suggestedName='flac-mixed.mkv'}}|ConvertTo-Json -Depth 16 -Compress
 $encoded=Invoke-RestMethod -Method Post -Uri "$url/api/encode" -Headers $headers -ContentType 'application/json' -Body $encodeBody -TimeoutSec 15
 if(-not $encoded.ok -or -not $encoded.jobId){throw 'Manual Native FLAC mixed-output job was not created.'}
 $done=$null
 for($i=0;$i -lt 120;$i++){
  Start-Sleep -Milliseconds 250
  $done=Invoke-RestMethod -Uri "$url/api/jobs/$($encoded.jobId)" -Headers $headers -TimeoutSec 5
  if($done.state -in @('completed','failed','cancelled')){break}
 }
 if($done.state -ne 'completed'){throw ('Native real FLAC mixed-task failed: '+$done.error)}
 if($done.outputPacketAuditState -ne 'ready' -or
    $done.outputPacketEvidence.scope -ne 'completed-artifact' -or
    @($done.outputPacketEvidence.audioPacketBytes).Count -ne 2){
  throw 'Completed FLAC quality-mode mixed-mux task failed to run independent audio packet audit.'
 }
 $stages=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$encoded.jobId+'-*'))
 if($stages.Count -ne 1){throw 'Native FLAC completed staging directory absent.'}
 $artifact=Join-Path $stages[0].FullName 'output.mkv'
 if(-not(Test-Path -LiteralPath $artifact)){throw 'Native FLAC mixed output absent.'}
 $outputStat=Get-Item -LiteralPath $artifact
 if([string]$done.outputPacketEvidence.artifactJobId -ne [string]$encoded.jobId -or
    [long]$done.outputPacketEvidence.artifactBytes -ne [long]$done.outputBytes -or
    [long]$done.outputPacketEvidence.artifactBytes -ne [long]$outputStat.Length -or
    [string]$done.outputPacketEvidence.artifactWriteTicks -ne
      [string]$outputStat.LastWriteTimeUtc.Ticks){
   throw 'Native finished-mux FLAC packet receipt is not bound to the current verified artifact and job.'
 }
 for($track=0;$track -lt 2;$track++){
  $measured=0L
  foreach($packet in @(& ffprobe -v error -select_streams ('a:'+$track) -show_packets -show_entries packet=size -of csv=p=0 $artifact)){
   if($packet -match '^[0-9]+$'){$measured += [long]$packet}
  }
  if($measured -le 0 -or [long]$done.outputPacketEvidence.audioPacketBytes[$track] -ne $measured){
   throw ('Native mixed FLAC packet receipt diverged from independent FFprobe: audio '+$track)
  }
 }
 Write-Host 'B16 Native actual manual FLAC quality-mode job exposes independently verified completed-mux audio packets without a sizePlan.'
 # Adversarial post-audit drift: a completed short-file packet observation must
 # be revoked if the staged output is mutated before a later status request.
 [IO.File]::AppendAllText($artifact,'B16_ARTIFACT_CHANGED',
   (New-Object Text.UTF8Encoding($false)))
 $revoked=Invoke-RestMethod -Uri "$url/api/jobs/$($encoded.jobId)" -Headers $headers -TimeoutSec 5
 if($revoked.state -ne 'completed' -or $null -ne $revoked.outputPacketEvidence -or
    $revoked.outputPacketAuditState -ne 'unavailable'){
  throw 'Completed Native mux packet evidence survived modified staged output.'
 }
 Write-Host 'B16 real Native short completed-artifact packet audit revoked after staged file mutation.'

}finally{
 if($server){
  try{if(-not $server.HasExited){Stop-Process -Id $server.Id -Force}}catch{}
 }
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
