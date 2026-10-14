# B16 pre-encode isolated mux observation, Windows PowerShell 5.1.
# NEVER claim the isolated mux exactly predicts a mixed video/audio task.
# The observed bytes MUST NOT replace the conservative full-source reserve.
param(
 [Parameter(Mandatory=$true)][string]$Ffmpeg,
 [Parameter(Mandatory=$true)][string]$Ffprobe,
 [Parameter(Mandatory=$true)][string]$RequestFile,
 [Parameter(Mandatory=$true)][string]$ReceiptFile
)
$ErrorActionPreference='Stop'
function Fail([string]$text){throw $text}
function Quote-Preflight([string]$s){return '"'+$s.Replace('"','\"')+'"'}
function Run-Preflight([string]$exe,[string]$args,[int]$seconds){
 $p=New-Object Diagnostics.Process
 $p.StartInfo.FileName=$exe
 $p.StartInfo.Arguments=$args
 $p.StartInfo.UseShellExecute=$false
 $p.StartInfo.CreateNoWindow=$true
 $p.StartInfo.RedirectStandardOutput=$true
 $p.StartInfo.RedirectStandardError=$true
 try{
  [void]$p.Start()
  $stdout=$p.StandardOutput.ReadToEndAsync()
  $stderr=$p.StandardError.ReadToEndAsync()
  if(-not $p.WaitForExit($seconds*1000)){throw 'Trim preflight exceeded bounded time.'}
  if($p.ExitCode -ne 0){throw ('Trim preflight FFmpeg/FFprobe failed: '+$stderr.Result)}
  return $stdout.Result
 }finally{
  try{if(-not $p.HasExited){$p.Kill();$p.WaitForExit()}}catch{}
  $p.Dispose()
 }
}
if(-not(Test-Path -LiteralPath $Ffmpeg -PathType Leaf) -or
   -not(Test-Path -LiteralPath $Ffprobe -PathType Leaf) -or
   -not(Test-Path -LiteralPath $RequestFile -PathType Leaf)){
 Fail 'Preflight binary or request is missing.'
}
$r=Get-Content -LiteralPath $RequestFile -Raw|ConvertFrom-Json
if([int]$r.version -ne 1 -or [string]$r.mode -ne 'isolated-trim-copy' -or
   -not(Test-Path -LiteralPath ([string]$r.sourcePath) -PathType Leaf) -or
   [string]$r.outputFormat -notin @('matroska','mp4')){Fail 'Malformed isolated trim preflight request.'}
$start=[double]$r.start
$end=[double]$r.end
if([double]::IsNaN($start) -or [double]::IsInfinity($start) -or $start -lt 0 -or
   [double]::IsNaN($end) -or [double]::IsInfinity($end) -or
   $end -le $start -or $end-$start -gt 3600){Fail 'Trim preflight range invalid or over bounded one-hour limit.'}
$audioOrdinals=if($null -eq $r.audioOrdinals){@()}else{@($r.audioOrdinals)}
$subOrdinals=if($null -eq $r.subtitleOrdinals){@()}else{@($r.subtitleOrdinals)}
if($audioOrdinals.Count+$subOrdinals.Count -eq 0 -or
   $audioOrdinals.Count+$subOrdinals.Count -gt 32){Fail 'No selected auxiliary copy streams or too many.'}
foreach($x in @($audioOrdinals)+@($subOrdinals)){
 if($null -eq $x -or [string]$x -notmatch '^\d+$' -or [int]$x -gt 63){
  Fail 'Invalid preflight source stream ordinal.'
 }
}
if(@($audioOrdinals|Select-Object -Unique).Count -ne $audioOrdinals.Count -or
   @($subOrdinals|Select-Object -Unique).Count -ne $subOrdinals.Count){
 Fail 'Duplicated selected stream ordinal.'
}
$source=Get-Item -LiteralPath ([string]$r.sourcePath)
if($source.Length -le 0){Fail 'Empty preflight input.'}
$probe=Run-Preflight $Ffprobe ('-v error -show_entries stream=index,codec_type -of csv=p=0 '+(Quote-Preflight $source.FullName)) 15
$inventory=@($probe -split '\r?\n' |Where-Object {$_ -match '^\d+,(audio|subtitle)$'})
$aCount=@($inventory|Where-Object {$_ -match ',audio$'}).Count
$sCount=@($inventory|Where-Object {$_ -match ',subtitle$'}).Count
foreach($ordinal in $audioOrdinals){if([int]$ordinal -ge $aCount){Fail 'Selected source audio ordinal absent.'}}
foreach($ordinal in $subOrdinals){if([int]$ordinal -ge $sCount){Fail 'Selected source subtitle ordinal absent.'}}
$originalSize=[long]$source.Length
$originalTicks=[long]$source.LastWriteTimeUtc.Ticks
$workspace=Join-Path ([IO.Path]::GetTempPath()) ('qhe-trim-copy-preflight-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Force -Path $workspace)
try{
 $suffix=if($r.outputFormat -eq 'matroska'){'mkv'}else{'mp4'}
 $remux=Join-Path $workspace ('isolated.'+$suffix)
 $packetReceipt=Join-Path $workspace 'packet-audit.json'
 $culture=[Globalization.CultureInfo]::InvariantCulture
 $from=$start.ToString('0.######',$culture)
 $duration=($end-$start).ToString('0.######',$culture)
 $args=@('-hide_banner','-nostdin','-loglevel','error','-y',
   '-ss',$from,'-t',$duration,'-i',(Quote-Preflight $source.FullName))
 foreach($ordinal in $audioOrdinals){$args+=@('-map',('0:a:'+[int]$ordinal))}
 foreach($ordinal in $subOrdinals){$args+=@('-map',('0:s:'+[int]$ordinal))}
 $args+=@('-c','copy','-map_metadata','-1','-map_chapters','-1',
   '-f',[string]$r.outputFormat,(Quote-Preflight $remux))
 [void](Run-Preflight $Ffmpeg (($args|ForEach-Object {if($_ -like '"*"'){$_}else{[string]$_}})-join ' ') 75)
 if(-not(Test-Path -LiteralPath $remux -PathType Leaf)){
  Fail 'Isolated copy remux produced no file.'
 }
 $worker=Join-Path $PSScriptRoot 'trim-packet-audit.ps1'
 if(-not(Test-Path -LiteralPath $worker -PathType Leaf)){
  Fail 'Independent packet audit worker missing.'
 }
 $workerArgs='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File '+
   (Quote-Preflight $worker)+' -Ffprobe '+(Quote-Preflight $Ffprobe)+
   ' -OutputFile '+(Quote-Preflight $remux)+
   ' -ReceiptFile '+(Quote-Preflight $packetReceipt)
 [void](Run-Preflight 'powershell.exe' $workerArgs 165)
 if(-not(Test-Path -LiteralPath $packetReceipt -PathType Leaf)){
  Fail 'Independent remux packet audit failed.'
 }
 $audit=Get-Content -LiteralPath $packetReceipt -Raw|ConvertFrom-Json
 if($audit.version -ne 1 -or $audit.scope -ne 'completed-artifact' -or
    @($audit.audioPacketBytes).Count -ne $audioOrdinals.Count -or
    @($audit.subtitlePacketBytes).Count -ne $subOrdinals.Count){
  Fail 'Observed preflight packet count mismatches selected streams.'
 }
 foreach($n in @($audit.audioPacketBytes)+@($audit.subtitlePacketBytes)){
  if($null -eq $n -or [long]$n -lt 0){Fail 'Packet audit cost unavailable.'}
 }
 $after=Get-Item -LiteralPath $source.FullName
 if($after.Length -ne $originalSize -or
    $after.LastWriteTimeUtc.Ticks -ne $originalTicks){
  Fail 'Source changed during isolated preflight.'
 }
 $data=@{
  version=1;scope='isolated-trim-copy-observation'
  observationOnly=$true;canReplaceFullSourceBudget=$false
  sourceLength=$originalSize;sourceWriteTicks=([string]$originalTicks)
  start=$start;end=$end;outputFormat=[string]$r.outputFormat
  audioOrdinals=@($audioOrdinals|ForEach-Object {[int]$_})
  subtitleOrdinals=@($subOrdinals|ForEach-Object {[int]$_})
  audioPacketBytes=@($audit.audioPacketBytes|ForEach-Object {[long]$_})
  subtitlePacketBytes=@($audit.subtitlePacketBytes|ForEach-Object {[long]$_})
  method='ffmpeg-isolated-auxiliary-copy-remux-then-independent-ffprobe-v1'
 }
 $tmp=$ReceiptFile+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
 try{
  [IO.File]::WriteAllText($tmp,($data|ConvertTo-Json -Depth 8 -Compress),
    (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $ReceiptFile -ErrorAction Stop
 }finally{if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue}}
}finally{Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue}
