# Exercise production cancellation functions against real FFmpeg processes,
# including an exited first pass which has not yet been polled into pass two.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path './windows/native-bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Native Bridge parse failed'}
$names=@('Write-BridgeLog','Start-BridgeTool','Cancel-EncodeJob','Clear-IncompleteJobStaging','Get-JobStatus')
foreach($name in $names){
  $node=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if(-not $node){throw "Production function missing: $name"}
  Invoke-Expression $node.Extent.Text
}
$script:Ffmpeg=(Get-Command ffmpeg).Source
$script:Jobs=@{}
$root=Join-Path ([IO.Path]::GetTempPath()) ('cancel-lifecycle-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$saved=Join-Path $root 'previous-export.mkv'
[IO.File]::WriteAllText($saved,'previous-valid-export')
try{
  foreach($case in @('active-pass1','between-passes','active-pass2')){
    $work=Join-Path $root $case
    New-Item -ItemType Directory -Path (Join-Path $work 'fonts') -Force | Out-Null
    foreach($file in @('subtitle.ass','fonts/fixture.ttf','guided-budget-0.log','task-pass-0.log','output.mkv')){
      [IO.File]::WriteAllText((Join-Path $work $file),'private-staging')
    }
    $args=if($case -eq 'between-passes'){'-version'}else{
      '-hide_banner -nostdin -loglevel error -re -f lavfi -i testsrc2=size=64x64:rate=10 -t 20 -f null -'
    }
    $started=Start-BridgeTool $script:Ffmpeg $args $work
    if($case -eq 'between-passes'){
      if(-not $started.Process.WaitForExit(10000) -or $started.Process.ExitCode -ne 0){throw 'Boundary process did not exit successfully'}
    }elseif($started.Process.HasExited){throw 'Active cancellation fixture exited too early'}
    $job=[pscustomobject]@{Id=$case;Work=$work;Output=(Join-Path $work 'output.mkv');Started=$started
      State='encoding';Cancelled=$false;Finalized=$false;Task=$null;Request=@{}
      SizeBudgetPolicy='two-pass';StrictBudget=$false;Phase=if($case -eq 'active-pass2'){2}else{1}
      SecondArgs='-version';Progress=(Join-Path $work 'progress.txt');Duration=20
      EncodeSeconds=0.0;TimedProcessKey='';Error=''}
    $script:Jobs[$case]=$job
    $cancel=Cancel-EncodeJob $case
    if($cancel.state -ne 'cancelled'){throw "$case did not finalize at cancel ingress"}
    if(Test-Path -LiteralPath $work){throw "$case left private staging"}
    if($job.Phase -ne $(if($case -eq 'active-pass2'){2}else{1})){throw 'Cancellation launched second pass'}
    if((Cancel-EncodeJob $case).state -ne 'cancelled' -or (Get-JobStatus $case).state -ne 'cancelled'){
      throw 'Repeated cancellation/status touched a disposed process or lost terminal state'
    }
    if([IO.File]::ReadAllText($saved) -ne 'previous-valid-export'){throw 'Cancellation modified previous user output'}
    Write-Host "$case passed: stopped, cleaned, stable terminal state; previous export preserved"
  }
}finally{
  foreach($job in $script:Jobs.Values){try{if(-not $job.Started.Process.HasExited){$job.Started.Process.Kill()}}catch{}}
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
