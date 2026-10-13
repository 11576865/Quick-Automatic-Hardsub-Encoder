$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../windows/native-backend.ps1')
$help=@'
-fps_mode[:<stream_spec>] <string> modern stream matching
-c[:stream_specifier] codec
-b:v[:<stream_spec>] bitrate
-vsync number
-fps_mode value
'@
$actual=@(Get-FfmpegOptionNames $help)
$expected=@('-fps_mode','-c','-b:v','-vsync')
if(($actual -join '|') -ne ($expected -join '|')){throw 'FFmpeg optional-stream-selector option extraction differs.'}
$bad="description mentions -fps_mode`n-fps_mode[broken text`n--fps_mode value`n-fps_modeBogus[broken"
if(@(Get-FfmpegOptionNames $bad).Count){throw 'Malformed help was treated as available options.'}
if(@(Get-FfmpegOptionNames "-fps_mode value`r`n-vsync number").Count -ne 2){throw 'Legacy CRLF option extraction failed.'}
Write-Host 'FFmpeg base option names passed optional-selector, malformed-help and legacy fixtures.'
