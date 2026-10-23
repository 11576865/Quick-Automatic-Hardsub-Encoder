# WU02: real Windows localhost Native Bridge, FFmpeg and source-bound MKV assets.
$ErrorActionPreference='Stop'
$work=Join-Path $env:RUNNER_TEMP ('wu02-embedded-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work -Force)
$source=Join-Path $work 'source.mkv'
$port=9361
$root="http://127.0.0.1:$port"
$headers=@{'X-Quick-Hardsub-Token'='wu02-ci-token';Origin=$root}
$bridge=$null
try {
  & node './scripts/build-manual-rich-native-fixture.mjs' $work
  if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $source)){throw 'Rich MKV fixture missing'}
  $outlog=Join-Path $work 'bridge-stdout.log'
  $errlog=Join-Path $work 'bridge-stderr.log'
  $bridge=Start-Process powershell.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput $outlog -RedirectStandardError $errlog -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Resolve-Path './windows/native-bridge.ps1'),'-NoBrowser','-Port',[string]$port,'-Token','wu02-ci-token','-InitialVideo',$source)
  $ready=$false
  for($i=0;$i -lt 65;$i++){
    Start-Sleep -Milliseconds 300
    try{
      $health=Invoke-RestMethod -Uri "$root/api/health" -Headers $headers -TimeoutSec 3
      if($health.available){$ready=$true;break}
    }catch{}
  }
  if(-not $ready){throw 'Native Bridge failed to start'}
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
      multipass='disabled';targetVideoBitrate=650000;start=$start;duration=0.8;timeoutSeconds=45}
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
  & node './scripts/check-wu11-guided-vbr-explicit-adoption.mjs' $paired $importPath $sourceKey
  if($LASTEXITCODE -ne 0){throw 'WU11 imported ASS/font and Guided VBR evidence identity verification failed'}
  Write-Host 'WU11 REAL NATIVE SAME-RICH-MKV PASS: source SHA, selected ASS and staged font agree in paired Guided VBR (not yet final VBR job).'
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
