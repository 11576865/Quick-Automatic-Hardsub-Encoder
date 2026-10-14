# B16 real >180s low-complexity Windows FLAC Native completion and asynchronous packet audit.
$ErrorActionPreference='Stop'
$root=Join-Path $env:RUNNER_TEMP ('qhe-b16-long-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $root -Force)
$server=$null
try {
 $ffmpeg=(Get-Command ffmpeg.exe -ErrorAction Stop).Source
 $source=Join-Path $root 'long-source.mkv'
 $create=@('-hide_banner','-nostdin','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=32x32:rate=1:duration=182',
   '-f','lavfi','-i','sine=frequency=400:sample_rate=8000:duration=182',
   '-map','0:v:0','-map','1:a:0','-c:v','ffv1','-c:a','pcm_s16le',$source)
 & $ffmpeg @create
 if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $source)){
  throw 'Long-source fixture synthesis failed.'
 }
 $port=8899;$url="http://127.0.0.1:$port"
 $token='qhe-b16-long-async-fixture'
 $headers=@{'X-Quick-Hardsub-Token'=$token;Origin=$url}
 $server=Start-Process powershell.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'stdout.log') -RedirectStandardError (Join-Path $root 'stderr.log') -ArgumentList @(
  '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
  (Resolve-Path './windows/native-bridge.ps1').Path,
  '-NoBrowser','-Port',[string]$port,'-Token',$token,'-InitialVideo',$source)
 $ready=$false
 for($i=0;$i -lt 60;$i++){
  Start-Sleep -Milliseconds 300
  try{$health=Invoke-RestMethod "$url/api/health" -Headers $headers -TimeoutSec 2
   if($health.available){$ready=$true;break}}catch{}
 }
 if(-not $ready){throw 'Long async Native Bridge unavailable.'}
 $cost=Invoke-RestMethod -Method Post -Uri "$url/api/source-budget" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 80
 if($cost.scope -ne 'full-source' -or @($cost.audioPacketBytes).Count -ne 1){
  throw 'Long audio source ledger missing.'
 }
 $task=@{
  version=4;operation='transcode';codec='h264';encoder='libx264'
  start=0.0;end=182.0;hasTrimRange=$false;usesTrimInput=$false
  videoStreams=@(0);videoRange='full';expectedVideoTracks=1
  expectedVideoDuration=182.0;expectedAudioTracks=1;expectedDuration=182.0
  audio='copy';audioTrack='all';audioRange='full'
  audioPlan=@(@{sourceOrdinal=0;action='flac';range='full'})
  keepSubtitles=$false;keepAttachments=$false;rateMode='quality'
  budgetPolicy='best-effort';outputFormat='matroska';outputExtension='mkv'
  budgetEvidence=$cost
  outputArgs=@('-map','0:v:0','-map','0:a:0',
    '-c:v','libx264','-preset','ultrafast','-crf','40','-pix_fmt','yuv420p',
    '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0',
    '-c:a:0','flac','-map_metadata','-1','-map_chapters','-1')
 }
 $body=@{request=@{task=$task;expectedDuration=182;suggestedName='long-async-b16.mkv'}}|ConvertTo-Json -Depth 14 -Compress
 $started=Invoke-RestMethod -Method Post -Uri "$url/api/encode" -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 15
 if(-not $started.ok -or -not $started.jobId){throw 'Native long FLAC encode did not start.'}
 $done=$null
 for($i=0;$i -lt 300;$i++){
  Start-Sleep -Milliseconds 300
  $done=Invoke-RestMethod -Uri "$url/api/jobs/$($started.jobId)" -Headers $headers -TimeoutSec 5
  if($done.state -in @('completed','failed','cancelled')){break}
 }
 if($done.state -ne 'completed'){throw ('Native long FLAC encode failed: '+$done.error)}
 $audit=$done.outputPacketAuditState
 $sawRunning=($audit -eq 'running')
 for($i=0;$i -lt 300 -and $audit -eq 'running';$i++){
  Start-Sleep -Milliseconds 300
  $done=Invoke-RestMethod -Uri "$url/api/jobs/$($started.jobId)" -Headers $headers -TimeoutSec 5
  $audit=$done.outputPacketAuditState
 }
 if($audit -ne 'ready' -or $done.outputPacketEvidence.scope -ne 'completed-artifact' -or
   [string]$done.outputPacketEvidence.artifactJobId -ne [string]$started.jobId -or
   [long]$done.outputPacketEvidence.artifactBytes -ne [long]$done.outputBytes -or
   @($done.outputPacketEvidence.audioPacketBytes).Count -ne 1 -or
   [long]$done.outputPacketEvidence.audioPacketBytes[0] -le 0){
  throw ('Native long completed packet audit unavailable: '+$audit)
 }
 $stage=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$started.jobId+'-*'))
 if($stage.Count -ne 1){throw 'Native staged long output absent.'}
 $output=Join-Path $stage[0].FullName 'output.mkv'
 $stat=Get-Item -LiteralPath $output -ErrorAction Stop
 if([long]$stat.Length -ne [long]$done.outputPacketEvidence.artifactBytes -or
   [string]$stat.LastWriteTimeUtc.Ticks -ne [string]$done.outputPacketEvidence.artifactWriteTicks){
  throw 'Long output file stat differs from FFprobe audit receipt.'
 }
 $sum=0L
 foreach($line in @(& ffprobe -v error -select_streams a:0 -show_packets -show_entries packet=size -of csv=p=0 $output)){
  if($line -match '^[0-9]+$'){$sum += [long]$line}
 }
 if($sum -le 0 -or $sum -ne [long]$done.outputPacketEvidence.audioPacketBytes[0]){
  throw 'Long completed FLAC packet receipt disagrees with independent FFprobe.'
 }
  $videoBytes=0L
 foreach($packet in @(& ffprobe -v error -select_streams v:0 -show_packets -show_entries packet=size -of csv=p=0 $output)){
  if($packet -match '^[0-9]+$'){$videoBytes += [long]$packet}
 }
 if($videoBytes -le 0 -or @($done.outputPacketEvidence.videoPacketBytes).Count -ne 1 -or
    [long]$done.outputPacketEvidence.videoPacketBytes[0] -ne $videoBytes){
  throw 'Long Native async video packet ledger disagrees with independent FFprobe.'
 }
 $codecBytes=$sum+$videoBytes
 foreach($entry in @($done.outputPacketEvidence.subtitlePacketBytes)){$codecBytes += [long]$entry}
 if($codecBytes -gt [long]$done.outputBytes){throw 'Long packet sum exceeds actual output bytes.'}
 Write-Host ('B16 actual 182-second Native FFprobe async packet total='+$sum+'; polledRunning='+$sawRunning)
 [IO.File]::AppendAllText($output,'B16_LONG_MUTATION',(New-Object Text.UTF8Encoding($false)))
 $invalid=Invoke-RestMethod -Uri "$url/api/jobs/$($started.jobId)" -Headers $headers -TimeoutSec 5
 if($null -ne $invalid.outputPacketEvidence -or $invalid.outputPacketAuditState -ne 'unavailable'){
  throw 'Long completed FLAC packet receipt survived staged artifact modification.'
 }
 Write-Host 'B16 asynchronous long-output packet receipt revoked after actual staged file mutation.'
}finally{
 if($server){try{if(-not $server.HasExited){Stop-Process -Id $server.Id -Force}}catch{}}
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
