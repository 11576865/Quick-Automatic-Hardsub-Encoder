# PowerShell 5.1. Identify the exact staged ASS and font bytes used by a
# Guided VBR sample. The digest does not certify final output or system fonts.
function Get-GuidedRenderedAssetStamp([string]$WorkDir) {
  $ass=Join-Path $WorkDir 'subtitle.ass'
  if(-not(Test-Path -LiteralPath $ass -PathType Leaf)){throw 'Missing staged ASS.'}
  $assHash=(Get-FileHash -LiteralPath $ass -Algorithm SHA256).Hash.ToLowerInvariant()
  $dir=Join-Path $WorkDir 'fonts'
  $records=@()
  if(Test-Path -LiteralPath $dir -PathType Container){
    $records=@(Get-ChildItem -LiteralPath $dir -File | Sort-Object Name | ForEach-Object {
      $_.Name.ToLowerInvariant()+':'+(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    })
  }
  $sha=[Security.Cryptography.SHA256]::Create()
  try{
    $bytes=[Text.Encoding]::UTF8.GetBytes([string]::Join([char]10,[string[]]$records))
    $fonts=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
  }finally{$sha.Dispose()}
  return [pscustomobject]@{assTextSha256=$assHash;fontContentSha256=$fonts;fontCount=$records.Count}
}
function New-GuidedExactVbrReceipt($Before,$After,$Options,[string]$ActualEncoder,[double]$ActualDuration,$AssetBefore,$AssetAfter){
  if(-not $Before -or -not $After -or $Before.source -ne $After.source -or $Before.runtime -ne $After.runtime){
    throw 'Native source or FFmpeg changed while sampling.'
  }
  if(-not $AssetBefore -or -not $AssetAfter -or
     $AssetBefore.assTextSha256 -ne $AssetAfter.assTextSha256 -or
     $AssetBefore.fontContentSha256 -ne $AssetAfter.fontContentSha256 -or
     $AssetBefore.fontCount -ne $AssetAfter.fontCount){throw 'Staged ASS/font content changed during sample.'}
  $rate=[double]$Options.targetVideoBitrate
  $start=[double]$Options.start;$duration=[double]$Options.duration
  if(-not [bool]$Options.sampleExact -or -not [bool]$Options.withSubtitles -or
     -not [bool]$Options.guidedRenderedReference -or -not [bool]$Options.measureSsim -or
     [string]::IsNullOrWhiteSpace($ActualEncoder) -or
     [string]$Options.multipass -ne 'disabled' -or
     [double]::IsNaN($rate) -or [double]::IsInfinity($rate) -or
     $rate -le 0 -or $rate -gt 1e10 -or $rate -ne [Math]::Floor($rate) -or
     [double]::IsNaN($start) -or [double]::IsInfinity($start) -or $start -lt 0 -or
     [double]::IsNaN($duration) -or [double]::IsInfinity($duration) -or
     $duration -le 0 -or $duration -gt 8 -or
     [double]::IsNaN($ActualDuration) -or [double]::IsInfinity($ActualDuration) -or
     $ActualDuration -le 0 -or [string]::IsNullOrWhiteSpace([string]$Options.preset)){
    throw 'Invalid Guided exact VBR evidence request.'
  }
  $scaled=[int]$Options.outputWidth -gt 0 -or [int]$Options.outputHeight -gt 0
  if($scaled -and ([int]$Options.outputWidth -lt 2 -or [int]$Options.outputHeight -lt 2)){
    throw 'Invalid Guided scaled output geometry.'
  }
  return [pscustomobject]@{
    schemaVersion=1;method='windows-native-exact-guided-ass-vbr-v1'
    referenceMetric=$(if($scaled){'ass-rendered-bicubic-upscale-ssim-v1'}else{'ass-rendered-yuv420p-ssim-v1'})
    referenceDomain='guided-ass-rendered'
    sourceToken=[string]$Before.source;runtimeToken=[string]$Before.runtime
    identityKind='file-stat-snapshot-plus-staged-asset-sha256'
    assTextSha256=[string]$AssetBefore.assTextSha256
    fontContentSha256=[string]$AssetBefore.fontContentSha256
    fontCount=[int]$AssetBefore.fontCount
    requestedStart=$start;requestedDuration=$duration;actualDuration=$ActualDuration
    encoder=$ActualEncoder;codec=[string]$Options.codec;preset=[string]$Options.preset
    multipass='disabled';pixelFormat='yuv420p';videoStream=0
    outputWidth=$(if($scaled){[int]$Options.outputWidth}else{0})
    outputHeight=$(if($scaled){[int]$Options.outputHeight}else{0})
    referenceWidth=$(if($scaled){[int]$Options.referenceWidth}else{0})
    referenceHeight=$(if($scaled){[int]$Options.referenceHeight}else{0})
    mode='bitrate';requestedRate=[long]$rate;requestedQuality=$null
    wholeMovieQualityVerified=$false;finalOutputSizeVerified=$false
  }
}
