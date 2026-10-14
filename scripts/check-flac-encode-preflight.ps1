# Windows PowerShell 5.1 B16 genuine multi-track FLAC preflight evidence.
$ErrorActionPreference='Stop'
$root=Join-Path $env:RUNNER_TEMP ('qhe-flac-runtime-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $root -Force)
try{
 $ffmpeg=(Get-Command ffmpeg.exe -ErrorAction Stop).Source
 $ffprobe=(Get-Command ffprobe.exe -ErrorAction Stop).Source
 $source=Join-Path $root 'source.mkv'
 $create=@('-hide_banner','-nostdin','-loglevel','error','-y',
  '-f','lavfi','-i','testsrc2=size=160x90:rate=12:duration=3',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3',
  '-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=3',
  '-map','0:v','-map','1:a','-map','2:a','-c:v','ffv1','-c:a','pcm_s16le',$source)
 & $ffmpeg @create
 if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $source)){throw 'Source synth failed.'}
 $req=@{version=1;mode='isolated-flac-encode';sourcePath=$source
   start=0.4;end=2.4;outputFormat='matroska'
   tracks=@(
    @{action='flac';sourceOrdinal=0;range='full';channels=$null;sampleRate=$null},
    @{action='flac';sourceOrdinal=1;range='trim';channels=1;sampleRate=48000}
   )}
 $request=Join-Path $root 'request.json'
 $result=Join-Path $root 'receipt.json'
 [IO.File]::WriteAllText($request,($req|ConvertTo-Json -Depth 9 -Compress),
    (New-Object Text.UTF8Encoding($false)))
 $worker=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
   '-File','./windows/flac-encode-preflight.ps1',
   '-Ffmpeg',$ffmpeg,'-Ffprobe',$ffprobe,'-RequestFile',$request,'-ReceiptFile',$result)
 & powershell.exe @worker
 if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $result)){throw 'Real FLAC preflight failed.'}
 $receipt=Get-Content -LiteralPath $result -Raw|ConvertFrom-Json
 if($receipt.scope -ne 'isolated-flac-encode-observation' -or
    $receipt.observationOnly -ne $true -or
    $receipt.canReplaceFormalBudget -ne $false -or
    $receipt.canCertifyFinalMux -ne $false -or
    @($receipt.tracks).Count -ne 2 -or
    $receipt.tracks[0].range -ne 'full' -or
    $receipt.tracks[1].range -ne 'trim' -or
    [long]$receipt.tracks[0].packetBytes -le 0 -or
    [long]$receipt.tracks[1].packetBytes -le 0 -or
    [string]$receipt.sourceWriteTicks -ne [string](Get-Item -LiteralPath $source).LastWriteTimeUtc.Ticks){
  throw 'FLAC receipt source, stream, packet count or authority is invalid.'
 }
 # Independent repeated run, not the worker's output or packet JSON.
 $oracle=Join-Path $root 'flac-oracle.mka'
 $encode=@('-hide_banner','-nostdin','-loglevel','error','-y',
   '-i',$source,'-ss','0.4','-t','2','-i',$source,
   '-map','0:a:0','-c:a:0','flac','-map','1:a:1','-c:a:1','flac',
   '-ac:a:1','1','-ar:a:1','48000',
   '-vn','-sn','-dn','-map_metadata','-1','-map_chapters','-1',
   '-f','matroska',$oracle)
 & $ffmpeg @encode
 if($LASTEXITCODE -ne 0){throw 'Independent FLAC reference encode failed.'}
 foreach($i in @(0,1)){
  $n=0L
  foreach($line in @(& $ffprobe -v error -select_streams ('a:'+$i) -show_packets -show_entries packet=size -of csv=p=0 $oracle)){
   if($line -match '^\d+$'){$n += [long]$line}
  }
  if($n -ne [long]$receipt.tracks[$i].packetBytes){
   throw ('FLAC receipt does not match independent encoded audio track '+$i)
  }
 }
 # Compare real *finished video+FLAC+softsubtitle mux* packets to the
 # isolated audio-only preflight. Record observed differences, no equivalence claim.
 $subtitlePath=Join-Path $root 'soft-subtitle.srt'
 $subtitleText='1'+[char]13+[char]10+'00:00:00,500 --> 00:00:01,500'+[char]13+[char]10+'B16 mux parity'+[char]13+[char]10
 [IO.File]::WriteAllText($subtitlePath,$subtitleText,(New-Object Text.UTF8Encoding($false)))
 $mixed=Join-Path $root 'final-mixed-audio-video-subtitle.mkv'
 $muxOptions=@('-hide_banner','-nostdin','-loglevel','error','-y',
  '-i',$source,'-ss','0.4','-t','2','-i',$source,'-i',$subtitlePath,
  '-map','0:v:0','-map','0:a:0','-map','1:a:1','-map','2:s:0',
  '-c:v','libx264','-preset','ultrafast',
  '-c:a:0','flac','-c:a:1','flac','-ac:a:1','1','-ar:a:1','48000',
  '-c:s','srt','-map_metadata','-1','-map_chapters','-1',
  '-f','matroska',$mixed)
 & $ffmpeg @muxOptions
 if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $mixed -PathType Leaf)){
  throw 'Actual mixed video, FLAC and subtitle fixture failed.'
 }
 $videos=@(& $ffprobe -v error -select_streams v:0 -show_packets -show_entries packet=size -of csv=p=0 $mixed)
 $subPackets=@(& $ffprobe -v error -select_streams s:0 -show_packets -show_entries packet=size -of csv=p=0 $mixed)
 if($videos.Count -lt 1 -or $subPackets.Count -lt 1){
  throw 'Actual mixed mux missing video or subtitle packets.'
 }
 for($i=0;$i -lt 2;$i++){
  $finalBytes=0L
  foreach($line in @(& $ffprobe -v error -select_streams ('a:'+$i) -show_packets -show_entries packet=size -of csv=p=0 $mixed)){
   if($line -match '^[0-9]+$'){$finalBytes += [long]$line}
  }
  if($finalBytes -le 0){throw ('Final mixed FLAC audio track '+$i+' has no packet evidence.')}
  $delta=$finalBytes-[long]$receipt.tracks[$i].packetBytes
  Write-Host ('B16 finished video+FLAC+subtitle mux track '+$i+' observed packet difference: '+$delta+' bytes (not a reusable budget certificate).')
 }
 # The isolated FFprobe worker must also account for an actual finished
 # video + dual FLAC + soft subtitle Matroska artifact, not only audio previews.
 $mixedAudit=Join-Path $root 'actual-mixed-packet-ledger.json'
 $auditOptions=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
   '-File','./windows/trim-packet-audit.ps1',
   '-Ffprobe',$ffprobe,'-OutputFile',$mixed,'-ReceiptFile',$mixedAudit)
 & powershell.exe @auditOptions
 if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $mixedAudit -PathType Leaf)){
  throw 'Independent mixed video/audio/subtitle packet worker did not complete.'
 }
 $packetLedger=Get-Content -LiteralPath $mixedAudit -Raw|ConvertFrom-Json
 if(@($packetLedger.videoPacketBytes).Count -ne 1 -or
    @($packetLedger.audioPacketBytes).Count -ne 2 -or
    @($packetLedger.subtitlePacketBytes).Count -ne 1){
  throw 'Actual mixed mux packet worker omitted or invented a stream.'
 }
 $codecBytes=0L
 foreach($kind in @('videoPacketBytes','audioPacketBytes','subtitlePacketBytes')){
  foreach($amount in @($packetLedger.$kind)){
   if($null -eq $amount -or [long]$amount -le 0){
    throw ('Actual mixed mux packet ledger incomplete: '+$kind)
   }
   $codecBytes += [long]$amount
  }
 }
 $realBytes=[long](Get-Item -LiteralPath $mixed).Length
 if($codecBytes -gt $realBytes){throw 'Observed codec packet bytes exceed actual completed container.'}
 Write-Host ('B16 independently observed video/audio/subtitle payload '+$codecBytes+
   ' bytes; mixed artifact residual '+($realBytes-$codecBytes)+' bytes includes all other data and mux overhead.')
 $bad=($req|ConvertTo-Json -Depth 9|ConvertFrom-Json)
 $bad.tracks[1].sourceOrdinal=0
 [IO.File]::WriteAllText($request,($bad|ConvertTo-Json -Depth 9 -Compress),
    (New-Object Text.UTF8Encoding($false)))
 $badReceipt=Join-Path $root 'invalid-flac-receipt.json'
 $worker[$worker.Count-1]=$badReceipt
 # An expected child validation error must not become a parent
 # PowerShell 5.1 terminating NativeCommandError under Stop preference.
 $negativeOptions=($worker|ForEach-Object {'"'+([string]$_).Replace('"','\\"')+'"'}) -join ' '
 $negative=Start-Process -FilePath 'powershell.exe' -ArgumentList $negativeOptions -NoNewWindow -PassThru `
  -RedirectStandardOutput (Join-Path $root 'negative-stdout.log') `
  -RedirectStandardError (Join-Path $root 'negative-stderr.log')
 try{
  if(-not $negative.WaitForExit(15000)){
   $negative.Kill();$negative.WaitForExit()
   throw 'Negative fixture child did not finish in bounded time.'
  }
  $badExit=$negative.ExitCode
 }finally{$negative.Dispose()}
 if($badExit -eq 0 -or (Test-Path -LiteralPath $badReceipt)){
  throw 'Duplicate FLAC source ordinal wrongly accepted.'
 }
 Write-Host 'B16 actual two-track full+trim FLAC encode packet observation passed; final video mux remains unverified.'
}finally{
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
