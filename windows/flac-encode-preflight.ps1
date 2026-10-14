# B16 isolated full/trim audio FLAC encode observation. PowerShell 5.1.
# The resulting packet totals DO NOT authorize a change in formal sizeBudget.
param(
 [Parameter(Mandatory=$true)][string]$Ffmpeg,
 [Parameter(Mandatory=$true)][string]$Ffprobe,
 [Parameter(Mandatory=$true)][string]$RequestFile,
 [Parameter(Mandatory=$true)][string]$ReceiptFile
)
$ErrorActionPreference='Stop'
function Deny([string]$reason){throw $reason}
function Q([string]$v){return '"'+$v.Replace('"','\"')+'"'}
function RunBounded([string]$tool,[string]$Arguments,[int]$maxSeconds,[string]$guardFile=''){
 $p=New-Object Diagnostics.Process
 $p.StartInfo.FileName=$tool;$p.StartInfo.Arguments=$Arguments
 $p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true
 $p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true
 try{
  [void]$p.Start()
  $out=$p.StandardOutput.ReadToEndAsync()
  $err=$p.StandardError.ReadToEndAsync()
  $clock=[Diagnostics.Stopwatch]::StartNew()
  while(-not $p.WaitForExit(500)){
   if($clock.Elapsed.TotalSeconds -gt $maxSeconds){
    Deny 'FLAC preflight timeout; evidence unavailable.'
   }
   if($guardFile -and (Test-Path -LiteralPath $guardFile -PathType Leaf) -and
      (Get-Item -LiteralPath $guardFile).Length -gt 1073741824){
    Deny 'FLAC preflight temporary media exceeds bounded 1 GiB.'
   }
  }
  if($p.ExitCode -ne 0){Deny ('FLAC preflight tool failed: '+$err.Result)}
  return $out.Result
 }finally{try{if(-not $p.HasExited){$p.Kill();$p.WaitForExit()}}catch{};$p.Dispose()}
}
if(-not(Test-Path -LiteralPath $Ffmpeg -PathType Leaf) -or
   -not(Test-Path -LiteralPath $Ffprobe -PathType Leaf) -or
   -not(Test-Path -LiteralPath $RequestFile -PathType Leaf)){Deny 'Missing preflight binary or request.'}
$r=Get-Content -LiteralPath $RequestFile -Raw|ConvertFrom-Json
if([int]$r.version -ne 1 -or [string]$r.mode -ne 'isolated-flac-encode' -or
   -not(Test-Path -LiteralPath ([string]$r.sourcePath) -PathType Leaf) -or
   [string]$r.outputFormat -ne 'matroska'){Deny 'FLAC preflight only supports source-owned Matroska.'}
$tracks=@($r.tracks)
if($tracks.Count -lt 1 -or $tracks.Count -gt 16){Deny 'Select 1 to 16 FLAC audio streams.'}
$start=[double]$r.start;$end=[double]$r.end
if([double]::IsNaN($start) -or [double]::IsInfinity($start) -or
   [double]::IsNaN($end) -or [double]::IsInfinity($end) -or
   $start -lt 0 -or $end -le $start -or $end-$start -gt 14400){
 Deny 'FLAC preflight range invalid or exceeds bounded 4-hour window.'
}
$seen=@{}
$hasTrim=$false
foreach($t in $tracks){
 if($null -eq $t -or [string]$t.action -ne 'flac' -or
    [string]$t.sourceOrdinal -notmatch '^[0-9]+$' -or
    [int]$t.sourceOrdinal -gt 63 -or
    [string]$t.range -notin @('full','trim') -or
    $seen.ContainsKey([string]$t.sourceOrdinal)){Deny 'Invalid or repeated FLAC source stream.'}
 $seen[[string]$t.sourceOrdinal]=$true
 if($t.range -eq 'trim'){$hasTrim=$true}
 if($null -ne $t.channels -and ([string]$t.channels -notmatch '^[1-8]$')){Deny 'FLAC channel count invalid.'}
 if($null -ne $t.sampleRate -and ([string]$t.sampleRate -notmatch '^[0-9]+$' -or
    [int]$t.sampleRate -lt 8000 -or [int]$t.sampleRate -gt 192000)){Deny 'FLAC sample rate invalid.'}
}
$source=Get-Item -LiteralPath ([string]$r.sourcePath)
if($source.Length -le 0){Deny 'FLAC source empty.'}
$size=[long]$source.Length;$ticks=[string]$source.LastWriteTimeUtc.Ticks
$probe=RunBounded $Ffprobe ('-v error -show_entries stream=index,codec_type -of csv=p=0 '+(Q $source.FullName)) 15
$aCount=@($probe -split '\r?\n'|Where-Object {$_ -match '^\d+,audio$'}).Count
foreach($t in $tracks){if([int]$t.sourceOrdinal -ge $aCount){Deny 'FLAC source audio ordinal absent.'}}
$work=Join-Path ([IO.Path]::GetTempPath()) ('qhe-flac-preflight-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work -Force)
try{
 $out=Join-Path $work 'isolated-flac.mka'
 $packet=Join-Path $work 'packets.json'
 $culture=[Globalization.CultureInfo]::InvariantCulture
 $begin=$start.ToString('0.######',$culture)
 $length=($end-$start).ToString('0.######',$culture)
 $args=@('-hide_banner','-nostdin','-loglevel','error','-y','-i',(Q $source.FullName))
 if($hasTrim){$args+=@('-ss',$begin,'-t',$length,'-i',(Q $source.FullName))}
 for($i=0;$i -lt $tracks.Count;$i++){
  $t=$tracks[$i]
  $args+=@('-map',($(if($t.range -eq 'trim'){'1:a:'}else{'0:a:'})+[int]$t.sourceOrdinal))
  $args+=@('-c:a:'+$i,'flac')
  if($null -ne $t.channels){$args+=@('-ac:a:'+$i,[string]$t.channels)}
  if($null -ne $t.sampleRate){$args+=@('-ar:a:'+$i,[string]$t.sampleRate)}
 }
 $args+=@('-vn','-sn','-dn','-map_metadata','-1','-map_chapters','-1',
   '-f','matroska',(Q $out))
 [void](RunBounded $Ffmpeg ($args -join ' ') 360 $out)
 if(-not(Test-Path -LiteralPath $out -PathType Leaf)){Deny 'FLAC remux has no output.'}
 if((Get-Item -LiteralPath $out).Length -gt 1073741824){Deny 'Isolated FLAC output exceeds bounded 1 GiB temporary limit.'}
 $worker=Join-Path $PSScriptRoot 'trim-packet-audit.ps1'
 $workerArgs='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File '+(Q $worker)+
   ' -Ffprobe '+(Q $Ffprobe)+' -OutputFile '+(Q $out)+' -ReceiptFile '+(Q $packet)
 [void](RunBounded 'powershell.exe' $workerArgs 270)
 if(-not(Test-Path -LiteralPath $packet -PathType Leaf)){Deny 'Independent FLAC packet worker unavailable.'}
 $audit=Get-Content -LiteralPath $packet -Raw|ConvertFrom-Json
 if($audit.version -ne 1 -or $audit.scope -ne 'completed-artifact' -or
    @($audit.audioPacketBytes).Count -ne $tracks.Count -or
    @($audit.subtitlePacketBytes).Count -ne 0){Deny 'FLAC packet audit output mismatch.'}
 foreach($v in @($audit.audioPacketBytes)){
  if($null -eq $v -or [string]$v -notmatch '^[0-9]+$'){Deny 'FLAC audio packet cost unavailable.'}
 }
 $after=Get-Item -LiteralPath $source.FullName
 if([long]$after.Length -ne $size -or [string]$after.LastWriteTimeUtc.Ticks -ne $ticks){
  Deny 'Source changed during FLAC preflight.'
 }
 $cost=@()
 for($i=0;$i -lt $tracks.Count;$i++){
  $cost+=@{sourceOrdinal=[int]$tracks[$i].sourceOrdinal;range=[string]$tracks[$i].range;
   channels=$(if($null -eq $tracks[$i].channels){$null}else{[int]$tracks[$i].channels});
   sampleRate=$(if($null -eq $tracks[$i].sampleRate){$null}else{[int]$tracks[$i].sampleRate});
   packetBytes=[long]$audit.audioPacketBytes[$i]}
 }
 $receipt=@{version=1;scope='isolated-flac-encode-observation';method='ffmpeg-flac-full-input-trim-input-independent-ffprobe-v1';
  observationOnly=$true;canReplaceFormalBudget=$false;canCertifyFinalMux=$false;
  sourceLength=$size;sourceWriteTicks=$ticks;start=$start;end=$end;
  outputFormat='matroska';tracks=@($cost)}
 $temporary=$ReceiptFile+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
 try{
  [IO.File]::WriteAllText($temporary,($receipt|ConvertTo-Json -Depth 8 -Compress),
    (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $ReceiptFile -ErrorAction Stop
 }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue}}
}finally{Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
