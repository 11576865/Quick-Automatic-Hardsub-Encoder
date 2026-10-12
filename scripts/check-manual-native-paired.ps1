# Actual Windows localhost Native Bridge codec-pair experiment, not mocked samples.
# Executes identical source/window CQ samples with x264 and x265, then asks the
# existing Manual evidence model to validate paired observations and fit a
# shared, bounded upper envelope. This is CI-only; it never changes the GUI.
$ErrorActionPreference='Stop'
$work=Join-Path $env:RUNNER_TEMP ('manual-paired-native-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work -Force)
$source=Join-Path $work 'source.mkv'
$stdout=Join-Path $work 'bridge-stdout.log'
$stderr=Join-Path $work 'bridge-stderr.log'
$port=8899
$root="http://127.0.0.1:$port"
$headers=@{'X-Quick-Hardsub-Token'='ci-manual-paired-token';Origin=$root}
$bridge=$null
try {
  & ffmpeg -hide_banner -nostdin -loglevel error -y -f lavfi -i 'testsrc2=size=320x180:rate=12:duration=5' -an -c:v ffv1 $source
  if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $source)){throw 'Cannot generate source FFV1 video.'}
  $bridge=Start-Process powershell.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',(Resolve-Path './windows/native-bridge.ps1'),
    '-NoBrowser','-Port',[string]$port,'-Token','ci-manual-paired-token','-InitialVideo',$source
  )
  $ready=$false
  for($i=0;$i -lt 60;$i++){
    Start-Sleep -Milliseconds 350
    try{
      $health=Invoke-RestMethod -Method Get -Uri "$root/api/health" -Headers $headers -TimeoutSec 3
      if($health.available){$ready=$true;break}
    }catch{}
  }
  if(-not $ready){throw 'Native Bridge health was not ready.'}
  foreach($encoder in @('libx264','libx265')){
    $availability=@($health.encoders | Where-Object {($_.key -eq $encoder -or $_.Key -eq $encoder) -and ($_.available -or $_.Available)})
    if(-not $availability.Count){throw "Required software encoder is not available: $encoder"}
  }
  $probe=Invoke-RestMethod -Method Post -Uri "$root/api/probe" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 30
  if(-not $probe.ok -or [int]$probe.width -ne 320 -or [int]$probe.height -ne 180){throw 'Native probe did not recognize source geometry.'}

  $windows=@(
    @{start=0.25;duration=1.5},
    @{start=3.0;duration=1.5}
  )
  $branches=@(
    @{id='h264-x264';codec='h264';encoder='libx264';preset='medium'},
    @{id='h265-x265';codec='h265';encoder='libx265';preset='medium'}
  )
  $qualities=@(18,28,40)
  $samples=@()
  foreach($branch in $branches){
    foreach($quality in $qualities){
      foreach($window in $windows){
        $request=@{
          requestId=('paired-'+$branch.id+'-'+$quality+'-'+[string]$window.start)
          options=@{
            codec=$branch.codec;encoder=$branch.encoder;preset=$branch.preset
            multipass='disabled';sampleExact=$true;crf=$quality
            start=[double]$window.start;duration=[double]$window.duration
            withSubtitles=$false;targetVideoBitrate=0;measureSsim=$true
            retainSample=$false;timeoutSeconds=55
          }
        }|ConvertTo-Json -Depth 7 -Compress
        $result=Invoke-RestMethod -Method Post -Uri "$root/api/sample" -Headers $headers -ContentType 'application/json' -Body $request -TimeoutSec 85
        if(-not $result.ok -or -not $result.nativeEvidence -or
          [string]$result.encoder -ne [string]$branch.encoder -or
          ([double]::IsNaN([double]$result.ssim) -or [double]::IsInfinity([double]$result.ssim))){
          throw "Native sample returned invalid result for $($branch.id), CQ $quality, $($window.start)"
        }
        $samples+=@{id=$branch.id;codec=$branch.codec;encoder=$branch.encoder;preset=$branch.preset
          quality=$quality;window=$window;result=$result}
        Write-Host ("Real Native pair sample: {0} CRF={1} window={2}s ssim={3:N5} bytes={4}" -f
          $branch.id,$quality,$window.start,[double]$result.ssim,[long]$result.totalVideoBytes)
      }
    }
  }
  $fixture=@{
    kind='qhe-manual-windows-native-paired-v1'
    sourceType='FFV1 synthetic real encoded source; actual Windows Native FFmpeg samples'
    sourceGeometry=@{width=320;height=180}
    mediaDuration=5.0;rangeStart=0.0;rangeEnd=5.0
    windows=$windows;branches=$branches;qualities=$qualities;samples=$samples
  }|ConvertTo-Json -Depth 13 -Compress
  $path=Join-Path $work 'paired-native-evidence.json'
  [IO.File]::WriteAllText($path,$fixture,[Text.UTF8Encoding]::new($false))
  & node './scripts/verify-manual-native-paired.mjs' $path
  if($LASTEXITCODE -ne 0){throw 'Native paired source evidence failed strict model admission.'}
  Write-Host "PASS: 12 actual Windows localhost Native samples yielded a comparable paired codec model."
} catch {
  Write-Host '--- paired-bridge stdout tail ---'
  if(Test-Path -LiteralPath $stdout){Get-Content -LiteralPath $stdout -Tail 45|Write-Host}
  Write-Host '--- paired-bridge stderr tail ---'
  if(Test-Path -LiteralPath $stderr){Get-Content -LiteralPath $stderr -Tail 35|Write-Host}
  throw
} finally {
  if($bridge -and -not $bridge.HasExited){Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue}
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
