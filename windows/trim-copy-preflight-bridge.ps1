# Source-owned, single-flight background B16 isolated auxiliary remux.
# Loaded by native-bridge.ps1 AFTER its file ownership helpers are defined.
$script:TrimPreflightJob=$null
function Stop-StaleTrimPreflight($Job) {
 if($Job.State -eq 'running'){
  try{
   $p=$Job.Started.Process
   if(-not $p.HasExited){$p.Kill();$p.WaitForExit()}
   $p.Dispose()
  }catch{}
  try{Remove-Item -LiteralPath $Job.Work -Recurse -Force -ErrorAction SilentlyContinue}catch{}
 }
 $Job.Receipt=$null
 $Job.State='unavailable'
}
function Get-IsolatedTrimPreflightStatus {
 $job=$script:TrimPreflightJob
 if(-not $job){return @{ok=$true;state='not-requested'}}
 $file=Get-SelectedPath 'video'
 if(-not $file -or -not(Test-Path -LiteralPath $file -PathType Leaf)){
  Stop-StaleTrimPreflight $job
  return @{ok=$true;state='unavailable';reason='source-not-selected'}
 }
 $item=Get-Item -LiteralPath $file
 if($file -ne $job.Source -or $item.Length -ne $job.Length -or
    [string]$item.LastWriteTimeUtc.Ticks -ne [string]$job.Ticks){
  Stop-StaleTrimPreflight $job
  return @{ok=$true;state='unavailable';reason='source-changed'}
 }
 # Even a *completed* receipt is scoped to the live whole-file packet
 # observation. Re-measuring the same stat-stable source revokes old receipts.
 $ledger=$script:BudgetMeasurement
 if(-not $ledger -or $ledger.Id -ne $job.MeasurementId -or
    $ledger.Path -ne $job.Source -or
    $ledger.Length -ne $job.Length -or
    [string]$ledger.WriteTicks -ne [string]$job.Ticks){
  Stop-StaleTrimPreflight $job
  return @{ok=$true;state='unavailable';reason='measurement-replaced'}
 }
 if($job.State -in @('ready','unavailable')){
  return @{ok=$true;state=$job.State;receipt=$job.Receipt;jobId=$job.Id}
 }
 $proc=$job.Started.Process
 if(-not $proc.HasExited){return @{ok=$true;state='running';jobId=$job.Id}}
 try{
  if($proc.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $job.ReceiptPath -PathType Leaf)){
   throw 'Bounded isolated remux failed.'
  }
  $receipt=Get-Content -LiteralPath $job.ReceiptPath -Raw|ConvertFrom-Json
  if($receipt.version -ne 1 -or $receipt.scope -ne 'isolated-trim-copy-observation' -or
     $receipt.method -ne 'ffmpeg-isolated-auxiliary-copy-remux-then-independent-ffprobe-v1' -or
     $receipt.canReplaceFullSourceBudget -ne $false -or
     $receipt.observationOnly -ne $true -or
     [long]$receipt.sourceLength -ne [long]$job.Length -or
     [string]$receipt.sourceWriteTicks -ne [string]$job.Ticks -or
     [double]$receipt.start -ne [double]$job.Start -or
     [double]$receipt.end -ne [double]$job.End -or
     [string]$receipt.outputFormat -ne [string]$job.Format -or
     (ConvertTo-Json -InputObject @($receipt.audioOrdinals) -Compress) -ne
       (ConvertTo-Json -InputObject @($job.AudioOrdinals) -Compress) -or
     (ConvertTo-Json -InputObject @($receipt.subtitleOrdinals) -Compress) -ne
       (ConvertTo-Json -InputObject @($job.SubtitleOrdinals) -Compress)){
   throw 'Worker receipt does not match Native-owned source and request.'
  }
  if(@($receipt.audioPacketBytes).Count -ne @($job.AudioOrdinals).Count -or
     @($receipt.subtitlePacketBytes).Count -ne @($job.SubtitleOrdinals).Count){
   throw 'Worker auxiliary stream count differs.'
  }
  foreach($v in @($receipt.audioPacketBytes)+@($receipt.subtitlePacketBytes)){
   if($null -eq $v -or [string]$v -notmatch '^\\d+
  # Attach only the current Windows-local source measurement reference.
  $measured=$script:BudgetMeasurement
  if(-not $measured -or $measured.Id -ne $job.MeasurementId -or
     $measured.Path -ne $job.Source -or $measured.Length -ne $job.Length -or
     [string]$measured.WriteTicks -ne [string]$job.Ticks){
   throw 'Source packet ledger changed after preflight started.'
  }
  $job.Receipt=[pscustomobject]@{
   version=1;scope='isolated-trim-copy-observation';method=[string]$receipt.method
   observationOnly=$true;canReplaceFullSourceBudget=$false
   measurementId=$measured.Id;sourceLength=[long]$job.Length
   sourceWriteTicks=[string]$job.Ticks
   start=[double]$job.Start;end=[double]$job.End;outputFormat=$job.Format
   audioOrdinals=@($job.AudioOrdinals);subtitleOrdinals=@($job.SubtitleOrdinals)
   audioPacketBytes=@($receipt.audioPacketBytes)
   subtitlePacketBytes=@($receipt.subtitlePacketBytes)
  }
  $job.State='ready'
 }catch{
  $job.Receipt=$null
  $job.State='unavailable'
 }finally{
  try{$proc.Dispose()}catch{}
  try{Remove-Item -LiteralPath $job.Work -Recurse -Force -ErrorAction SilentlyContinue}catch{}
 }
 return @{ok=$true;state=$job.State;jobId=$job.Id;receipt=$job.Receipt}
}
function Start-IsolatedTrimPreflight($Body) {
 $video=Get-SelectedPath 'video'
 if(-not $video){throw 'No video selected.'}
 foreach($job in $script:Jobs.Values){
  if($job.State -in @('encoding','validating')){throw 'Cannot preflight copy packets while Native encoding is active.'}
 }
 if($script:TrimPreflightJob){
  $state=Get-IsolatedTrimPreflightStatus
  if($state.state -eq 'running'){throw 'Only one Native preflight can run at once.'}
 }
 $measurement=$script:BudgetMeasurement
 $item=Get-Item -LiteralPath $video
 if(-not $measurement -or $measurement.Path -ne $video -or
    $measurement.Length -ne $item.Length -or
    [string]$measurement.WriteTicks -ne [string]$item.LastWriteTimeUtc.Ticks){
  throw 'Source whole-file packet costs must be measured before trim preflight.'
 }
 $req=$Body.request
 if(-not $req -or [string]$req.mode -ne 'isolated-trim-copy' -or
    [int]$req.version -ne 1 -or
    [string]$req.outputFormat -notin @('matroska','mp4')){
  throw 'Invalid isolated trim copy request.'
 }
 $start=[double]$req.start;$end=[double]$req.end
 if([double]::IsNaN($start) -or [double]::IsInfinity($start) -or
    [double]::IsNaN($end) -or [double]::IsInfinity($end) -or
    $start -lt 0 -or $end -le $start -or $end-$start -gt 3600){
  throw 'Invalid or unbounded trim interval.'
 }
 $audio=if($null -eq $req.audioOrdinals){@()}else{@($req.audioOrdinals)}
 $sub=if($null -eq $req.subtitleOrdinals){@()}else{@($req.subtitleOrdinals)}
 if($audio.Count+$sub.Count -lt 1 -or $audio.Count+$sub.Count -gt 32){
  throw 'No copied auxiliary streams selected or selection too large.'
 }
 foreach($ordinal in @($audio)+@($sub)){
  if([string]$ordinal -notmatch '^\d+$' -or [int]$ordinal -ge 64){
   throw 'Invalid source auxiliary ordinal.'
  }
 }
 $id=[guid]::NewGuid().ToString('N')
 $work=New-BridgeWorkDir ('trim-copy-preflight-'+$id+'-')
 $sourceRequest=Join-Path $work 'request.json'
 $receiptPath=Join-Path $work 'receipt.json'
 $payload=@{version=1;mode='isolated-trim-copy';sourcePath=$video
   start=$start;end=$end;outputFormat=[string]$req.outputFormat
   audioOrdinals=@($audio);subtitleOrdinals=@($sub)}
 [IO.File]::WriteAllText($sourceRequest,($payload|ConvertTo-Json -Compress -Depth 7),
  (New-Object Text.UTF8Encoding($false)))
 $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File '+
  (Quote-NativeArg (Join-Path $PSScriptRoot 'trim-copy-preflight.ps1'))+
  ' -Ffmpeg '+(Quote-NativeArg $script:Ffmpeg)+
  ' -Ffprobe '+(Quote-NativeArg $script:Ffprobe)+
  ' -RequestFile '+(Quote-NativeArg $sourceRequest)+
  ' -ReceiptFile '+(Quote-NativeArg $receiptPath)
 $started=Start-BridgeTool 'powershell.exe' $args $work
 $script:TrimPreflightJob=[pscustomobject]@{
  Id=$id;State='running';Started=$started;Work=$work;ReceiptPath=$receiptPath
  Receipt=$null;Source=$video;Length=[long]$item.Length;Ticks=[string]$item.LastWriteTimeUtc.Ticks
  MeasurementId=$measurement.Id;Start=$start;End=$end
  Format=[string]$req.outputFormat;AudioOrdinals=@($audio);SubtitleOrdinals=@($sub)
 }
 return @{ok=$true;state='running';jobId=$id}
}
){
    throw 'Worker packet evidence is missing or is not an integer.'
   }
   $amount=0L
   if(-not [long]::TryParse([string]$v,[ref]$amount) -or $amount -lt 0){
    throw 'Worker packet evidence overflows a signed integer.'
   }
  }
  # Attach only the current Windows-local source measurement reference.
  $measured=$script:BudgetMeasurement
  if(-not $measured -or $measured.Id -ne $job.MeasurementId -or
     $measured.Path -ne $job.Source -or $measured.Length -ne $job.Length -or
     [string]$measured.WriteTicks -ne [string]$job.Ticks){
   throw 'Source packet ledger changed after preflight started.'
  }
  $job.Receipt=[pscustomobject]@{
   version=1;scope='isolated-trim-copy-observation';method=[string]$receipt.method
   observationOnly=$true;canReplaceFullSourceBudget=$false
   measurementId=$measured.Id;sourceLength=[long]$job.Length
   sourceWriteTicks=[string]$job.Ticks
   start=[double]$job.Start;end=[double]$job.End;outputFormat=$job.Format
   audioOrdinals=@($job.AudioOrdinals);subtitleOrdinals=@($job.SubtitleOrdinals)
   audioPacketBytes=@($receipt.audioPacketBytes)
   subtitlePacketBytes=@($receipt.subtitlePacketBytes)
  }
  $job.State='ready'
 }catch{
  $job.Receipt=$null
  $job.State='unavailable'
 }finally{
  try{$proc.Dispose()}catch{}
  try{Remove-Item -LiteralPath $job.Work -Recurse -Force -ErrorAction SilentlyContinue}catch{}
 }
 return @{ok=$true;state=$job.State;jobId=$job.Id;receipt=$job.Receipt}
}
function Start-IsolatedTrimPreflight($Body) {
 $video=Get-SelectedPath 'video'
 if(-not $video){throw 'No video selected.'}
 foreach($job in $script:Jobs.Values){
  if($job.State -in @('encoding','validating')){throw 'Cannot preflight copy packets while Native encoding is active.'}
 }
 if($script:TrimPreflightJob){
  $state=Get-IsolatedTrimPreflightStatus
  if($state.state -eq 'running'){throw 'Only one Native preflight can run at once.'}
 }
 $measurement=$script:BudgetMeasurement
 $item=Get-Item -LiteralPath $video
 if(-not $measurement -or $measurement.Path -ne $video -or
    $measurement.Length -ne $item.Length -or
    [string]$measurement.WriteTicks -ne [string]$item.LastWriteTimeUtc.Ticks){
  throw 'Source whole-file packet costs must be measured before trim preflight.'
 }
 $req=$Body.request
 if(-not $req -or [string]$req.mode -ne 'isolated-trim-copy' -or
    [int]$req.version -ne 1 -or
    [string]$req.outputFormat -notin @('matroska','mp4')){
  throw 'Invalid isolated trim copy request.'
 }
 $start=[double]$req.start;$end=[double]$req.end
 if([double]::IsNaN($start) -or [double]::IsInfinity($start) -or
    [double]::IsNaN($end) -or [double]::IsInfinity($end) -or
    $start -lt 0 -or $end -le $start -or $end-$start -gt 3600){
  throw 'Invalid or unbounded trim interval.'
 }
 $audio=if($null -eq $req.audioOrdinals){@()}else{@($req.audioOrdinals)}
 $sub=if($null -eq $req.subtitleOrdinals){@()}else{@($req.subtitleOrdinals)}
 if($audio.Count+$sub.Count -lt 1 -or $audio.Count+$sub.Count -gt 32){
  throw 'No copied auxiliary streams selected or selection too large.'
 }
 foreach($ordinal in @($audio)+@($sub)){
  if([string]$ordinal -notmatch '^\d+$' -or [int]$ordinal -ge 64){
   throw 'Invalid source auxiliary ordinal.'
  }
 }
 $id=[guid]::NewGuid().ToString('N')
 $work=New-BridgeWorkDir ('trim-copy-preflight-'+$id+'-')
 $sourceRequest=Join-Path $work 'request.json'
 $receiptPath=Join-Path $work 'receipt.json'
 $payload=@{version=1;mode='isolated-trim-copy';sourcePath=$video
   start=$start;end=$end;outputFormat=[string]$req.outputFormat
   audioOrdinals=@($audio);subtitleOrdinals=@($sub)}
 [IO.File]::WriteAllText($sourceRequest,($payload|ConvertTo-Json -Compress -Depth 7),
  (New-Object Text.UTF8Encoding($false)))
 $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File '+
  (Quote-NativeArg (Join-Path $PSScriptRoot 'trim-copy-preflight.ps1'))+
  ' -Ffmpeg '+(Quote-NativeArg $script:Ffmpeg)+
  ' -Ffprobe '+(Quote-NativeArg $script:Ffprobe)+
  ' -RequestFile '+(Quote-NativeArg $sourceRequest)+
  ' -ReceiptFile '+(Quote-NativeArg $receiptPath)
 $started=Start-BridgeTool 'powershell.exe' $args $work
 $script:TrimPreflightJob=[pscustomobject]@{
  Id=$id;State='running';Started=$started;Work=$work;ReceiptPath=$receiptPath
  Receipt=$null;Source=$video;Length=[long]$item.Length;Ticks=[string]$item.LastWriteTimeUtc.Ticks
  MeasurementId=$measurement.Id;Start=$start;End=$end
  Format=[string]$req.outputFormat;AudioOrdinals=@($audio);SubtitleOrdinals=@($sub)
 }
 return @{ok=$true;state='running';jobId=$id}
}
