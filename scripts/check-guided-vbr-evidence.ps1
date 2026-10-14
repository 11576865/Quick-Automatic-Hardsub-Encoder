# Offline PowerShell 5.1 Guided ASS receipt fixture. No FFmpeg required.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../windows/guided-rendered-sample-evidence.ps1')
$dir=Join-Path ([IO.Path]::GetTempPath()) ('qhe-guided-vbr-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $dir -Force)
try{
  $utf8=New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $dir 'subtitle.ass'),'[Events]'+[char]10+'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi',$utf8)
  $fontDir=Join-Path $dir 'fonts'
  [void](New-Item -ItemType Directory -Path $fontDir -Force)
  [IO.File]::WriteAllBytes((Join-Path $fontDir 'font1.ttf'),[byte[]](10,20,30,40))
  $a=Get-GuidedRenderedAssetStamp $dir
  $before=[pscustomobject]@{source='stat-sha256:source';runtime='stat-sha256:runtime'}
  $options=[pscustomobject]@{
    sampleExact=$true;withSubtitles=$true;guidedRenderedReference=$true
    measureSsim=$true;multipass='disabled';targetVideoBitrate=700000
    start=12.0;duration=2.0;preset='medium';codec='h264'
    outputWidth=0;outputHeight=0;referenceWidth=0;referenceHeight=0
  }
  $result=New-GuidedExactVbrReceipt $before $before $options 'libx264' 'medium' 2.0 $a $a
  if($result.method -ne 'windows-native-exact-guided-ass-vbr-v1' -or
     $result.assTextSha256 -ne $a.assTextSha256 -or
     $result.fontContentSha256 -ne $a.fontContentSha256 -or
     $result.requestedRate -ne 700000 -or $result.referenceDomain -ne 'guided-ass-rendered'){
    throw 'Guided Native receipt identity or method mismatch.'
  }
  $errorDetected=$false
  [IO.File]::WriteAllText((Join-Path $dir 'subtitle.ass'),'changed ASS',$utf8)
  $after=Get-GuidedRenderedAssetStamp $dir
  try{[void](New-GuidedExactVbrReceipt $before $before $options 'libx264' 'medium' 2.0 $a $after)}catch{$errorDetected=$true}
  if(-not $errorDetected){throw 'Changed staged ASS did not reject the receipt.'}
  $errorDetected=$false
  [IO.File]::WriteAllBytes((Join-Path $fontDir 'font1.ttf'),[byte[]](40,30,20,10))
  $fontAfter=Get-GuidedRenderedAssetStamp $dir
  try{[void](New-GuidedExactVbrReceipt $before $before $options 'libx264' 'medium' 2.0 $after $fontAfter)}catch{$errorDetected=$true}
  if(-not $errorDetected){throw 'Changed staged font did not reject the receipt.'}
  $errorDetected=$false
  try{[void](New-GuidedExactVbrReceipt $before ([pscustomobject]@{source='changed';runtime=$before.runtime}) $options 'libx264' 'medium' 2.0 $a $a)}catch{$errorDetected=$true}
  if(-not $errorDetected){throw 'Changed source did not reject the receipt.'}
  Write-Host 'B11 Guided Native rendered VBR evidence isolation passed.'
}finally{
  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
