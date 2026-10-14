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
}finally{
 if($server){
  try{if(-not $server.HasExited){Stop-Process -Id $server.Id -Force}}catch{}
 }
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
