# Real Windows Native localhost bridge regression: guided two-pass/strict output.
# Synthetic software source, not physical NVENC or full long-form user acceptance.
$ErrorActionPreference='Stop'
$work=Join-Path $env:RUNNER_TEMP ('guided-budget-policy-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$source=Join-Path $work 'input.mkv'
& ffmpeg -hide_banner -nostdin -loglevel error -y -f lavfi -i 'testsrc2=size=320x180:rate=15:duration=2' -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=2' -f lavfi -i 'sine=frequency=880:sample_rate=48000:duration=2' -map 0:v -map 1:a -map 2:a -c:v ffv1 -c:a pcm_s16le -shortest $source
if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $source)){throw 'Guided native fixture failed'}
$port=8897
$hostUrl="http://127.0.0.1:$port"
$headers=@{'X-Quick-Hardsub-Token'='ci-guided-budget-token';Origin=$hostUrl}
$stdout=Join-Path $work 'bridge-out.log'
$stderr=Join-Path $work 'bridge-err.log'
$bridge=Start-Process powershell.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -ArgumentList @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File',(Resolve-Path './windows/native-bridge.ps1'),
  '-NoBrowser','-Port',[string]$port,'-Token','ci-guided-budget-token','-InitialVideo',$source)
$subtitle=@'
[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Budget fixture
'@
try {
  $ready=$false
  for($n=0;$n -lt 50;$n++){
    Start-Sleep -Milliseconds 300
    try{
      $health=Invoke-RestMethod -Uri "$hostUrl/api/health" -Headers $headers -TimeoutSec 3
      if($health.available){$ready=$true;break}
    }catch{}
  }
  if(-not $ready){
    if(Test-Path $stdout){Get-Content -Raw $stdout|Write-Host}
    if(Test-Path $stderr){Get-Content -Raw $stderr|Write-Host}
    throw 'Guided bridge failed to start'
  }
  # Manual and guided jobs share the completed/export byte guard.
  $cost=Invoke-RestMethod -Method Post -Uri "$hostUrl/api/source-budget" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 80
  if($cost.scope -ne 'full-source' -or @($cost.audioPacketBytes).Count -ne 2 -or [long]$cost.audioPacketBytes[0] -le 0){throw 'Native whole-source cost evidence is incomplete.'}
  $sum=0L
  foreach($line in (& ffprobe -v error -select_streams a:0 -show_packets -show_entries packet=size -of csv=p=0 $source)){$sum += [long]$line}
  if($sum -ne [long]$cost.audioPacketBytes[0]){throw 'Native packet-byte ledger differs from independent FFprobe scan.'}
  foreach($ceiling in @(100L,500000L)){
    $task=@{version=4;operation='transcode';start=0;end=2;twoPass=$false;rateMode='size';budgetPolicy='strict-ceiling';sizeCeilingBytes=$ceiling;expectedAudioTracks=0
      outputFormat='matroska';outputExtension='mkv';videoStreams=@(0);videoRange='full';audio='none';audioRange='full';keepSubtitles=$false;budgetEvidence=$cost
      outputArgs=@('-map','0:v:0','-sn','-map_metadata','-1','-map_chapters','-1','-c:v','libx264','-preset','medium','-b:v','350000','-pix_fmt','yuv420p','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0')}
    $body=@{request=@{task=$task;expectedDuration=2.0;suggestedName='manual-budget.mkv'}} | ConvertTo-Json -Depth 12 -Compress
    $started=Invoke-RestMethod -Method Post -Uri "$hostUrl/api/encode" -Headers $headers -ContentType 'application/json' -Body $body
    $result=$null
    for($i=0;$i -lt 100;$i++){
      Start-Sleep -Milliseconds 150
      $result=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$($started.jobId)" -Headers $headers
      if($result.state -in @('completed','failed','cancelled')){break}
    }
    if($ceiling -eq 100L){
      if($result.state -ne 'failed' -or $result.error -notlike '*Strict container byte ceiling exceeded*'){throw 'Manual oversized container was not rejected.'}
      $stage=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ("quick-hardsub-job-"+[string]$started.jobId+"-*"))
      if($stage.Count -ne 1 -or -not(Test-Path -LiteralPath (Join-Path $stage[0].FullName 'output.mkv'))){throw 'Manual verified oversized container was deleted.'}
      $blocked=$false
      try{Invoke-RestMethod -Method Post -Uri "$hostUrl/api/jobs/$($started.jobId)/export" -Headers $headers -ContentType 'application/json' -Body '{}' | Out-Null}catch{$blocked=$true}
      if(-not $blocked){throw 'Manual oversized artifact reached save dialog.'}
    }elseif($result.state -ne 'completed' -or [long]$result.outputBytes -gt $ceiling -or [long]$result.outputBytes -le 0){throw 'Manual within-budget artifact acceptance failed.'}
  }
  Write-Host 'Manual byte ceilings, blocked oversized export and independent source-cost scan passed.'
  function Test-CancelCleanup([int]$phase){
    $body=@{
      request=@{codec='h264';mode='budget-rate';preset='medium';crf=23
        targetVideoBitrate=350000;sizeBudgetPolicy='two-pass';sizeCeilingBytes=0
        outputWidth=0;outputHeight=0;expectedDuration=2.0
        audio='none';outputFormat='matroska';outputExtension='mkv'
        suggestedName='cancelled.mkv'}
      assText=$subtitle
    }|ConvertTo-Json -Depth 8 -Compress
    $started=Invoke-RestMethod -Method Post -Uri "$hostUrl/api/encode" -Headers $headers -ContentType 'application/json' -Body $body
    if(-not $started.ok -or -not $started.jobId){throw 'Cancel fixture did not start'}
    $id=[string]$started.jobId
    $stages=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ("quick-hardsub-job-"+$id+"-*"))
    if($stages.Count -ne 1){throw 'Cancel fixture staging missing'}
    if($phase -eq 2){
      $observed=$false
      for($i=0;$i -lt 100;$i++){
        $state=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$id" -Headers $headers
        if($state.state -eq 'encoding' -and $state.pass -eq 2){$observed=$true;break}
        if($state.state -in @('failed','completed','cancelled')){throw 'Cancel fixture terminated before pass 2 could be cancelled'}
        Start-Sleep -Milliseconds 20
      }
      if(-not $observed){throw 'Cancel fixture never entered pass 2'}
    }
    Invoke-RestMethod -Method Post -Uri "$hostUrl/api/jobs/$id/cancel" -Headers $headers | Out-Null
    # Crucially, do NOT query status before inspecting cleanup. A disconnected
    # UI must not leave cancelled ASS/font copies, output or pass logs behind.
    if(Test-Path -LiteralPath $stages[0].FullName){throw "Pass $phase cancellation left staging behind without status polling"}
    Invoke-RestMethod -Method Post -Uri "$hostUrl/api/jobs/$id/cancel" -Headers $headers | Out-Null
    for($i=0;$i -lt 2;$i++){
      $state=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$id" -Headers $headers
      if($state.state -ne 'cancelled'){throw 'Cancellation terminal state is not stable'}
    }
    $blocked=$false
    try{Invoke-RestMethod -Method Post -Uri "$hostUrl/api/jobs/$id/export" -Headers $headers -ContentType 'application/json' -Body '{}' | Out-Null}catch{$blocked=$true}
    if(-not $blocked){throw 'Cancelled job reached export'}
    Write-Host "Pass $phase cancellation cleaned staging without status polling; repeat cancel/status and export rejection passed"
  }
  Test-CancelCleanup 1
  Test-CancelCleanup 2
  function Test-PolicyRun([string]$policy,[long]$ceiling,[bool]$shouldFail,[string]$audioMode='none',[int]$audioTracks=0){
    $body=@{
      request=@{codec='h264';mode='budget-rate';preset='medium';crf=23
        targetVideoBitrate=350000;sizeBudgetPolicy=$policy;sizeCeilingBytes=$ceiling
        outputWidth=0;outputHeight=0;expectedDuration=2.0
        audio=$audioMode;expectedAudioTracks=$audioTracks;outputFormat='matroska';outputExtension='mkv'
        suggestedName="guided-$policy.mkv"}
      assText=$subtitle
    }|ConvertTo-Json -Depth 8 -Compress
    $started=Invoke-RestMethod -Method Post -Uri "$hostUrl/api/encode" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 15
    if(-not $started.ok -or -not $started.jobId){throw "$policy encode refused to start"}
    if($started.encoder -ne 'libx264' -or $started.hardware){throw "$policy must use explicit software libx264"}
    $seenPass1=$false;$seenPass2=$false
    $result=$null
    for($i=0;$i -lt 100;$i++){
      Start-Sleep -Milliseconds 170
      $result=Invoke-RestMethod -Method Get -Uri "$hostUrl/api/jobs/$($started.jobId)" -Headers $headers -TimeoutSec 15
      if($result.totalPasses -eq 2 -and $result.pass -eq 1){$seenPass1=$true}
      if($result.totalPasses -eq 2 -and $result.pass -eq 2){$seenPass2=$true}
      if($result.state -in @('failed','completed','cancelled')){break}
    }
    if($null -eq $result -or $result.state -notin @('failed','completed')){throw "$policy did not reach terminal state"}
    if($shouldFail){
      if($result.state -ne 'failed' -or $result.error -notmatch 'Strict container byte ceiling exceeded'){
        throw "Strict byte reject failed: $($result|ConvertTo-Json -Compress)"
      }
      $again=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$($started.jobId)" -Headers $headers
      if($again.state -ne 'failed'){throw 'Strict failed task became exportable after repeated status query'}
      $leftovers=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ("quick-hardsub-job-"+$started.jobId+"-*"))
      if($leftovers.Count){throw 'Failed strict task left private staging behind'}
    }else{
      if($result.state -ne 'completed' -or $result.outputBytes -le 0){throw "$policy never produced a valid output"}
      if($policy -eq 'strict-ceiling' -and $result.outputBytes -gt $ceiling){throw 'Strict success exceeded byte ceiling'}
      $again=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$($started.jobId)" -Headers $headers
      if($again.state -ne 'completed'){throw 'Completed staged output is not retained'}
      $lateCancel=Invoke-RestMethod -Method Post -Uri "$hostUrl/api/jobs/$($started.jobId)/cancel" -Headers $headers
      if($lateCancel.state -ne 'completed'){throw 'Late cancel invalidated a completed output'}
      $again=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$($started.jobId)" -Headers $headers
      if($again.state -ne 'completed' -or $again.outputBytes -ne $result.outputBytes){throw 'Late cancel lost completed staging'}
    }
    Write-Host ("$policy result="+$result.state+" encoder="+$started.encoder+" bytes="+$result.outputBytes+
      " saw-pass1="+$seenPass1+" saw-pass2="+$seenPass2)
    # A 2-second first pass may complete before HTTP status polling starts.
    # A successful second pass requires the first-pass stats on disk; the
    # observable stage-2 status and complete output are authoritative here.
    if(-not $seenPass2){throw "$policy second-pass status was never observed"}
    return [string]$started.jobId
  }
  # Real two-pass remux must preserve both selected source audio tracks.
  Test-PolicyRun 'two-pass' 0 $false 'copy' 2 | Out-Null
  Test-PolicyRun 'strict-ceiling' 1024 $true | Out-Null
  $tamperId=Test-PolicyRun 'strict-ceiling' 5000000 $false 'copy' 2
  # A prior completed status is NOT authorization to export an arbitrarily
  # modified staged file. Enlarge it after success, then re-query and export.
  $stages=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ("quick-hardsub-job-"+$tamperId+"-*"))
  if($stages.Count -ne 1){throw "Expected one private staging folder for $tamperId"}
  $stagedFile=Join-Path $stages[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $stagedFile)){throw 'Strict completed staged output missing'}
  $handle=[IO.File]::OpenWrite($stagedFile)
  try{$handle.SetLength(5000001L)}finally{$handle.Dispose()}
  $stale=Invoke-RestMethod -Method Get -Uri "$hostUrl/api/jobs/$tamperId" -Headers $headers -TimeoutSec 15
  if($stale.state -ne 'failed' -or $stale.error -notmatch 'Strict container byte ceiling exceeded'){
    throw "Mutated completed strict output was accepted: $($stale|ConvertTo-Json -Compress)"
  }
  if(Test-Path -LiteralPath $stagedFile){throw 'Oversized strict stage was not removed'}
  $exportBlocked=$false
  try {
    $exportBody=@{suggestedName='must-not-export.mkv'}|ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$hostUrl/api/jobs/$tamperId/export" -Headers $headers -ContentType 'application/json' -Body $exportBody -TimeoutSec 15 | Out-Null
  } catch {
    $exportBlocked=$true
  }
  if(-not $exportBlocked){throw 'Failed strict job unexpectedly reached save/export'}
  Write-Host ('Post-completion stage tamper rejected; export blocked: '+$tamperId)
  # This case stays BELOW the ceiling and keeps the exact byte count. The
  # earlier size-only checks could not detect a rewritten container here.
  $equalId=Test-PolicyRun 'strict-ceiling' 5000000 $false 'copy' 2
  $equalStages=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ("quick-hardsub-job-"+$equalId+"-*"))
  if($equalStages.Count -ne 1){throw "Expected one equal-size stage for $equalId"}
  $equalFile=Join-Path $equalStages[0].FullName 'output.mkv'
  $oldInfo=Get-Item -LiteralPath $equalFile
  $oldLength=[long]$oldInfo.Length
  $oldWrite=$oldInfo.LastWriteTimeUtc
  $stream=[IO.File]::Open($equalFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {
    if($stream.Length -lt 100){throw 'Equal-length fixture is unexpectedly short'}
    $stream.Position=64
    $oldByte=$stream.ReadByte()
    if($oldByte -lt 0){throw 'Cannot read staged byte'}
    $stream.Position=64
    $stream.WriteByte([byte]($oldByte -bxor 1))
  }finally{$stream.Dispose()}
  [IO.File]::SetLastWriteTimeUtc($equalFile,$oldWrite.AddSeconds(5))
  if((Get-Item -LiteralPath $equalFile).Length -ne $oldLength){
    throw 'Equal-length corruption fixture modified the byte count'
  }
  $equalStatus=Invoke-RestMethod -Method Get -Uri "$hostUrl/api/jobs/$equalId" -Headers $headers -TimeoutSec 15
  if($equalStatus.state -ne 'failed' -or $equalStatus.error -notmatch 'fingerprint verification failed'){
    throw "Equal-length stage tamper escaped strict content guard: $($equalStatus|ConvertTo-Json -Compress)"
  }
  if(Test-Path -LiteralPath $equalFile){throw 'Corrupted equal-length strict stage was not removed'}
  $equalBlocked=$false
  try {
    Invoke-RestMethod -Method Post -Uri "$hostUrl/api/jobs/$equalId/export" -Headers $headers -ContentType 'application/json' -Body $exportBody -TimeoutSec 15 | Out-Null
  } catch {$equalBlocked=$true}
  if(-not $equalBlocked){throw 'Equal-length tampered strict job unexpectedly exported'}
  Write-Host ('Equal-length stage tamper rejected; export blocked: '+$equalId)
}finally{
  try{if($bridge -and -not $bridge.HasExited){Stop-Process -Id $bridge.Id -Force}}catch{}
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
