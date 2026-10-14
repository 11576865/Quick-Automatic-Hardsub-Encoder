# Real Windows Native FFmpeg isolated trim-copy pre-encode fixture.
# Evidence is separate from final mixed-mux output and cannot reduce the budget.
$ErrorActionPreference='Stop'
$root=Join-Path $env:RUNNER_TEMP ('qhe-preflight-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Force -Path $root)
try{
 $ffmpeg=(Get-Command ffmpeg.exe -ErrorAction Stop).Source
 $ffprobe=(Get-Command ffprobe.exe -ErrorAction Stop).Source
 $sub=Join-Path $root 'subs.srt'
 $subText='1'+[char]13+[char]10+'00:00:00,100 --> 00:00:01,900'+[char]13+[char]10+'Hello preflight'+[char]13+[char]10
 [IO.File]::WriteAllText($sub,$subText,(New-Object Text.UTF8Encoding($false)))
 $source=Join-Path $root 'two-audio-one-subtitle.mkv'
 $create=@('-hide_banner','-nostdin','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=320x180:rate=12:duration=2',
   '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2',
   '-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=2',
   '-i',$sub,'-map','0:v','-map','1:a','-map','2:a','-map','3:s',
   '-c:v','ffv1','-c:a','pcm_s16le','-c:s','ass',$source)
 & $ffmpeg @create
 if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $source -PathType Leaf)){
  throw 'Could not create source with two audio streams and one subtitle.'
 }
 $reqFile=Join-Path $root 'trim-request.json'
 $receipt=Join-Path $root 'trim-receipt.json'
 $req=@{
  version=1;mode='isolated-trim-copy';sourcePath=$source
  start=0.35;end=1.75;outputFormat='matroska'
  audioOrdinals=@(0,1);subtitleOrdinals=@(0)
 }
 [IO.File]::WriteAllText($reqFile,($req|ConvertTo-Json -Compress),
   (New-Object Text.UTF8Encoding($false)))
 $worker=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
   '-File','./windows/trim-copy-preflight.ps1',
   '-Ffmpeg',$ffmpeg,'-Ffprobe',$ffprobe,'-RequestFile',$reqFile,'-ReceiptFile',$receipt)
 & powershell.exe @worker
 if($LASTEXITCODE -ne 0){throw 'Real B16 isolated preflight worker failed.'}
 $seen=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
 if($seen.scope -ne 'isolated-trim-copy-observation' -or
    $seen.observationOnly -ne $true -or $seen.canReplaceFullSourceBudget -ne $false -or
    @($seen.audioPacketBytes).Count -ne 2 -or @($seen.subtitlePacketBytes).Count -ne 1 -or
    [string]$seen.sourceWriteTicks -ne [string](Get-Item -LiteralPath $source).LastWriteTimeUtc.Ticks){
  throw 'Pre-encode receipt schema or source identity invalid.'
 }
 $oracle=Join-Path $root 'independent-oracle.mkv'
 $args=@('-hide_banner','-nostdin','-loglevel','error','-y',
   '-ss','0.35','-t','1.4','-i',$source,
   '-map','0:a:0','-map','0:a:1','-map','0:s:0',
   '-c','copy','-map_metadata','-1','-map_chapters','-1','-f','matroska',$oracle)
 & $ffmpeg @args
 if($LASTEXITCODE -ne 0){throw 'Independent FFmpeg remux oracle failed.'}
 foreach($selector in @('a:0','a:1','s:0')){
  $sum=0L
  foreach($line in @(& $ffprobe -v error -select_streams $selector -show_packets -show_entries packet=size -of csv=p=0 $oracle)){
    if($line -match '^\d+$'){$sum += [long]$line}
  }
  $expected=if($selector -eq 's:0'){$seen.subtitlePacketBytes[0]}else{$seen.audioPacketBytes[[int]$selector.Substring(2)]}
  if($sum -ne [long]$expected){throw ('Isolated FFmpeg packet oracle differs for '+$selector)}
 }
 $invalid=$req|ConvertTo-Json -Depth 8|ConvertFrom-Json
 $invalid.audioOrdinals=@(0,0)
 [IO.File]::WriteAllText($reqFile,($invalid|ConvertTo-Json -Compress),
   (New-Object Text.UTF8Encoding($false)))
 $badReceipt=Join-Path $root 'invalid-receipt.json'
 $worker[$worker.Count-1]=$badReceipt
 & powershell.exe @worker 2>$null
 if($LASTEXITCODE -eq 0 -or (Test-Path -LiteralPath $badReceipt)){
  throw 'Duplicated source stream ordinal was wrongly accepted.'
 }
 Write-Host 'B16 real isolated two-audio/subtitle trim observation passed; final mixed-mux remains unverified.'
}finally{
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
