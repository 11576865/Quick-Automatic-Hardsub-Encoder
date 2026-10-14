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
 $bad=($req|ConvertTo-Json -Depth 9|ConvertFrom-Json)
 $bad.tracks[1].sourceOrdinal=0
 [IO.File]::WriteAllText($request,($bad|ConvertTo-Json -Depth 9 -Compress),
    (New-Object Text.UTF8Encoding($false)))
 $badReceipt=Join-Path $root 'invalid-flac-receipt.json'
 $worker[$worker.Count-1]=$badReceipt
 & powershell.exe @worker 2>$null
 if($LASTEXITCODE -eq 0 -or (Test-Path -LiteralPath $badReceipt)){
  throw 'Duplicate FLAC source ordinal wrongly accepted.'
 }
 Write-Host 'B16 actual two-track full+trim FLAC encode packet observation passed; final video mux remains unverified.'
}finally{
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
