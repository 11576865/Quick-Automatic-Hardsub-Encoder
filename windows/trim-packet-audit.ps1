# B16: bounded, isolated, post-output stream-packet audit for large completed MKV.
# A worker receipt is observation only; it cannot amend a formal size ceiling.
param(
    [Parameter(Mandatory=$true)][string]$Ffprobe,
    [Parameter(Mandatory=$true)][string]$OutputFile,
    [Parameter(Mandatory=$true)][string]$ReceiptFile
)
$ErrorActionPreference='Stop'
if(-not (Test-Path -LiteralPath $Ffprobe -PathType Leaf)){throw 'FFprobe executable missing.'}
if(-not (Test-Path -LiteralPath $OutputFile -PathType Leaf)){throw 'Completed output is missing.'}
$before=Get-Item -LiteralPath $OutputFile
if($before.Length -le 0){throw 'Completed output is empty.'}

function Run-BoundedProbe([string]$arguments,[int]$limitSeconds,[bool]$packetStream=$false){
    $p=New-Object Diagnostics.Process
    $p.StartInfo.FileName=$Ffprobe
    $p.StartInfo.Arguments=$arguments
    $p.StartInfo.UseShellExecute=$false
    $p.StartInfo.CreateNoWindow=$true
    $p.StartInfo.RedirectStandardOutput=$true
    $p.StartInfo.RedirectStandardError=$true
    $timer=[Diagnostics.Stopwatch]::StartNew()
    $lines=New-Object 'System.Collections.Generic.List[string]'
    $totals=@{};$count=0
    try{
        [void]$p.Start()
        $stderr=$p.StandardError.ReadToEndAsync()
        while($true){
            $read=$p.StandardOutput.ReadLineAsync()
            while(-not $read.Wait(100)){
                if($timer.Elapsed.TotalSeconds -gt $limitSeconds){throw 'Packet audit worker exceeded time limit.'}
            }
            if($timer.Elapsed.TotalSeconds -gt $limitSeconds){throw 'Packet audit worker exceeded time limit.'}
            $line=$read.Result
            if($null -eq $line){break}
            $maxLines=if($packetStream){2000000}else{128}
            if(++$count -gt $maxLines){throw 'Packet audit worker exceeded bounded scan limit.'}
            if($packetStream){
                if($line -notmatch '^(\d+),(\d+)(?:,.*)?$'){throw 'Malformed completed output packet.'}
                $id=[int]$Matches[1];$length=[long]$Matches[2]
                if(-not $totals.ContainsKey($id)){$totals[$id]=0L}
                if($totals[$id] -gt ([long]::MaxValue-$length)){throw 'Packet-size sum overflow.'}
                $totals[$id]+=$length
            }else{$lines.Add($line)}
        }
        if(-not $p.WaitForExit(1000) -or $p.ExitCode -ne 0){
            throw 'FFprobe audit worker failed.'
        }
        return [pscustomobject]@{Lines=@($lines.ToArray());Totals=$totals}
    }finally{
        try{if(-not $p.HasExited){$p.Kill();[void]$p.WaitForExit(3000)}}catch{}
        $p.Dispose()
    }
}
# Quote as a single FFprobe CLI argument; do not interpret the media path as code.
function Quote-Arg([string]$value){
    return '"'+$value.Replace('"','\"')+'"'
}
$quoted=Quote-Arg $OutputFile
# The stream inventory is cheap; the bounded packet scans below handle long videos.
$streamLines=(Run-BoundedProbe ('-v error -show_entries stream=index,codec_type -of csv=p=0 '+$quoted) 15).Lines
$streamTable=@()
foreach($line in $streamLines){
    if($line -notmatch '^(\d+),(audio|subtitle|video|attachment|data)(?:,.*)?$'){continue}
    $streamTable+=@{index=[int]$Matches[1];kind=[string]$Matches[2]}
}
if($streamTable.Count -gt 64 -or $streamTable.Count -eq 0){throw 'Output stream inventory unavailable or exceeds safe limit.'}
# Independently probe each codec-packet class, never scale source packets by duration.
# Video scanning also makes the residual identifiable as non-AVS codec packets.
function Get-PacketTotals([string]$kind){
    return (Run-BoundedProbe ('-v error -select_streams '+$kind+' -show_packets -show_entries packet=stream_index,size -of csv=p=0 '+$quoted) 120 $true).Totals
}
$video=Get-PacketTotals 'v'
$audio=Get-PacketTotals 'a'
$subs=Get-PacketTotals 's'
$after=Get-Item -LiteralPath $OutputFile
if($after.Length -ne $before.Length -or $after.LastWriteTimeUtc.Ticks -ne $before.LastWriteTimeUtc.Ticks){
    throw 'Completed output changed during packet audit.'
}
$videoTotals=@($streamTable | Where-Object {$_.kind -eq 'video'} | ForEach-Object {
    if($video.ContainsKey([int]$_.index)){$video[[int]$_.index]}else{$null}
})
$audioTotals=@($streamTable | Where-Object {$_.kind -eq 'audio'} | ForEach-Object {
    if($audio.ContainsKey([int]$_.index)){$audio[[int]$_.index]}else{$null}
})
$subTotals=@($streamTable | Where-Object {$_.kind -eq 'subtitle'} | ForEach-Object {
    if($subs.ContainsKey([int]$_.index)){$subs[[int]$_.index]}else{$null}
})
# Use a private atomic receipt rather than interpreting a partially-written JSON file.
$data=@{
    version=1;scope='completed-artifact'
    videoPacketBytes=$videoTotals;audioPacketBytes=$audioTotals;subtitlePacketBytes=$subTotals
    sourceLength=[long]$after.Length;sourceWriteTicks=[long]$after.LastWriteTimeUtc.Ticks
}
$temp=$ReceiptFile+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
try{
    [IO.File]::WriteAllText($temp,($data|ConvertTo-Json -Depth 6 -Compress),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $ReceiptFile -ErrorAction Stop
}finally{
    if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
}
