$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../windows/media-task.ps1')
$file=Join-Path ([IO.Path]::GetTempPath()) ('qhe-stream-plan-'+[guid]::NewGuid().ToString('N')+'.json')
try{
    & node (Join-Path $PSScriptRoot 'build-stream-plan-tasks.mjs') $file
    if($LASTEXITCODE -ne 0){throw 'Stream plan task generation failed.'}
    $task=Get-Content $file -Raw | ConvertFrom-Json
    $args=Get-MediaTaskArgs $task
    if($args -notcontains '-c:a:1' -or $args -notcontains '0:s:1' -or $args -notcontains '0:t:0'){throw 'Indexed stream mapping was lost.'}
    $first=Get-MediaFirstPassArgs $args
    if(@($first | Where-Object {$_ -match '^-(c|b|ac|ar):a:'}).Count){throw 'First pass retained indexed audio parameters.'}
    Test-PlannedAudioOutput $task @([pscustomobject]@{codec_name='flac'},[pscustomobject]@{codec_name='aac';channels=1;sample_rate=48000}) @([pscustomobject]@{codec='flac'},[pscustomobject]@{codec='aac'},[pscustomobject]@{codec='flac'})
    $bad=$task | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $bad.outputArgs=@($bad.outputArgs)+@('-c:a:32','aac')
    $rejected=$false;try{[void](Get-MediaTaskArgs $bad)}catch{$rejected=$true}
    if(-not $rejected){throw 'Out-of-bound indexed audio selector was admitted.'}
}finally{Remove-Item $file -Force -ErrorAction SilentlyContinue}
Write-Host 'Indexed stream plan arguments and output codec contract passed.'
