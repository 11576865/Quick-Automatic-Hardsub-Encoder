# WU02: real Windows localhost Native Bridge, FFmpeg and source-bound MKV assets.
$ErrorActionPreference='Stop'
$work=Join-Path $env:RUNNER_TEMP ('wu02-embedded-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work -Force)
$source=Join-Path $work 'source.mkv'
# Only this isolated GitHub Actions temporary directory can be chosen as the
# simulated user's dialog destination. The actual production API never accepts
# a browser-provided path and still uses a real Windows SaveFileDialog.
$exportDirectory=Join-Path $work 'verified-delivery'
[void](New-Item -ItemType Directory -Path $exportDirectory -Force)
$port=9361
$root="http://127.0.0.1:$port"
$headers=@{'X-Quick-Hardsub-Token'='wu02-ci-token';Origin=$root}
$bridge=$null
try {
  & node './scripts/build-manual-rich-native-fixture.mjs' $work
  if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $source)){throw 'Rich MKV fixture missing'}
  $sourceSecond=Join-Path $work 'source-second.mkv'
  Copy-Item -LiteralPath $source -Destination $sourceSecond
  $outlog=Join-Path $work 'bridge-stdout.log'
  $errlog=Join-Path $work 'bridge-stderr.log'
  $bridge=Start-Process powershell.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput $outlog -RedirectStandardError $errlog -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Resolve-Path './windows/native-bridge.ps1'),'-NoBrowser','-Port',[string]$port,'-Token','wu02-ci-token','-InitialVideo',$source,'-CiSaveDirectory',$exportDirectory,'-CiBatchVideoSeedList',($source+'|'+$sourceSecond))
  $ready=$false
  for($i=0;$i -lt 65;$i++){
    Start-Sleep -Milliseconds 300
    try{
      $health=Invoke-RestMethod -Uri "$root/api/health" -Headers $headers -TimeoutSec 3
      if($health.available){$ready=$true;break}
    }catch{}
  }
  if(-not $ready){throw 'Native Bridge failed to start'}
  # Query the authenticated live Bridge, NOT redirected PowerShell stdout:
  # the process may buffer console logging while the HTTP server is healthy.
  # The Bridge reports only the restricted CI mode boolean, never the path.
  if($health.backend -ne 'windows-native' -or
     $health.ciSaveChooserActive -ne $true){
    throw 'WU13 CI preauthorized save chooser is not active on the live Native Bridge'
  }
  # B21: exercise the authenticated, real Bridge picker registry with two
  # distinct source files under RUNNER_TEMP. The live API never returns paths.
  $grants=Invoke-RestMethod -Method Post -Uri "$root/api/batch/videos/pick" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 45
  if(-not $grants.ok -or @($grants.files).Count -ne 2){throw 'B21 Native CI selector did not authorize two sources'}
  foreach($g in @($grants.files)){
    if(-not $g.id -or $g.path -or $g.fullName){throw 'B21 Native grant must contain opaque ID, never disk path'}
  }
  $secondGrant=@($grants.files | Where-Object { $_.name -eq 'source-second.mkv' })
  $firstGrant=@($grants.files | Where-Object { $_.name -eq 'source.mkv' })
  if($firstGrant.Count -ne 1 -or $secondGrant.Count -ne 1){throw 'B21 source grants do not match selected files'}
  $activateSecond=@{id=[string]$secondGrant[0].id}|ConvertTo-Json -Compress
  $activated=Invoke-RestMethod -Method Post -Uri "$root/api/batch/videos/activate" -Headers $headers -ContentType 'application/json' -Body $activateSecond -TimeoutSec 45
  if(-not $activated.ok -or $activated.file.name -ne 'source-second.mkv' -or
     $activated.probe.sourceOriginalName -ne 'source-second.mkv'){
    throw 'B21 independently activated second source was not actually probed'
  }
  $foreignDenied=$false
  try{
    [void](Invoke-RestMethod -Method Post -Uri "$root/api/batch/videos/activate" -Headers $headers -ContentType 'application/json' -Body '{"id":"not-authorized"}' -TimeoutSec 10)
  }catch{$foreignDenied=$true}
  if(-not $foreignDenied){throw 'B21 unauthorized source ID was accepted'}
  $activateFirst=@{id=[string]$firstGrant[0].id}|ConvertTo-Json -Compress
  $reactivated=Invoke-RestMethod -Method Post -Uri "$root/api/batch/videos/activate" -Headers $headers -ContentType 'application/json' -Body $activateFirst -TimeoutSec 45
  if(-not $reactivated.ok -or $reactivated.probe.sourceOriginalName -ne 'source.mkv'){
    throw 'B21 original source was not restored before pre-existing rich-MKV acceptance'
  }
  Write-Host 'B21 TWO REAL NATIVE SOURCE GRANTS PASS: opaque IDs, user-authorized scope, second FFprobe and original restoration.'
  $probe=Invoke-RestMethod -Method Post -Uri "$root/api/probe" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 45
  if(-not $probe.ok -or $probe.subtitleTracks -ne 1 -or $probe.attachmentTracks -ne 1){
    throw 'Source ASS or font attachment missing from actual probe'
  }
  $stat=Get-Item -LiteralPath $source
  function Import-Track([int]$ordinal,[string]$name,[long]$size){
    $body=@{subtitleOrdinal=$ordinal;sourceName=$name;sourceSize=$size}|ConvertTo-Json -Compress
    return Invoke-RestMethod -Method Post -Uri "$root/api/embedded-ass" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 90
  }
  $rejected=$false
  try{[void](Import-Track 42 $stat.Name $stat.Length)}catch{$rejected=$true}
  if(-not $rejected){throw 'Invalid embedded track was accepted'}
  $rejected=$false
  try{[void](Import-Track 0 'wrong-source.mkv' $stat.Length)}catch{$rejected=$true}
  if(-not $rejected){throw 'Foreign source identity was accepted'}
  $imported=Import-Track 0 $stat.Name $stat.Length
  if(-not $imported.ok -or -not $imported.sourceBound -or $imported.fontCount -ne 1 -or -not $imported.ass.base64 -or -not $imported.fonts[0].base64){
    throw 'Source-bound ASS/font asset import failed'
  }
  $importPath=Join-Path $work 'import.json'
  $probePath=Join-Path $work 'probe.json'
  $requestPath=Join-Path $work 'job.json'
  [IO.File]::WriteAllText($importPath,($imported|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($probePath,($probe|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
  # Pin exact fixture bytes to the official mustCopy audio compiler intent.
  # Bridge independently binds the selected embedded ASS/font to source stat.
  $sourceKey='sha256:'+(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  # WU11: native source-owned copy cost constrains the SAME budget,
  # sampled bitrate and official v4 Manual task. No arbitrary bitrate inputs.
  $whole=Invoke-RestMethod -Method Post -Uri "$root/api/source-budget" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 90
  if($whole.scope -ne 'full-source' -or @($whole.audioPacketBytes).Count -ne 2 -or -not $whole.measurementId){
    throw 'WU11 complete-source audio-cost measurement unavailable'
  }
  $budgetPath=Join-Path $work 'wu11-source-budget.json'
  $wu11TaskPath=Join-Path $work 'wu11-formal-task.json'
  $wu11PlanPath=Join-Path $work 'wu11-frozen-plan.json'
  $wu11AcceptedPath=Join-Path $work 'wu11-automated-acceptance.json'
  $utf8=New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($budgetPath,($whole|ConvertTo-Json -Depth 15),$utf8)
  & node './scripts/build-wu11-native-vbr-task.mjs' $probePath $budgetPath $wu11TaskPath $wu11PlanPath $sourceKey
  if($LASTEXITCODE -ne 0){throw 'WU11 official size budget and formal CPU task failed'}
  $wu11Plan=Get-Content -Raw -LiteralPath $wu11PlanPath | ConvertFrom-Json
  if([long]$wu11Plan.plan.targetVideoBitrate -lt 1000 -or
     $wu11Plan.measurementId -ne $whole.measurementId){throw 'WU11 sampled rate not frozen to current whole-source measurement'}
  # WU11 bounded real-source link: Native Guided VBR MUST use the same
  # selected rich MKV and the embedded ASS/font already imported above.
  # Existing WU02 formal output stays CRF23: this step does not yet claim
  # a selected VBR plan reached that final artifact.
  $assText=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($imported.ass.base64))
  $utf8=New-Object Text.UTF8Encoding($false)
  $assSha=[Security.Cryptography.SHA256]::Create()
  try{
    $sha=[BitConverter]::ToString($assSha.ComputeHash($utf8.GetBytes($assText))).Replace('-','').ToLowerInvariant()
  }finally{$assSha.Dispose()}
  $realSamples=@()
  foreach($start in @(0.0,1.0)){
    $options=@{sampleExact=$true;guidedRenderedReference=$true;withSubtitles=$true
      measureSsim=$true;codec='h264';encoder='libx264';preset='medium'
      multipass='disabled';targetVideoBitrate=[long]$wu11Plan.plan.targetVideoBitrate;start=$start;duration=0.8;timeoutSeconds=45}
    $payload=@{requestId=[guid]::NewGuid().ToString('N');options=$options;assText=$assText}|ConvertTo-Json -Depth 10
    $sample=Invoke-RestMethod -Method Post -Uri "$root/api/sample" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 90
    if(-not $sample.ok -or $sample.nativeEvidence.method -ne 'windows-native-exact-guided-ass-vbr-v1'){
      throw 'WU11 Native rich-MKV Guided rendered VBR sample was not returned'
    }
    $realSamples+=,[pscustomobject]@{window=@{start=$start;duration=0.8};assTextSha256=$sha;sample=$sample}
  }
  $afterSourceKey='sha256:'+(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  if($sourceKey -ne $afterSourceKey){throw 'WU11 rich MKV changed while collecting Native VBR evidence'}
  $paired=Join-Path $work 'wu11-rich-source-guided-paired-vbr.json'
  $pair=@{samples=$realSamples;assTextSha256=$sha
    sourceSha256Before=$sourceKey;sourceSha256After=$afterSourceKey}
  [IO.File]::WriteAllText($paired,($pair|ConvertTo-Json -Depth 20),$utf8)
  & node './scripts/check-wu11-guided-vbr-explicit-adoption.mjs' $paired $importPath $sourceKey $wu11PlanPath $wu11AcceptedPath
  if($LASTEXITCODE -ne 0){throw 'WU11 imported ASS/font and Guided VBR evidence identity verification failed'}
  Write-Host 'WU11 REAL NATIVE SAME-RICH-MKV PASS: source SHA, selected ASS and staged font agree in paired Guided VBR.'
  # Execute the ACTUAL original compiler's VBR task through this bridge;
  # the Native short-sample certificate is never copied into task authority.
  $wu11Formal=Get-Content -Raw -LiteralPath $wu11TaskPath | ConvertFrom-Json
  $wu11Request=@{request=$wu11Formal.request;assText=$assText}|ConvertTo-Json -Depth 20 -Compress
  $wu11Started=Invoke-RestMethod -Method Post -Uri "$root/api/encode" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $wu11Request -TimeoutSec 40
  if(-not $wu11Started.ok -or -not $wu11Started.jobId){throw 'WU11 formal Native VBR job was not started'}
  $wu11Result=$null
  for($i=0;$i -lt 240;$i++){
    Start-Sleep -Milliseconds 250
    $wu11Result=Invoke-RestMethod -Uri "$root/api/jobs/$($wu11Started.jobId)" -Headers $headers -TimeoutSec 15
    if($wu11Result.state -in @('completed','failed','cancelled')){break}
  }
  if($wu11Result.state -ne 'completed'){throw ('WU11 same-source Native VBR job incomplete: '+($wu11Result|ConvertTo-Json -Depth 8 -Compress))}
  $wu11Stage=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$wu11Started.jobId+'-*'))
  if($wu11Stage.Count -ne 1){throw 'WU11 completed Native VBR folder missing'}
  $wu11Output=Join-Path $wu11Stage[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $wu11Output)){throw 'WU11 completed Native VBR artifact missing'}
  if(('sha256:'+(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()) -ne $sourceKey){
    throw 'WU11 selected source mutated after sample, before formal output receipt'
  }
  & node './scripts/verify-wu11-native-vbr-output.mjs' $source $wu11Output $importPath $wu11TaskPath $wu11PlanPath $wu11AcceptedPath $work
  if($LASTEXITCODE -ne 0){throw 'WU11 independent Native formal VBR artifact verification failed'}
  Write-Host 'WU11 BOUNDED NATIVE MIXED VBR ARTIFACT PASS: same source/ASS/fonts, source-owned FLAC Copy plus AAC re-encode cost, formal bitrate, FLAC packet hashes, re-encoded AAC packets and burned pixels. Browser click not claimed.'
  # WU11: do NOT combine independent Chromium mocked transport and separately
  # encoded Native jobs into a single-session receipt. The same still-running
  # physical localhost Native Bridge is now accessed by one real Chromium page
  # through src/windows-native-client.js. Actual UI clicks must create ANOTHER
  # schema-v4 job; FFmpeg must finish and independently pass packet/pixel checks.
  $uiReceiptPath=Join-Path $work 'wu11-browser-native-receipt.json'
  & node './scripts/check-wu11-browser-native-session.cjs' $source $probePath $importPath $wu11PlanPath $uiReceiptPath
  if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $uiReceiptPath)){
    throw 'WU11 real Chromium Guided approval -> same-session Native job failed'
  }
  $uiReceipt=Get-Content -Raw -LiteralPath $uiReceiptPath | ConvertFrom-Json
  if($uiReceipt.kind -ne 'wu11-real-chromium-to-windows-native-v1' -or
     -not $uiReceipt.browserExplicitClicksObserved -or
     $uiReceipt.nativeResult.state -ne 'completed' -or
     -not $uiReceipt.jobId){throw 'Real Chromium-to-Native completion receipt is invalid'}
  $uiStage=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$uiReceipt.jobId+'-*'))
  if($uiStage.Count -ne 1){throw 'Real clicked-session Native FFmpeg output staging folder missing'}
  $uiOutput=Join-Path $uiStage[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $uiOutput)){throw 'Real clicked-session Native output.mkv missing'}
  & node './scripts/verify-wu11-browser-native-output.mjs' $source $uiOutput $uiReceiptPath $importPath $wu11PlanPath $work
  if($LASTEXITCODE -ne 0){throw 'WU11 real Chromium-to-Native artifact independent audit FAILED'}
  Write-Host 'WU11 REAL CHROMIUM TO WINDOWS NATIVE SAME-SESSION ARTIFACT PASS: clicked audio policy, genuine localhost Bridge job, source-locked FLAC packets, AAC re-encode, ASS font pixels and fresh source-budget transaction.'
  # WU12: remove the synthetic HTML host gap. This is the SHIPPING index.html
  # plus src/main.js: recover the Bridge-selected MKV in the UI, use the V3
  # import entry to import source-attached ASS/fonts, perform production Native
  # preflight + libass preview, then use the Manual audio UI to submit a formal
  # mixed-audio hardsub job. Its *own* jobId leads to an independent audit.
  $productionReceiptPath=Join-Path $work 'wu12-production-main-native-receipt.json'
  & node './scripts/check-wu12-production-main-native.cjs' $source $wu11PlanPath $productionReceiptPath $exportDirectory
  if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $productionReceiptPath)){
    # The Node oracle sees browser state; the Native Bridge stdout independently
    # establishes whether the export endpoint was reached or blocked at the dialog.
    Write-Host 'WU13 Native Bridge last requests (no auth headers):'
    Get-Content -LiteralPath $outlog -Tail 35 -ErrorAction SilentlyContinue | Write-Host
    Get-Content -LiteralPath $errlog -Tail 15 -ErrorAction SilentlyContinue | Write-Host
    throw 'WU12/WU13 shipping V3 Native source/import/preview/encode/save acceptance failed'
  }
  $productionReceipt=Get-Content -Raw -LiteralPath $productionReceiptPath | ConvertFrom-Json
  if($productionReceipt.kind -ne 'wu12-production-main-to-windows-native-v1' -or
     -not $productionReceipt.productionMainLoaded -or
     -not $productionReceipt.fullAppSourceImportClicked -or
     $productionReceipt.nativeResult.state -ne 'completed' -or
     -not $productionReceipt.jobId){
    throw 'WU12 shipping main.js Native completion receipt is invalid'
  }
  $productionStage=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$productionReceipt.jobId+'-*'))
  if($productionStage.Count -ne 1){throw 'WU12 shipping main.js job-specific Native stage missing'}
  $productionOutput=Join-Path $productionStage[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $productionOutput)){throw 'WU12 production main.js output.mkv missing'}
  # WU13: the browser actually used shipping V3's Save button; verify the
  # file published in the preauthorized CI "user directory" is the original
  # verified staging bytes, and run the independent stream/pixel oracle on
  # the DELIVERED file, not only on hidden private staging.
  if(-not $productionReceipt.browserSaveClicked -or
     $productionReceipt.displayedTaskState -ne 'saved' -or
     -not $productionReceipt.nativeExport.ok -or
     $productionReceipt.nativeExport.jobId -ne $productionReceipt.jobId){
    throw 'WU13 shipping V3 save did not complete for the same Native job'
  }
  $published=Join-Path $exportDirectory ([IO.Path]::GetFileName([string]$productionReceipt.request.suggestedName))
  if([IO.Path]::GetFullPath([string]$productionReceipt.nativeExport.path) -ne [IO.Path]::GetFullPath($published)){
    throw 'WU13 Native export returned an unexpected destination outside the user-choice scope'
  }
  if(-not(Test-Path -LiteralPath $published -PathType Leaf)){throw 'WU13 final saved MKV missing'}
  $stageHash=(Get-FileHash -LiteralPath $productionOutput -Algorithm SHA256).Hash.ToLowerInvariant()
  $savedHash=(Get-FileHash -LiteralPath $published -Algorithm SHA256).Hash.ToLowerInvariant()
  if($stageHash -ne $savedHash -or
     $savedHash -ne [string]$productionReceipt.nativeExport.sha256 -or
     (Get-Item -LiteralPath $published).Length -ne [long]$productionReceipt.nativeExport.bytes){
    throw 'WU13 saved bytes, staged FFmpeg output and Native signed-by-content receipt differ'
  }
  if(@(Get-ChildItem -LiteralPath $exportDirectory -File).Count -ne 1){
    throw 'WU13 export directory contains leftover backup/temp files'
  }
  & node './scripts/verify-wu11-browser-native-output.mjs' $source $published $productionReceiptPath $importPath $wu11PlanPath $work
  if($LASTEXITCODE -ne 0){throw 'WU13 published main.js output failed independent packet/pixel audit'}
  Write-Host 'WU13 PRODUCTION V3 SAVE VERIFIED PASS: original Native job, visible save click, replaced prior destination, stage/delivered SHA-256 equality and independently audited saved MKV.'
  Write-Host 'WU12 FULL PRODUCTION MAIN.JS WINDOWS NATIVE PASS: recovered MKV, UI import ASS/fonts, actual Native preview, source-budgeted Manual mixed-audio job, same job packet identity and ASS pixels.'
  # B21 is an independent live user-level batch after WU13's one-saved-file
  # sentinel and verified-published-file gate. It uses a second Chromium page,
  # the SAME live Bridge, and TWO real, separately saved source output jobs.
  $b21ReceiptPath=Join-Path $work 'b21-two-native-sources-receipt.json'
  & node './scripts/check-b21-windows-native-batch.cjs' $source $sourceSecond $exportDirectory $b21ReceiptPath
  if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $b21ReceiptPath)){
    throw 'B21 real shipping Chromium -> two Native source jobs -> two saved files acceptance failed'
  }
  $b21Receipt=Get-Content -Raw -LiteralPath $b21ReceiptPath|ConvertFrom-Json
  if($b21Receipt.result -ne 'PASS' -or
     $b21Receipt.sourceCount -ne 2 -or $b21Receipt.savedCount -ne 2 -or
     -not $b21Receipt.originalNativeTransport){
    throw 'B21 two-source saved-output receipt incomplete'
  }
  Write-Host 'B21 REAL TWO-SOURCE NATIVE BATCH PASS: shipping V3 -> two source probes -> two FFmpeg jobs -> two saved MKV SHA receipts.'

  & node './scripts/build-wu02-native-task.mjs' $probePath $requestPath $sourceKey
  if($LASTEXITCODE -ne 0){throw 'Formal shared task compiler failed'}
  $formal=Get-Content -Raw -LiteralPath $requestPath | ConvertFrom-Json
  $assText=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($imported.ass.base64))
  $data=@{request=$formal.request;assText=$assText}|ConvertTo-Json -Depth 16 -Compress
  $started=Invoke-RestMethod -Method Post -Uri "$root/api/encode" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $data -TimeoutSec 40
  if(-not $started.ok -or -not $started.jobId){throw 'Formal Native hard-sub job failed to start'}
  $result=$null
  for($i=0;$i -lt 240;$i++){
    Start-Sleep -Milliseconds 250
    $result=Invoke-RestMethod -Uri "$root/api/jobs/$($started.jobId)" -Headers $headers -TimeoutSec 15
    if($result.state -in @('completed','failed','cancelled')){break}
  }
  if($result.state -ne 'completed'){throw ('Native job did not complete: '+($result|ConvertTo-Json -Compress))}
  $staged=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$started.jobId+'-*'))
  if($staged.Count -ne 1){throw 'No retained native job folder'}
  $output=Join-Path $staged[0].FullName 'output.mkv'
  if(-not(Test-Path -LiteralPath $output)){throw 'Encoded MKV missing'}
  & node './scripts/verify-wu02-native-output.mjs' $source $output $importPath $requestPath (Join-Path $work 'QHE-Synthetic-CI.ttf') $work
  if($LASTEXITCODE -ne 0){throw 'Independent artifact verification failed'}
  [IO.File]::AppendAllText($source,'MUTATED-SOURCE-AFTER-IMPORT')
  $rejected=$false
  try{
    $req=@{requestId='mutated';timeSeconds=1;assText=$assText}|ConvertTo-Json -Compress
    [void](Invoke-RestMethod -Method Post -Uri "$root/api/preview" -Headers $headers -ContentType 'application/json' -Body $req -TimeoutSec 35)
  }catch{$rejected=$true}
  if(-not $rejected){throw 'Stale embedded font/ASS source was reused after source mutation'}
  Write-Host 'WU02 REAL WINDOWS NATIVE PASS: MKV embedded ASS+font burn-in, FLAC packet copy, AAC transcode.'
}finally{
  if($bridge -and -not $bridge.HasExited){
    Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
