# Source-owned single-flight FLAC audio encode preview for Windows Native.
# A source-scoped observation; never the authoritative formal byte budget.
$script:FlacPreflightJob=$null
function Retire-FlacPreflight($Job){
 if($Job.State -eq 'running'){
  try{$p=$Job.Started.Process;if(-not $p.HasExited){$p.Kill();$p.WaitForExit()};$p.Dispose()}catch{}
  try{Remove-Item -LiteralPath $Job.Work -Recurse -Force -ErrorAction SilentlyContinue}catch{}
 }
 $Job.State='unavailable';$Job.Receipt=$null
}
function Get-FlacEncodePreflightStatus {
 $j=$script:FlacPreflightJob
 if(-not $j){return @{ok=$true;state='not-requested'}}
 $file=Get-SelectedPath 'video'
 $ledger=$script:BudgetMeasurement
 if(-not $file -or -not(Test-Path -LiteralPath $file -PathType Leaf)){
  Retire-FlacPreflight $j
  return @{ok=$true;state='unavailable';reason='source-not-selected'}
 }
 $stat=Get-Item -LiteralPath $file
 if($file -ne $j.Source -or $stat.Length -ne $j.Length -or
    [string]$stat.LastWriteTimeUtc.Ticks -ne $j.Ticks -or
    -not $ledger -or $ledger.Id -ne $j.MeasurementId -or
    $ledger.Path -ne $file -or $ledger.Length -ne $j.Length -or
    [string]$ledger.WriteTicks -ne $j.Ticks){
  Retire-FlacPreflight $j
  return @{ok=$true;state='unavailable';reason='source-or-ledger-replaced'}
 }
 if($j.State -in @('ready','unavailable')){
  return @{ok=$true;state=$j.State;jobId=$j.Id;receipt=$j.Receipt}
 }
 $p=$j.Started.Process
 if(-not $p.HasExited){return @{ok=$true;state='running';jobId=$j.Id}}
 try{
  if($p.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $j.ReceiptPath -PathType Leaf)){
   throw 'FLAC preflight did not generate a receipt.'
  }
  $receipt=Get-Content -LiteralPath $j.ReceiptPath -Raw|ConvertFrom-Json
  if($receipt.version -ne 1 -or $receipt.scope -ne 'isolated-flac-encode-observation' -or
     $receipt.method -ne 'ffmpeg-flac-full-input-trim-input-independent-ffprobe-v1' -or
     $receipt.observationOnly -ne $true -or $receipt.canReplaceFormalBudget -ne $false -or
     $receipt.canCertifyFinalMux -ne $false -or
     [long]$receipt.sourceLength -ne $j.Length -or
     [string]$receipt.sourceWriteTicks -ne $j.Ticks -or
     [double]$receipt.start -ne $j.Start -or [double]$receipt.end -ne $j.End -or
     $receipt.outputFormat -ne 'matroska' -or
     @($receipt.tracks).Count -ne @($j.Tracks).Count){
    throw 'FLAC receipt does not match origin and request.'
  }
  $checked=@()
  for($i=0;$i -lt @($j.Tracks).Count;$i++){
   $a=$receipt.tracks[$i];$b=$j.Tracks[$i]
   if([int]$a.sourceOrdinal -ne [int]$b.sourceOrdinal -or
      [string]$a.range -ne [string]$b.range -or
      [string]$a.channels -ne [string]$b.channels -or
      [string]$a.sampleRate -ne [string]$b.sampleRate -or
      $null -eq $a.packetBytes -or [string]$a.packetBytes -notmatch '^[0-9]+$'){
    throw 'FLAC track mapping or packet evidence invalid.'
   }
   $n=0L
   if(-not [long]::TryParse([string]$a.packetBytes,[ref]$n)){throw 'FLAC packet cost overflow.'}
   if([int]$a.sourceOrdinal -ge @($ledger.AudioPacketBytes).Count -or
      $null -eq $ledger.AudioPacketBytes[[int]$a.sourceOrdinal]){
    throw 'FLAC source packet ledger incomplete.'
   }
   $checked+=@{sourceOrdinal=[int]$b.sourceOrdinal;range=[string]$b.range;
     channels=$b.channels;sampleRate=$b.sampleRate;packetBytes=$n}
  }
  $j.Receipt=@{version=1;scope='isolated-flac-encode-observation';
    method='ffmpeg-flac-full-input-trim-input-independent-ffprobe-v1';
    observationOnly=$true;canReplaceFormalBudget=$false;canCertifyFinalMux=$false;
    measurementId=$j.MeasurementId;sourceLength=$j.Length;sourceWriteTicks=$j.Ticks;
    start=$j.Start;end=$j.End;outputFormat='matroska';tracks=@($checked)}
  $j.State='ready'
 }catch{$j.Receipt=$null;$j.State='unavailable'}finally{
  try{$p.Dispose()}catch{}
  try{Remove-Item -LiteralPath $j.Work -Recurse -Force -ErrorAction SilentlyContinue}catch{}
 }
 return @{ok=$true;state=$j.State;jobId=$j.Id;receipt=$j.Receipt}
}
function Start-FlacEncodePreflight($Body){
 $file=Get-SelectedPath 'video'
 if(-not $file){throw 'No selected source.'}
 foreach($j in $script:Jobs.Values){
  if($j.State -in @('encoding','validating')){throw 'Cannot preflight during Native encode.'}
 }
 if($script:TrimPreflightJob -and (Get-IsolatedTrimPreflightStatus).state -eq 'running'){
  throw 'Wait for isolated copy preflight to finish.'
 }
 if($script:FlacPreflightJob -and (Get-FlacEncodePreflightStatus).state -eq 'running'){
  throw 'Only one FLAC preflight may run.'
 }
 $ledger=$script:BudgetMeasurement;$stat=Get-Item -LiteralPath $file
 if(-not $ledger -or $ledger.Path -ne $file -or $ledger.Length -ne $stat.Length -or
    [string]$ledger.WriteTicks -ne [string]$stat.LastWriteTimeUtc.Ticks){
  throw 'Measure source packet costs before FLAC preflight.'
 }
 $req=$Body.request
 if(-not $req -or [int]$req.version -ne 1 -or
    [string]$req.mode -ne 'isolated-flac-encode' -or
    [string]$req.outputFormat -ne 'matroska'){throw 'Invalid FLAC preview request.'}
 $tracks=@($req.tracks)
 if($tracks.Count -lt 1 -or $tracks.Count -gt 16){throw 'Select 1-16 FLAC tracks.'}
 $seen=@{}
 foreach($t in $tracks){
  if($null -eq $t -or $t.action -ne 'flac' -or
     [string]$t.sourceOrdinal -notmatch '^[0-9]+$' -or
     [int]$t.sourceOrdinal -gt 63 -or
     $t.range -notin @('full','trim') -or
     $seen.ContainsKey([string]$t.sourceOrdinal)){
    throw 'Invalid FLAC track selection.'
  }
  $seen[[string]$t.sourceOrdinal]=$true
  if([int]$t.sourceOrdinal -ge @($ledger.AudioPacketBytes).Count -or
     $null -eq $ledger.AudioPacketBytes[[int]$t.sourceOrdinal]){throw 'Source audio packet data missing.'}
  if($null -ne $t.channels -and ([string]$t.channels -notmatch '^[1-8]$')){throw 'Invalid FLAC channels.'}
  if($null -ne $t.sampleRate -and ([string]$t.sampleRate -notmatch '^[0-9]+$' -or
     [int]$t.sampleRate -lt 8000 -or [int]$t.sampleRate -gt 192000)){throw 'Invalid FLAC sample rate.'}
 }
 $start=[double]$req.start;$end=[double]$req.end
 if([double]::IsNaN($start) -or [double]::IsInfinity($start) -or
    [double]::IsNaN($end) -or [double]::IsInfinity($end) -or
    $start -lt 0 -or $end -le $start -or $end-$start -gt 14400){
  throw 'FLAC preflight time bounds invalid.'
 }
 $id=[guid]::NewGuid().ToString('N')
 $work=New-BridgeWorkDir ('flac-encode-preflight-'+$id+'-')
 $requestFile=Join-Path $work 'request.json'
 $receiptFile=Join-Path $work 'receipt.json'
 $payload=@{version=1;mode='isolated-flac-encode';sourcePath=$file;
   start=$start;end=$end;outputFormat='matroska';tracks=@($tracks)}
 [IO.File]::WriteAllText($requestFile,($payload|ConvertTo-Json -Depth 10 -Compress),
   (New-Object Text.UTF8Encoding($false)))
 $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File '+
   (Quote-NativeArg (Join-Path $PSScriptRoot 'flac-encode-preflight.ps1'))+
   ' -Ffmpeg '+(Quote-NativeArg $script:Ffmpeg)+
   ' -Ffprobe '+(Quote-NativeArg $script:Ffprobe)+
   ' -RequestFile '+(Quote-NativeArg $requestFile)+
   ' -ReceiptFile '+(Quote-NativeArg $receiptFile)
 $started=Start-BridgeTool 'powershell.exe' $args $work
 $script:FlacPreflightJob=[pscustomobject]@{Id=$id;State='running';
   Started=$started;Work=$work;ReceiptPath=$receiptFile;Receipt=$null;
   Source=$file;Length=[long]$stat.Length;Ticks=[string]$stat.LastWriteTimeUtc.Ticks;
   MeasurementId=$ledger.Id;Start=$start;End=$end;Tracks=@($tracks)}
 return @{ok=$true;state='running';jobId=$id}
}
