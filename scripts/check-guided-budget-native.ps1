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
  # B11: actual paired source with ASS rendered SSIM, never Manual source SSIM.
  $utf8=New-Object Text.UTF8Encoding($false)
  $assPath=Join-Path $work 'reference-ass.txt'
  [IO.File]::WriteAllText($assPath,$subtitle,$utf8)
  $sha=(Get-FileHash -LiteralPath $assPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipts=@()
  foreach($start in @(0.0,1.0)){
    $options=@{sampleExact=$true;guidedRenderedReference=$true;withSubtitles=$true
      measureSsim=$true;codec='h264';encoder='libx264';preset='medium'
      multipass='disabled';targetVideoBitrate=650000;start=$start;duration=0.8;timeoutSeconds=45}
    $body=@{requestId=[guid]::NewGuid().ToString('N');options=$options;assText=$subtitle}|ConvertTo-Json -Depth 9
    $actual=Invoke-RestMethod -Method Post -Uri "$hostUrl/api/sample" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 90
    $e=$actual.nativeEvidence
    if(-not $actual.ok -or $e.method -ne 'windows-native-exact-guided-ass-vbr-v1' -or
       $e.referenceDomain -ne 'guided-ass-rendered' -or $e.assTextSha256 -ne $sha -or
       $e.requestedRate -ne 650000 -or $actual.ssim -le 0.8 -or
       $actual.totalVideoBytes -le 0){throw 'Real Native ASS-rendered VBR receipt rejected.'}
    $receipts+=,$e
  }
  if($receipts[0].sourceToken -ne $receipts[1].sourceToken -or
     $receipts[0].runtimeToken -ne $receipts[1].runtimeToken -or
     $receipts[0].fontContentSha256 -ne $receipts[1].fontContentSha256){
    throw 'Paired Guided rendered VBR provenance drift.'
  }
  Write-Host 'B11 Native paired ASS VBR FFmpeg source and digest checks passed.'
  # Manual and guided jobs share the completed/export byte guard.
  $cost=Invoke-RestMethod -Method Post -Uri "$hostUrl/api/source-budget" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 80
  if($cost.scope -ne 'full-source' -or @($cost.audioPacketBytes).Count -ne 2 -or [long]$cost.audioPacketBytes[0] -le 0){throw 'Native whole-source cost evidence is incomplete.'}
  $sum=0L
  foreach($line in (& ffprobe -v error -select_streams a:0 -show_packets -show_entries packet=size -of csv=p=0 $source)){$sum += [long]$line}
  if($sum -ne [long]$cost.audioPacketBytes[0]){throw 'Native packet-byte ledger differs from independent FFprobe scan.'}
  function Assert-GuidedCopyReceiptRejected($receipt,[string]$label,[string]$expected='Budget measurement',[int]$declaredTracks=2) {
    $req=@{codec='h264';mode='budget-rate';preset='medium';crf=23
      targetVideoBitrate=350000;sizeBudgetPolicy='best-effort';sizeCeilingBytes=5000000
      outputWidth=0;outputHeight=0;expectedDuration=2.0
      audio='copy';expectedAudioTracks=$declaredTracks;outputFormat='matroska';outputExtension='mkv'
      suggestedName='must-not-start.mkv'}
    if($null -ne $receipt){$req.budgetEvidence=$receipt}
    $body=@{request=$req;assText=$subtitle}|ConvertTo-Json -Depth 12 -Compress
    $rejected=$false
    try{
      Invoke-RestMethod -Method Post -Uri "$hostUrl/api/encode" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 15|Out-Null
    }catch{
      $rejected=$true
      $errorBody=[string]$_.ErrorDetails.Message
      if($errorBody -notmatch $expected){throw "Unexpected $label rejection: $errorBody"}
    }
    if(-not $rejected){throw "Guided copied-audio task accepted $label receipt"}
  }
  Assert-GuidedCopyReceiptRejected $null 'missing'
  Assert-GuidedCopyReceiptRejected $null 'forged zero-track count' 'track count differs' 0
  $wrong=$cost | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $wrong.measurementId='not-the-current-measurement'
  Assert-GuidedCopyReceiptRejected $wrong 'stale'
  $wrongCost=$cost | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $wrongCost.audioPacketBytes[0]=[long]$wrongCost.audioPacketBytes[0]+1L
  Assert-GuidedCopyReceiptRejected $wrongCost 'tampered copied packet bytes' 'Measured copied-audio packet costs'
  Write-Host 'Guided unmeasured, stale and tampered copied-audio receipts fail closed.'
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
      $stage=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ("quick-media-job-"+[string]$started.jobId+"-*"))
      if($stage.Count -ne 1 -or -not(Test-Path -LiteralPath (Join-Path $stage[0].FullName 'output.mkv'))){throw 'Manual verified oversized container was deleted.'}
      $blocked=$false
      try{Invoke-RestMethod -Method Post -Uri "$hostUrl/api/jobs/$($started.jobId)/export" -Headers $headers -ContentType 'application/json' -Body '{}' | Out-Null}catch{$blocked=$true}
      if(-not $blocked){throw 'Manual oversized artifact reached save dialog.'}
    }elseif($result.state -ne 'completed' -or [long]$result.outputBytes -gt $ceiling -or [long]$result.outputBytes -le 0){throw 'Manual within-budget artifact acceptance failed.'}
  }
  # B16: a real trimmed two-audio size task gets an independently measured
  # completed-output packet ledger; it must not rewrite the preflight whole
  # source copied-payload upper bound or bypass the strict container gate.
  $sourceUpper=[long]$cost.audioPacketBytes[0]+[long]$cost.audioPacketBytes[1]
  $trimTask=@{
    version=4;operation='transcode';codec='h264';encoder='libx264'
    start=0.5;end=1.5;hasTrimRange=$true;usesTrimInput=$true
    videoStreams=@(0);videoRange='trim';expectedVideoTracks=1;expectedVideoDuration=1.0
    audio='copy';audioTrack='all';audioRange='trim';expectedAudioTracks=2;expectedDuration=1.0
    keepSubtitles=$false;keepAttachments=$false;rateMode='size'
    budgetPolicy='strict-ceiling';sizeCeilingBytes=5000000L
    outputFormat='matroska';outputExtension='mkv';budgetEvidence=$cost
    sizePlan=@{copiedTrimReserveBytes=$sourceUpper}
    outputArgs=@('-ss','0','-map','1:v:0','-map','1:a?','-sn',
      '-map_metadata','-1','-map_chapters','-1','-c:v','libx264',
      '-preset','medium','-b:v','350000','-pix_fmt','yuv420p',
      '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0','-c:a','copy')
  }
  $trimBody=@{request=@{task=$trimTask;expectedDuration=1.0;suggestedName='trim-audit.mkv'}}|ConvertTo-Json -Depth 16 -Compress
  $trimStarted=Invoke-RestMethod -Method Post -Uri "$hostUrl/api/encode" -Headers $headers -ContentType 'application/json' -Body $trimBody
  if(-not $trimStarted.ok -or -not $trimStarted.jobId){throw 'B16 Native trim audit task was not created'}
  $trimStatus=$null
  for($poll=0;$poll -lt 120;$poll++){
    Start-Sleep -Milliseconds 150
    $trimStatus=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$($trimStarted.jobId)" -Headers $headers
    if($trimStatus.state -in @('completed','failed','cancelled')){break}
  }
  if($trimStatus.state -ne 'completed'){throw ('Native trim audit failed: '+$trimStatus.error)}
  if($trimStatus.outputPacketEvidence.scope -ne 'completed-artifact' -or
     @($trimStatus.outputPacketEvidence.audioPacketBytes).Count -ne 2){
    throw 'Native completed trim task did not report two measured output audio packet totals'
  }
  $trimStages=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ("quick-media-job-"+$trimStarted.jobId+"-*"))
  if($trimStages.Count -ne 1){throw 'Native trim audit staged output not found'}
  $trimArtifact=Join-Path $trimStages[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $trimArtifact)){throw 'Native trim audit output file absent'}
  $trimTotal=0L
  for($track=0;$track -lt 2;$track++){
    $selector="a:$track";$independent=0L
    foreach($packet in (& ffprobe -v error -select_streams $selector -show_packets -show_entries packet=size -of csv=p=0 $trimArtifact)){
      $independent+=[long]$packet
    }
    $reported=[long]$trimStatus.outputPacketEvidence.audioPacketBytes[$track]
    if($reported -le 0 -or $reported -ne $independent -or $reported -gt [long]$cost.audioPacketBytes[$track]){
      throw "Native trim packet audit diverged from independent output FFprobe for $selector"
    }
    $trimTotal+=$reported
  }
  if($trimTotal -ge $sourceUpper -or [long]$trimStatus.outputBytes -gt 5000000L){
    throw 'Native trim output did not demonstrate a smaller observed packet payload under the strict container gate'
  }
  $again=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$($trimStarted.jobId)" -Headers $headers
  if(@($again.outputPacketEvidence.audioPacketBytes).Count -ne 2 -or
      [long]$again.outputPacketEvidence.audioPacketBytes[0] -ne
      [long]$trimStatus.outputPacketEvidence.audioPacketBytes[0]){
    throw 'Repeated Native completed job status lost the cached trim cost observation'
  }
  # Independent short-media exercise of the same asynchronous worker that
  # Windows Bridge uses for long completed output. It must not modify output.
  $auditReceipt=Join-Path $work 'long-audit-worker-receipt.json'
  $workerPath=(Resolve-Path './windows/trim-packet-audit.ps1').Path
  $ffprobeExe=(Get-Command ffprobe.exe -ErrorAction Stop).Source
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $workerPath -Ffprobe $ffprobeExe -OutputFile $trimArtifact -ReceiptFile $auditReceipt
  if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $auditReceipt)){
    throw 'B16 separate bounded post-output FFprobe worker failed.'
  }
  $workerEvidence=Get-Content -Raw -LiteralPath $auditReceipt | ConvertFrom-Json
  $artifactStamp=Get-Item -LiteralPath $trimArtifact
  if([string]$workerEvidence.scope -ne 'completed-artifact' -or
     [long]$workerEvidence.sourceLength -ne [long]$artifactStamp.Length -or
     [long]$workerEvidence.sourceWriteTicks -ne [long]$artifactStamp.LastWriteTimeUtc.Ticks -or
     @($workerEvidence.audioPacketBytes).Count -ne 2 -or
     [long]$workerEvidence.audioPacketBytes[0] -ne [long]$trimStatus.outputPacketEvidence.audioPacketBytes[0] -or
     [long]$workerEvidence.audioPacketBytes[1] -ne [long]$trimStatus.outputPacketEvidence.audioPacketBytes[1]){
    throw 'B16 independent async worker receipt differs from synchronous FFprobe output audit.'
  }
  Write-Host 'B16 isolated packet worker, source stamp and independent copied-audio totals passed.'
  Write-Host "B16 Native completed trim copy packet audit passed: source upper $sourceUpper, actual $trimTotal bytes."
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
    $request=@{codec='h264';mode='budget-rate';preset='medium';crf=23
      targetVideoBitrate=350000;sizeBudgetPolicy=$policy;sizeCeilingBytes=$ceiling
      outputWidth=0;outputHeight=0;expectedDuration=2.0
      audio=$audioMode;expectedAudioTracks=$audioTracks;outputFormat='matroska';outputExtension='mkv'
      suggestedName="guided-$policy.mkv"}
    if($audioMode -eq 'copy' -and $audioTracks -gt 0){$request.budgetEvidence=$cost}
    $request.plannedWholeFileBytes=80000L
    $request.budgetCostBasis=if($audioMode -eq 'copy'){'measured-source-packets'}else{'planned-audio'}
    $body=@{request=$request;assText=$subtitle}|ConvertTo-Json -Depth 12 -Compress
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
      if($ceiling -gt 0){
        $receipt=$result.budgetProjection
        if(-not $receipt -or [long]$receipt.plannedBytes -ne 80000L -or
            [long]$receipt.budgetBytes -ne $ceiling -or [string]$receipt.policy -ne $policy){
          throw 'Guided Native completed status dropped its original byte-budget projection'
        }
        if([bool]$receipt.strictVerified -ne ($policy -eq 'strict-ceiling')){
          throw 'Native strict completion proof mismatches actual acceptance policy'
        }
      }
      $again=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$($started.jobId)" -Headers $headers
      if($again.state -ne 'completed'){throw 'Completed staged output is not retained'}
      if($ceiling -gt 0 -and
         ([long]$again.budgetProjection.plannedBytes -ne [long]$result.budgetProjection.plannedBytes -or
          [long]$again.budgetProjection.budgetBytes -ne [long]$result.budgetProjection.budgetBytes -or
          [bool]$again.budgetProjection.strictVerified -ne [bool]$result.budgetProjection.strictVerified)){
        throw 'Repeated completed Native status changed or dropped its budget receipt'
      }
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
  $copyId=Test-PolicyRun 'two-pass' 5000000 $false 'copy' 2
  $copyStages=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ("quick-hardsub-job-"+$copyId+"-*"))
  if($copyStages.Count -ne 1){throw 'Expected Native Guided ASS copied-audio output stage'}
  $copyOutput=Join-Path $copyStages[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $copyOutput)){throw 'Guided copied-audio stage has no output'}
  $copyStatus=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$copyId" -Headers $headers
  if($copyStatus.state -ne 'completed' -or [long]$copyStatus.outputBytes -ne (Get-Item $copyOutput).Length){
    throw 'Guided Native status whole-container bytes differ from the stored output'
  }
  $copiedTotal=0L
  for($track=0;$track -lt 2;$track++){
    $selector="a:$track"
    $sourcePackets=((& ffprobe -v error -select_streams $selector -show_packets -show_data_hash sha256 -show_entries packet=data_hash,size -of json $source | Out-String) | ConvertFrom-Json).packets
    $outputPackets=((& ffprobe -v error -select_streams $selector -show_packets -show_data_hash sha256 -show_entries packet=data_hash,size -of json $copyOutput | Out-String) | ConvertFrom-Json).packets
    if($LASTEXITCODE -ne 0 -or @($sourcePackets).Count -le 0 -or @($outputPackets).Count -ne @($sourcePackets).Count){
      throw "Guided Native audio packet count mismatch for $selector"
    }
    for($i=0;$i -lt @($sourcePackets).Count;$i++){
      if([string]$sourcePackets[$i].data_hash -ne [string]$outputPackets[$i].data_hash){
        throw "Guided Native copied audio payload changed for $selector packet $i"
      }
      $copiedTotal += [long]$sourcePackets[$i].size
    }
  }
  if($copiedTotal -ne ([long]$cost.audioPacketBytes[0]+[long]$cost.audioPacketBytes[1])){
    throw 'Guided Native output copied packet total diverged from the measured source ledger'
  }
  Write-Host "Guided Native source-owned two-audio packets SHA256 identity, ledger and actual container bytes passed: $copyId"
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
