# Real Windows Native localhost bridge regression: guided two-pass/strict output.
# Synthetic software source, not physical NVENC or full long-form user acceptance.
$ErrorActionPreference='Stop'
$work=Join-Path $env:RUNNER_TEMP ('guided-budget-policy-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$source=Join-Path $work 'input.mkv'
& ffmpeg -hide_banner -nostdin -loglevel error -y -f lavfi -i 'testsrc2=size=320x180:rate=15:duration=2' -c:v ffv1 $source
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
  function Test-PolicyRun([string]$policy,[long]$ceiling,[bool]$shouldFail){
    $body=@{
      request=@{codec='h264';mode='budget-rate';preset='medium';crf=23
        targetVideoBitrate=350000;sizeBudgetPolicy=$policy;sizeCeilingBytes=$ceiling
        outputWidth=0;outputHeight=0;expectedDuration=2.0
        audio='none';outputFormat='matroska';outputExtension='mkv'
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
    }else{
      if($result.state -ne 'completed' -or $result.outputBytes -le 0){throw "$policy never produced a valid output"}
      if($policy -eq 'strict-ceiling' -and $result.outputBytes -gt $ceiling){throw 'Strict success exceeded byte ceiling'}
      $again=Invoke-RestMethod -Uri "$hostUrl/api/jobs/$($started.jobId)" -Headers $headers
      if($again.state -ne 'completed'){throw 'Completed staged output is not retained'}
    }
    Write-Host ("$policy result="+$result.state+" encoder="+$started.encoder+" bytes="+$result.outputBytes+
      " saw-pass1="+$seenPass1+" saw-pass2="+$seenPass2)
    if(-not $seenPass1 -or -not $seenPass2){throw "$policy two-pass progress states were not visible"}
  }
  Test-PolicyRun 'two-pass' 0 $false
  Test-PolicyRun 'strict-ceiling' 1024 $true
  Test-PolicyRun 'strict-ceiling' 5000000 $false
}finally{
  try{if($bridge -and -not $bridge.HasExited){Stop-Process -Id $bridge.Id -Force}}catch{}
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
