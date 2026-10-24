param(
    [int]$Port = 8766,
    [switch]$NoBrowser,
    [string]$Token = '',
    [string]$InitialVideo = '',
    [string]$CiSaveDirectory = '',
    [string]$CiBatchVideoSeedList = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'native-backend.ps1')
. (Join-Path $PSScriptRoot 'manual-sample-evidence.ps1')
. (Join-Path $PSScriptRoot 'guided-rendered-sample-evidence.ps1')
. (Join-Path $PSScriptRoot 'trim-copy-preflight-bridge.ps1')
. (Join-Path $PSScriptRoot 'flac-encode-preflight-bridge.ps1')
. (Join-Path $PSScriptRoot 'output-safety.ps1')
. (Join-Path $PSScriptRoot 'media-task.ps1')
. (Join-Path $PSScriptRoot 'compression-history.ps1')
. (Join-Path $PSScriptRoot 'media-frame-rate.ps1')
. (Join-Path $PSScriptRoot 'bink-import.ps1')

$ErrorActionPreference = 'Stop'

function Write-BridgeLog([string]$Message,[string]$Level='INFO') {
    $stamp=(Get-Date).ToString('HH:mm:ss')
    Write-Host "[$stamp][$Level] $Message"
}

Write-Host ''
Write-Host 'Quick Automatic Hardsub Encoder · Windows Native Bridge'
Write-Host '-------------------------------------------------------'
Write-BridgeLog 'Starting local backend and detecting FFmpeg / GPU capabilities...'

$script:AllowedOrigin = 'https://11576865.github.io'
$script:Token = if($Token){$Token}else{[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) -replace '[^A-Za-z0-9]', ''}
$script:Selections = @{ video=@(); ass=@(); fonts=@() }
$script:BatchVideoSelections=@{}
$script:CiBatchPickerResult=$null
$script:EmbeddedAssImport=$null
# CI-only export destination acts as a pre-authorized *test dialog choice*.
# Production has NO HTTP file-path argument: users must use SaveFileDialog.
# Require the GitHub-hosted runner's own temporary subtree, never arbitrary
# paths or an untrusted page-provided destination.
# Script parameters themselves live in the script scope. Assigning
# $script:CiSaveDirectory='' before reading the same-named $CiSaveDirectory
# parameter silently erased the CI launch argument and opened a modal Windows
# SaveFileDialog on headless runners. Preserve the input under a distinct name.
$requestedCiSaveDirectory=[string]$CiSaveDirectory
$requestedCiBatchVideoSeedList=[string]$CiBatchVideoSeedList
$script:CiSaveDirectory=''
# Test-only fault hook, inert in all production sessions.
$script:CiNextExportFault=''
if($requestedCiSaveDirectory){
    if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){
        throw 'CI save directory requires a GitHub Actions runner.'
    }
    $runnerRoot=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char]92,[char]47)+[IO.Path]::DirectorySeparatorChar
    $saveRoot=[IO.Path]::GetFullPath($requestedCiSaveDirectory).TrimEnd([char]92,[char]47)
    if(-not $saveRoot.StartsWith($runnerRoot,[StringComparison]::OrdinalIgnoreCase) -or
       -not (Test-Path -LiteralPath $saveRoot -PathType Container)){
        throw 'CI save directory must be an existing directory below RUNNER_TEMP.'
    }
    $script:CiSaveDirectory=$saveRoot
    Write-BridgeLog 'CI-only preauthorized save chooser enabled (restricted RUNNER_TEMP).'
}
if($InitialVideo){
    if(-not (Test-Path -LiteralPath $InitialVideo -PathType Leaf)){throw 'InitialVideo does not exist.'}
    $script:Selections.video=@((Resolve-Path -LiteralPath $InitialVideo).Path)
    Write-BridgeLog ('Initial video preselected: '+[IO.Path]::GetFileName($script:Selections.video[0]))
}
$script:Jobs = @{}
$script:Samples = @{}
$script:ImportJobs = @{}
$script:VideoImport = $null
$script:Ffmpeg = Find-NativeTool 'ffmpeg' $PSScriptRoot
$script:Ffprobe = Find-NativeTool 'ffprobe' $PSScriptRoot
$script:RadVideo = Find-RadVideoConverter $PSScriptRoot
$script:Capabilities = if ($script:Ffmpeg) { Get-NativeCapabilities $script:Ffmpeg $script:Ffprobe $PSScriptRoot } else { $null }

function ConvertTo-JsonUtf8($Object) {
    return ($Object | ConvertTo-Json -Depth 12 -Compress)
}

function Invoke-BridgeTool([string]$Exe, [string]$Arguments, [string]$WorkingDirectory = '', [double]$TimeoutSeconds = 0) {
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo.FileName = $Exe
    $p.StartInfo.Arguments = $Arguments
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    if ($WorkingDirectory) { $p.StartInfo.WorkingDirectory = $WorkingDirectory }
    try {
        [void]$p.Start()
        $outTask = $p.StandardOutput.ReadToEndAsync()
        $errTask = $p.StandardError.ReadToEndAsync()
        if ($TimeoutSeconds -gt 0) {
            $milliseconds = [int][Math]::Min(2147483647, [Math]::Ceiling($TimeoutSeconds * 1000))
            if (-not $p.WaitForExit($milliseconds)) {
                try { $p.Kill() } catch {}
                $p.WaitForExit()
                throw ('FFmpeg sample encode timeout after ' + $TimeoutSeconds + ' seconds.')
            }
        }
        $p.WaitForExit()
        return [pscustomobject]@{
            ExitCode=$p.ExitCode
            StdOut=[string]$outTask.Result
            StdErr=[string]$errTask.Result
        }
    } finally {
        $p.Dispose()
    }
}

function Start-BridgeTool([string]$Exe, [string]$Arguments, [string]$WorkingDirectory) {
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo.FileName = $Exe
    $p.StartInfo.Arguments = $Arguments
    $p.StartInfo.WorkingDirectory = $WorkingDirectory
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    [void]$p.Start()
    return [pscustomobject]@{
        Process=$p
        StdOutTask=$p.StandardOutput.ReadToEndAsync()
        StdErrTask=$p.StandardError.ReadToEndAsync()
    }
}

function New-BridgeWorkDir([string]$Prefix) {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ($Prefix + [guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $dir -Force)
    return $dir
}

function Stage-BridgeAssets([string]$WorkDir, [string]$AssText) {
    if ([string]::IsNullOrWhiteSpace($AssText)) { throw 'ASS subtitle text is empty.' }
    Assert-BridgeEmbeddedSource
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $WorkDir 'subtitle.ass'), $AssText, $utf8)
    $fontDir = Join-Path $WorkDir 'fonts'
    [void](New-Item -ItemType Directory -Path $fontDir -Force)
    $n = 0
    foreach ($font in @($script:Selections.fonts)) {
        if (-not (Test-Path -LiteralPath $font -PathType Leaf)) { continue }
        $ext = [IO.Path]::GetExtension($font).ToLowerInvariant()
        if ($ext -notin @('.ttf','.otf','.ttc','.otc')) { continue }
        $n++
        Copy-Item -LiteralPath $font -Destination (Join-Path $fontDir ("font$n$ext")) -Force
    }
}


# WU-02 explicit MKV ASS+font import; staged assets are source-bound.
function Clear-BridgeEmbeddedAss {
  $old=$script:EmbeddedAssImport
  if(-not $old){return}
  if(@($script:Selections.ass).Count -and $script:Selections.ass[0] -eq $old.AssPath){$script:Selections.ass=@()}
  if(@($script:Selections.fonts).Count -and @($script:Selections.fonts)[0] -in @($old.FontPaths)){$script:Selections.fonts=@()}
  $script:EmbeddedAssImport=$null
  if($old.Work -and (Test-Path -LiteralPath $old.Work)){
    Remove-Item -LiteralPath $old.Work -Force -Recurse -ErrorAction SilentlyContinue
  }
}
function Assert-BridgeEmbeddedSource {
  $info=$script:EmbeddedAssImport
  if(-not $info){return}
  $now=Get-SelectedPath 'video'
  if(-not $now -or $now -ne $info.SourcePath){throw 'Embedded ASS source changed; import again.'}
  $stat=Get-Item -LiteralPath $now -ErrorAction Stop
  if([long]$stat.Length -ne $info.Bytes -or
     [long]$stat.LastWriteTimeUtc.Ticks -ne $info.WriteTicks){
    throw 'Embedded ASS source was modified; import again.'
  }
}
function Import-BridgeEmbeddedAss($Body) {
  if($null -eq $Body -or $null -eq $Body.subtitleOrdinal -or
     ([string]$Body.subtitleOrdinal) -notmatch '^[0-9]+$'){
    throw 'Explicit embedded ASS ordinal is required.'
  }
  $n=[int]$Body.subtitleOrdinal
  $video=Get-SelectedPath 'video'
  if(-not $video -or $video -ne (Get-OriginalVideoPath)){
    throw 'Embedded ASS import requires selected original source.'
  }
  $before=Get-Item -LiteralPath $video -ErrorAction Stop
  if($Body.sourceName -ne $before.Name -or [long]$Body.sourceSize -ne [long]$before.Length){
    throw 'Embedded ASS import requested for another source.'
  }
  $probe=Get-ProbeMedia
  $subs=@($probe.subtitleStreams)
  if($n -lt 0 -or $n -ge $subs.Count){throw 'Embedded subtitle ordinal is invalid.'}
  if([string]$subs[$n].codec_name -ne 'ass'){throw 'Selected embedded subtitle is not ASS.'}
  if(-not $probe.inputDecodeSmoke){throw 'Source cannot be decoded.'}
  $work=New-BridgeWorkDir 'quick-embedded-ass-'
  $assPath=Join-Path $work 'selected.ass'
  $fontPaths=New-Object 'System.Collections.Generic.List[string]'
  $fonts=New-Object 'System.Collections.Generic.List[object]'
  try {
    $args='-hide_banner -nostdin -loglevel error -y -i '+(Quote-NativeArg $video)+
      ' -map 0:s:'+$n+' -c:s ass -f ass '+(Quote-NativeArg $assPath)
    $extracted=Invoke-BridgeTool $script:Ffmpeg $args $work 40
    if($extracted.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $assPath)){
      throw ('Failed to extract embedded ASS. '+$extracted.StdErr)
    }
    $item=Get-Item -LiteralPath $assPath
    if($item.Length -le 0 -or $item.Length -gt 8MB){throw 'ASS size exceeds allowed 8 MB.'}
    $assText=[IO.File]::ReadAllText($assPath,[Text.Encoding]::UTF8)
    if($assText -notmatch '(?im)^\[Events\]\s*$'){throw 'Embedded ASS has no Events section.'}
    $total=0L
    $attachments=@($probe.attachmentStreams)
    for($i=0;$i -lt $attachments.Count;$i++){
      $attachment=$attachments[$i]
      $type=[string]$attachment.codec_name
      $filename=[string]$attachment.tags.filename
      $ext=[IO.Path]::GetExtension($filename).ToLowerInvariant()
      if($ext -notin @('.ttf','.otf','.ttc','.otc')){
        $ext=if($type -in @('ttf','otf','ttc','otc')){'.'+$type}else{''}
      }
      if(-not $ext){continue}
      if($fonts.Count -ge 24){throw 'More than 24 fonts; import was refused.'}
      $safeName='font-'+$i+$ext
      $target=Join-Path $work $safeName
      $dump='-hide_banner -nostdin -loglevel error -y -dump_attachment:t:'+$i+
        ' '+(Quote-NativeArg $safeName)+' -i '+(Quote-NativeArg $video)+
        ' -map 0:v:0 -frames:v 1 -f null NUL'
      $result=Invoke-BridgeTool $script:Ffmpeg $dump $work 40
      if($result.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $target)){
        throw ('Embedded font attachment '+$i+' could not be extracted. '+$result.StdErr)
      }
      $font=Get-Item -LiteralPath $target
      if($font.Length -le 0 -or $font.Length -gt 16MB){throw 'Unsafe embedded font size.'}
      $total+=[long]$font.Length
      if($total -gt 32MB){throw 'Combined embedded fonts exceed 32 MB.'}
      $fontPaths.Add($target)
      $fonts.Add([pscustomobject]@{
        name=$safeName;size=[long]$font.Length
        base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($target))
      })
    }
    $after=Get-Item -LiteralPath $video
    if($after.Length -ne $before.Length -or
       $after.LastWriteTimeUtc.Ticks -ne $before.LastWriteTimeUtc.Ticks -or
       $video -ne (Get-SelectedPath 'video')){
      throw 'Source changed during import.'
    }
    Clear-BridgeEmbeddedAss
    $script:Selections.ass=@($assPath)
    $script:Selections.fonts=@($fontPaths.ToArray())
    $script:EmbeddedAssImport=[pscustomobject]@{
      Work=$work;AssPath=$assPath;FontPaths=@($fontPaths.ToArray())
      SourcePath=$video;Bytes=[long]$after.Length
      WriteTicks=[long]$after.LastWriteTimeUtc.Ticks
    }
    return [pscustomobject]@{
      ok=$true;subtitleOrdinal=$n;sourceName=$after.Name;sourceSize=[long]$after.Length
      sourceBound=$true;fontMode='embedded'
      ass=[pscustomobject]@{
        name=('embedded-ass-'+$n+'.ass');size=[long]$item.Length
        base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($assPath))
      }
      fonts=@($fonts.ToArray());fontCount=$fonts.Count
    }
  }catch{
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Get-OriginalVideoPath {
    $items = @($script:Selections.video)
    if (-not $items.Count) { return $null }
    return [string]$items[0]
}

function Clear-Bink2ImportStaging {
    $work = if ($script:VideoImport) { [string]$script:VideoImport.Work } else { '' }
    if ($work -and (Test-Path -LiteralPath $work)) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($work) {
        foreach ($id in @($script:ImportJobs.Keys)) {
            $job = $script:ImportJobs[$id]
            if ($job.Work -eq $work -and $job.State -ne 'importing') {
                $script:ImportJobs.Remove($id)
            }
        }
    }
    $script:VideoImport = $null
}

function Test-Bink2ImportBusy {
    foreach ($job in $script:ImportJobs.Values) {
        if ($job.State -eq 'importing') {
            try {
                if (-not $job.Started.Process.HasExited) { return $true }
            } catch {
                return $true
            }
        }
    }
    return $false
}

function Get-Bink2ImportAdapterInfo {
    $original = Get-OriginalVideoPath
    $isBink2 = [bool]($original -and (Test-Bink2File $original))
    if ($isBink2 -and -not $script:RadVideo) {
        $script:RadVideo = Find-RadVideoConverter $PSScriptRoot
    }
    return [pscustomobject]@{
        kind = if ($isBink2) { 'rad-bink2' } else { '' }
        isBink2 = $isBink2
        available = [bool]$script:RadVideo
        applied = [bool]($script:VideoImport -and $script:VideoImport.Source -eq $original)
        tool = if ($script:RadVideo) { $script:RadVideo.Label } else { '' }
        toolSource = if ($script:RadVideo) { $script:RadVideo.Source } else { '' }
        externalDependency = $true
        bundled = $false
    }
}

function Start-Bink2ImportJob {
    if (Test-Bink2ImportBusy) { throw 'A Bink 2 import is already running.' }
    foreach ($existing in $script:Jobs.Values) {
        if ($existing.State -ne 'encoding') { continue }
        $alive = $false
        try { $alive = -not $existing.Started.Process.HasExited } catch { $alive = $true }
        if ($alive) { throw 'A Native encode job is already running.' }
    }

    $source = Get-OriginalVideoPath
    if (-not $source) { throw 'No video selected.' }
    if (-not (Test-Bink2File $source)) { throw 'Selected source is not a Bink 2 file.' }

    if (-not $script:RadVideo) { $script:RadVideo = Find-RadVideoConverter $PSScriptRoot }
    if (-not $script:RadVideo) {
        throw 'RAD Video Tools was not found. Install or extract RAD Video Tools and set RADVIDEO64 or RADVIDEO_HOME.'
    }

    Clear-Bink2ImportStaging
    $work = New-BridgeWorkDir 'quick-bink2-import-'
    $output = Join-Path $work 'decoded.avi'
    $args = Get-RadBinkConvertArguments $script:RadVideo $source $output
    $started = Start-BridgeTool $script:RadVideo.Path $args $work
    $jobId = [guid]::NewGuid().ToString('N')
    $job = [pscustomobject]@{
        Id = $jobId
        Kind = 'bink2-import'
        State = 'importing'
        Source = $source
        Work = $work
        Output = $output
        Started = $started
        StartedAt = [DateTime]::UtcNow
        Finalized = $false
        Cancelled = $false
        Error = ''
        Converter = $script:RadVideo.Label
    }
    $script:ImportJobs[$jobId] = $job
    Write-BridgeLog ("Bink 2 import "+$jobId+" started via "+$script:RadVideo.Label)
    return [pscustomobject]@{
        ok = $true
        jobId = $jobId
        state = 'importing'
        kind = 'rad-bink2'
        converter = $script:RadVideo.Label
    }
}

function Get-Bink2ImportJobStatus([string]$JobId) {
    if (-not $script:ImportJobs.ContainsKey($JobId)) {
        return [pscustomobject]@{ ok=$false; error='Unknown Bink 2 import job.' }
    }
    $j = $script:ImportJobs[$JobId]

    if ($j.State -eq 'completed') {
        if (-not (Test-Path -LiteralPath $j.Output -PathType Leaf)) {
            $j.State = 'failed'
            $j.Error = 'Bink 2 staging file is missing.'
            return [pscustomobject]@{ ok=$true; state='failed'; jobId=$JobId; kind='rad-bink2'; error=$j.Error }
        }
        return [pscustomobject]@{
            ok=$true; state='completed'; jobId=$JobId; kind='rad-bink2'
            outputBytes=(Get-Item -LiteralPath $j.Output).Length
            elapsedSeconds=[Math]::Max(0,([DateTime]::UtcNow-$j.StartedAt).TotalSeconds)
            sourceAdapterApplied=$true
        }
    }
    if ($j.State -eq 'cancelled') {
        return [pscustomobject]@{ ok=$true; state='cancelled'; jobId=$JobId; kind='rad-bink2' }
    }
    if ($j.State -eq 'failed') {
        return [pscustomobject]@{ ok=$true; state='failed'; jobId=$JobId; kind='rad-bink2'; error=$j.Error }
    }

    $p = $j.Started.Process
    if (-not $p.HasExited) {
        return [pscustomobject]@{
            ok=$true; state='importing'; jobId=$JobId; kind='rad-bink2'
            elapsedSeconds=[Math]::Max(0,([DateTime]::UtcNow-$j.StartedAt).TotalSeconds)
            converter=$j.Converter
        }
    }

    if (-not $j.Finalized) {
        $j.Finalized = $true
        $stderr = ''
        try { $stderr = [string]$j.Started.StdErrTask.Result } catch {}
        if ($j.Cancelled) {
            $j.State = 'cancelled'
            Remove-Item -LiteralPath $j.Work -Recurse -Force -ErrorAction SilentlyContinue
        } elseif ($p.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $j.Output -PathType Leaf) -or (Get-Item -LiteralPath $j.Output).Length -le 0) {
            $j.State = 'failed'
            $j.Error = $(if ($stderr.Trim()) { $stderr.Trim() } else { 'RAD Video Tools did not produce a usable AVI staging file.' })
            Remove-Item -LiteralPath $j.Work -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            $probe = Invoke-BridgeTool $script:Ffprobe ('-v error -show_streams -show_format -of json ' + (Quote-NativeArg $j.Output))
            $decode = Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -loglevel error -ss 0 -i ' + (Quote-NativeArg $j.Output) + ' -map 0:v:0 -frames:v 1 -f null NUL')
            if ($probe.ExitCode -ne 0 -or $decode.ExitCode -ne 0) {
                $j.State = 'failed'
                $detail = ($probe.StdErr.Trim() + ' ' + $decode.StdErr.Trim()).Trim()
                $j.Error = 'RAD import completed, but FFmpeg could not validate/decode the staging AVI. ' + $detail
                Remove-Item -LiteralPath $j.Work -Recurse -Force -ErrorAction SilentlyContinue
            } else {
                $json = $probe.StdOut | ConvertFrom-Json
                $videos = @($json.streams | Where-Object { $_.codec_type -eq 'video' })
                if (-not $videos.Count) {
                    $j.State = 'failed'
                    $j.Error = 'RAD import produced no video stream.'
                    Remove-Item -LiteralPath $j.Work -Recurse -Force -ErrorAction SilentlyContinue
                } else {
                    $script:VideoImport = [pscustomobject]@{
                        Source = $j.Source
                        Path = $j.Output
                        Work = $j.Work
                        Kind = 'rad-bink2'
                        Converter = $j.Converter
                    }
                    $j.State = 'completed'
                    Write-BridgeLog ("Bink 2 import "+$JobId+" completed · "+(Get-Item -LiteralPath $j.Output).Length+" bytes")
                }
            }
        }
        try { $p.Dispose() } catch {}
    }

    return Get-Bink2ImportJobStatus $JobId
}

function Cancel-Bink2ImportJob([string]$JobId) {
    if (-not $script:ImportJobs.ContainsKey($JobId)) {
        return [pscustomobject]@{ ok=$false; error='Unknown Bink 2 import job.' }
    }
    $j = $script:ImportJobs[$JobId]
    if ($j.State -ne 'importing') { return [pscustomobject]@{ ok=$true; state=$j.State; jobId=$JobId } }
    $j.Cancelled = $true
    try {
        if (-not $j.Started.Process.HasExited) { $j.Started.Process.Kill() }
    } catch {}
    return [pscustomobject]@{ ok=$true; state='cancelling'; jobId=$JobId }
}

function Get-SelectedPath([string]$Role) {
    if ($Role -eq 'video' -and $script:VideoImport -and
        $script:VideoImport.Source -eq (Get-OriginalVideoPath) -and
        (Test-Path -LiteralPath $script:VideoImport.Path -PathType Leaf)) {
        return [string]$script:VideoImport.Path
    }
    $items = @($script:Selections[$Role])
    if (-not $items.Count) { return $null }
    return [string]$items[0]
}

function Show-NativeOpenFileDialog([string]$Filter, [bool]$Multiselect = $false) {
    # The hidden Bridge process still needs a real on-screen owner for modal
    # dialogs. An owner placed at (-32000,-32000) can cause OpenFileDialog to
    # inherit an off-screen location, which looks like the picker never opened.
    # Anchor the tiny owner to the monitor under the cursor instead.
    $cursor = [System.Windows.Forms.Cursor]::Position
    $screen = [System.Windows.Forms.Screen]::FromPoint($cursor)
    $work = $screen.WorkingArea
    $x = [Math]::Max($work.Left, [Math]::Min($cursor.X, $work.Right - 1))
    $y = [Math]::Max($work.Top, [Math]::Min($cursor.Y, $work.Bottom - 1))

    $owner = New-Object System.Windows.Forms.Form
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'Manual'
    $owner.Location = New-Object System.Drawing.Point($x, $y)
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $owner.TopMost = $true
    $owner.Opacity = 0.01

    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = $Filter
    $dialog.Multiselect = $Multiselect
    $dialog.CheckFileExists = $true
    $dialog.RestoreDirectory = $true
    try {
        $owner.Show()
        $owner.Activate()
        $owner.BringToFront()
        $result = $dialog.ShowDialog($owner)
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            return @($dialog.FileNames)
        }
        return @()
    } finally {
        $dialog.Dispose()
        $owner.Close()
        $owner.Dispose()
    }
}


function Show-NativeSaveFileDialog([string]$Filter, [string]$DefaultExt, [string]$FileName) {
    if($script:CiSaveDirectory){
        # Only CI's explicit launch-time authorization can reach here.
        # Never turn this into an API that accepts arbitrary browser paths.
        $safe=[IO.Path]::GetFileName($FileName)
        if(-not $safe -or $safe -ne $FileName -or
           [IO.Path]::GetExtension($safe).ToLowerInvariant() -ne ('.'+$DefaultExt).ToLowerInvariant()){
            throw 'CI export requires an ordinary, correctly extended output filename.'
        }
        return (Join-Path $script:CiSaveDirectory $safe)
    }
    # The Bridge runs hidden. An unowned SaveFileDialog can be placed behind the
    # browser or off-screen after the first modal dialog, leaving the HTTP
    # request blocked and making a later export look frozen. Give every save
    # dialog a short-lived, on-screen owner on the active cursor monitor.
    $cursor = [System.Windows.Forms.Cursor]::Position
    $screen = [System.Windows.Forms.Screen]::FromPoint($cursor)
    $work = $screen.WorkingArea
    $x = [Math]::Max($work.Left, [Math]::Min($cursor.X, $work.Right - 1))
    $y = [Math]::Max($work.Top, [Math]::Min($cursor.Y, $work.Bottom - 1))

    $owner = New-Object System.Windows.Forms.Form
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'Manual'
    $owner.Location = New-Object System.Drawing.Point($x, $y)
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $owner.TopMost = $true
    $owner.Opacity = 0.01

    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter = $Filter
    $dialog.DefaultExt = $DefaultExt
    $dialog.FileName = $FileName
    $dialog.RestoreDirectory = $true
    $dialog.AddExtension = $true
    $dialog.OverwritePrompt = $true
    $dialog.CheckPathExists = $true
    try {
        $owner.Show()
        $owner.Activate()
        $owner.BringToFront()
        $result = $dialog.ShowDialog($owner)
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            return [string]$dialog.FileName
        }
        return ''
    } finally {
        $dialog.Dispose()
        $owner.Close()
        $owner.Dispose()
    }
}

# B21: system-authorized file paths never leave the native Bridge.
function Register-BridgeBatchVideos([string[]]$Paths) {
    if($Paths.Count -lt 1 -or $Paths.Count -gt 8) {
        throw 'Native source batch requires 1-8 files.'
    }
    $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $registry=@{}
    $entries=@()
    foreach($path in $Paths) {
        $full=[IO.Path]::GetFullPath($path)
        if(-not $seen.Add($full)){throw 'Native batch source selected more than once.'}
        $item=Get-Item -LiteralPath $full -ErrorAction Stop
        if($item.PSIsContainer -or [long]$item.Length -le 0){
            throw 'Native batch source must be a non-empty file.'
        }
        $id=[guid]::NewGuid().ToString('N')
        $info=[pscustomobject]@{
            id=$id;name=[string]$item.Name;size=[long]$item.Length
            lastModified=([DateTimeOffset]$item.LastWriteTimeUtc).ToUnixTimeMilliseconds()
        }
        $registry[$id]=[pscustomobject]@{
            path=$full;size=[long]$item.Length
            writeTicks=[long]$item.LastWriteTimeUtc.Ticks;info=$info
        }
        $entries+=,$info
    }
    # Only after every candidate passes: old grants expire.
    $script:BatchVideoSelections=$registry
    return [pscustomobject]@{ok=$true;cancelled=$false;files=[object[]]$entries}
}
function Select-BridgeBatchVideos {
    if(Test-Bink2ImportBusy){throw 'Bink 2 import is currently running.'}
    foreach($job in @($script:Jobs.Values)) {
        if($job.State -in @('encoding','verifying','cancelling')){
            throw 'Finish the current Native job before selecting another source batch.'
        }
    }
    if($script:CiBatchPickerResult){return $script:CiBatchPickerResult}
    $picked=@(Show-NativeOpenFileDialog 'Video files|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.ts;*.m2ts|All files|*.*' $true)
    if(-not $picked.Count){return [pscustomobject]@{ok=$true;cancelled=$true;files=@()}}
    return Register-BridgeBatchVideos $picked
}
function Activate-BridgeBatchVideo([string]$Id) {
    if($Id -notmatch '^[a-fA-F0-9]{32}$' -or
       -not $script:BatchVideoSelections.ContainsKey($Id)){
        throw 'Unknown or expired Native source authorization.'
    }
    if(Test-Bink2ImportBusy){throw 'Cannot switch source during Bink 2 import.'}
    foreach($job in @($script:Jobs.Values)) {
        if($job.State -in @('encoding','verifying','cancelling')){
            throw 'Cannot switch source while Native job is active.'
        }
    }
    $row=$script:BatchVideoSelections[$Id]
    $item=Get-Item -LiteralPath $row.path -ErrorAction Stop
    if($item.PSIsContainer -or [long]$item.Length -ne [long]$row.size -or
       [long]$item.LastWriteTimeUtc.Ticks -ne [long]$row.writeTicks){
        throw 'Authorized batch source changed; choose files again.'
    }
    Clear-Bink2ImportStaging
    Clear-BridgeEmbeddedAss
    $script:Selections.video=@([string]$row.path)
    $script:Selections.ass=@()
    $script:Selections.fonts=@()
    $probe=Get-ProbeMedia
    return [pscustomobject]@{ok=$true;id=$Id;file=$row.info;probe=$probe}
}

function Show-BridgePicker([string]$Role) {
    $picked = @()
    if ($Role -eq 'video') {
        if (Test-Bink2ImportBusy) { throw 'Bink 2 import is running; cancel or wait before replacing the video.' }
        $picked = @(Show-NativeOpenFileDialog 'Video files|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.ts;*.m2ts;*.bik;*.bk2|Bink video|*.bik;*.bk2|All files|*.*')
        if ($picked.Count) {
            Clear-Bink2ImportStaging
            Clear-BridgeEmbeddedAss
            $script:Selections.video = @($picked[0])
        }
    } elseif ($Role -eq 'ass') {
        $picked = @(Show-NativeOpenFileDialog 'ASS subtitles|*.ass|All files|*.*')
        if ($picked.Count) { Clear-BridgeEmbeddedAss; $script:Selections.ass = @($picked[0]) }
    } elseif ($Role -eq 'fonts') {
        $picked = @(Show-NativeOpenFileDialog 'Font files|*.ttf;*.otf;*.ttc;*.otc|All files|*.*' $true)
        if ($picked.Count) { $script:Selections.fonts = @($picked) }
    } else {
        throw 'Unsupported picker role.'
    }

    if (-not $picked.Count) {
        return [pscustomobject]@{ role=$Role; count=0; names=@(); files=@(); ok=$true; cancelled=$true }
    }

    $paths = @($script:Selections[$Role])
    $names = @()
    $files = @()
    foreach ($path in $paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $item = Get-Item -LiteralPath $path
        $names += $item.Name
        $entry = [ordered]@{ name=$item.Name; size=$item.Length }
        if($Role -eq 'video'){$entry.lastModified=([DateTimeOffset]$item.LastWriteTimeUtc).ToUnixTimeMilliseconds()}
        if ($Role -in @('ass','fonts')) {
            if ($item.Length -gt 32MB) { throw "$Role file exceeds 32 MB bridge safety limit." }
            $entry.base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
        }
        $files += [pscustomobject]$entry
    }
    return [pscustomobject]@{ role=$Role; count=$files.Count; names=$names; files=$files; ok=$true }
}

function Get-BackendInfo {
    # Capability discovery happens at bridge startup, but Windows GPU inventory
    # can be transiently unavailable during login/driver initialization. Retry
    # the real model-name lookup before exposing a generic NVENC-only label.
    if ($script:Capabilities) {
        $currentGpuNames = @($script:Capabilities.Gpus |
            Where-Object { $_ -and $_ -ne 'NVIDIA GPU · NVENC runtime available' })
        if (-not $currentGpuNames.Count) {
            try {
                $refreshedGpuNames = @(Get-WindowsGpuNames $PSScriptRoot)
                if ($refreshedGpuNames.Count) {
                    $script:Capabilities.Gpus = @($refreshedGpuNames)
                }
            } catch {}
        }
    }

    $available = [bool]($script:Ffmpeg -and $script:Ffprobe -and $script:Capabilities)

    # Do not build array-valued JSON properties through an inline PowerShell
    # if-expression. Pipeline unrolling can collapse a one-item array (the
    # normal single-GPU case) into a scalar string, which the web client then
    # rejects with Array.isArray(...). Keep explicit array variables instead.
    $gpuList = @()
    $encoderList = @()
    if ($script:Capabilities) {
        $gpuList = @($script:Capabilities.Gpus)
        $encoderList = @($script:Capabilities.Encoders)
    }

    return [pscustomobject]@{
        available=$available
        backend='windows-native'
        platform='windows'
        # Diagnostic capability only: no save path is exposed or accepted over HTTP.
        # Enabled only for a runner with a restricted, preauthorized CI save root.
        ciSaveChooserActive=[bool]($env:GITHUB_ACTIONS -eq 'true' -and $script:CiSaveDirectory)
        cpu=if($script:Capabilities){$script:Capabilities.Cpu}else{$env:PROCESSOR_IDENTIFIER}
        gpus=[object[]]$gpuList
        ffmpeg=$script:Ffmpeg
        ffprobe=$script:Ffprobe
        ffmpegVersion=if($script:Capabilities){$script:Capabilities.FfmpegVersion}else{$null}
        ffmpegSource=if($script:Capabilities){$script:Capabilities.FfmpegSource}else{$null}
        ffmpegWarnings=if($script:Capabilities){[object[]]$script:Capabilities.FfmpegWarnings}else{[object[]]@()}
        multipassSupported=if($script:Capabilities){[bool]$script:Capabilities.MultipassSupported}else{$false}
        multipassFullresSupported=if($script:Capabilities){[bool]$script:Capabilities.MultipassFullresSupported}else{$false}
        hasAss=if($script:Capabilities){[bool]$script:Capabilities.HasAss}else{$false}
        encoders=[object[]]$encoderList
        bridgeVersion=6
        taskSchemaVersion=4
        fpsModeSupported=[bool]$script:Capabilities.FpsModeSupported
        globalOptions=[object[]]$script:Capabilities.GlobalOptions
        bink2ImportAvailable=[bool]$script:RadVideo
        bink2ImportTool=if($script:RadVideo){[string]$script:RadVideo.Label}else{''}
        bink2ImportToolSource=if($script:RadVideo){[string]$script:RadVideo.Source}else{''}
        bink2ImportExternal=$true
    }
}

function Get-PreferredEncoder([string]$Codec) {
    if (-not $script:Capabilities) { return $null }
    $hardwareKey = if($Codec -eq 'h264'){'h264_nvenc'}elseif($Codec -eq 'h265'){'hevc_nvenc'}elseif($Codec -eq 'av1'){'av1_nvenc'}else{''}
    $softwareKey = if($Codec -eq 'h264'){'libx264'}elseif($Codec -eq 'h265'){'libx265'}elseif($Codec -eq 'av1'){'libsvtav1'}else{''}
    $hardware = @($script:Capabilities.Encoders | Where-Object { $_.Key -eq $hardwareKey -and $_.Available }) | Select-Object -First 1
    if ($hardware) { return $hardware }
    return @($script:Capabilities.Encoders | Where-Object { $_.Key -eq $softwareKey -and $_.Available }) | Select-Object -First 1
}

function Get-BridgeEncoderArgs($Profile, $Options) {
    if (-not $Profile) { throw 'No available encoder for this codec.' }
    $targetRate = [long]($Options.targetVideoBitrate)
    if ([bool]$Options.sampleExact -and [bool]$Options.guidedRenderedReference) {
        # Match the CURRENT production Guided VBR encoder args exactly. In
        # particular hardware Guided uses p7+tune+maxrate/bufsize, unlike the
        # no-subtitle Manual exact VBR profile. Never substitute that profile.
        if($targetRate -le 0){throw 'Guided exact sample needs positive VBR bitrate.'}
        if($Profile.Hardware){
            $tune=if($Profile.Tune){$Profile.Tune}else{'hq'}
            return "-c:v $($Profile.Encoder) -preset p7 -tune $tune -rc vbr -b:v $targetRate -maxrate $targetRate -bufsize $($targetRate * 2)"
        }
        $preset=[string]$Options.preset
        if(-not $preset){$preset=[string]$Profile.SoftwarePreset}
        return "-c:v $($Profile.Encoder) -preset $preset -b:v $targetRate"
    }
    if ([bool]$Options.sampleExact) {
        # Exact samples may verify either the measured CQ mode or the
        # final bitrate/VBR mode, with the same selected encoder and preset.
        $quality = [int]$Options.crf
        $preset = [string]$Options.preset
        if ($targetRate -le 0 -and ($quality -lt 0 -or $quality -gt 63)) { throw 'Invalid exact sample quality.' }
        if ($Profile.Hardware) {
            if ($preset -notmatch '^p[1-7]$') { throw 'Invalid exact NVENC preset.' }
            $mp = [string]$Options.multipass
            if ($mp -notin @('disabled','fullres')) { throw 'Unsupported exact sample multipass mode.' }
            if ($mp -eq 'fullres' -and -not $Profile.SupportsMultipassFullres) {
                throw 'Requested NVENC fullres multipass is unavailable.'
            }
            $mpArg = if ($Profile.SupportsMultipass) { ' -multipass ' + $mp } else { '' }
            # Mirror default production NVENC flags: no implicit hq tune;
            # no maxrate, bufsize, or quality model substitution.
            if ($targetRate -gt 0) {
                return "-c:v $($Profile.Encoder) -preset $preset -rc vbr -b:v $targetRate$mpArg -spatial-aq 0 -temporal-aq 0"
            }
            return "-c:v $($Profile.Encoder) -preset $preset -rc vbr -cq $quality -b:v 0$mpArg -spatial-aq 0 -temporal-aq 0"
        }
        if (-not $preset) { throw 'Missing exact software encoder preset.' }
        if ($targetRate -gt 0) { return "-c:v $($Profile.Encoder) -preset $preset -b:v $targetRate" }
        return "-c:v $($Profile.Encoder) -preset $preset -crf $quality"
    }
    if ($Profile.Hardware) {
        $cq = [int]($Options.crf)
        if ($cq -lt 0) { $cq = [int]$Profile.Quality }
        $tune = if ($Profile.Tune) { $Profile.Tune } else { 'hq' }
        if ($targetRate -gt 0) {
            return "-c:v $($Profile.Encoder) -preset p7 -tune $tune -rc vbr -b:v $targetRate -maxrate $targetRate -bufsize $($targetRate * 2)"
        }
        $multipass = if ($Profile.SupportsMultipassFullres) { ' -multipass fullres' } else { '' }
        $samplePreset = [string]$Options.preset
        if ($samplePreset -and $samplePreset -notmatch '^p[1-7]$') { throw 'Invalid NVENC sample preset.' }
        if (-not $samplePreset) { $samplePreset = 'p7' }
        return "-c:v $($Profile.Encoder) -preset $samplePreset -tune $tune -rc vbr -cq $cq -b:v 0$multipass"
    }

    $preset = [string]$Options.preset
    if (-not $preset) { $preset = [string]$Profile.SoftwarePreset }
    if ($targetRate -gt 0) {
        return "-c:v $($Profile.Encoder) -preset $preset -b:v $targetRate"
    }
    $crf = [int]($Options.crf)
    if ($crf -lt 0) { $crf = [int]$Profile.Quality }
    return "-c:v $($Profile.Encoder) -preset $preset -crf $crf"
}

function Get-ProbeMedia {
    $original = Get-OriginalVideoPath
    $video = Get-SelectedPath 'video'
    if (-not $original -or -not $video) { throw 'No video selected.' }

    $adapter = Get-Bink2ImportAdapterInfo
    $adapterApplied = [bool]($adapter.applied -and $video -ne $original)
    $sourceItem = Get-Item -LiteralPath $original
    $executionItem = Get-Item -LiteralPath $video

    $r = Invoke-BridgeTool $script:Ffprobe ('-v error -show_format -show_streams -of json ' + (Quote-NativeArg $video))
    if ($r.ExitCode -ne 0) {
        if ($adapter.isBink2 -and -not $adapterApplied) {
            return [pscustomobject]@{
                ok=$true; seekable=$true
                statSize=$sourceItem.Length; executionStatSize=$sourceItem.Length
                inputDecodeSmoke=$false; inputDecodeDeferred=$false; inputDecodeError=$r.StdErr.Trim()
                format='bink'; duration=0; bitRate=0
                videoTracks=0; videoStreams=@(); videoCodec='bink2'; videoBitRate=0
                width=0; height=0; fps='0/1'; pixelFormat=''; bitDepth=8
                colorTransfer=''; colorPrimaries=''; colorSpace=''; hdr=$false; unsafeColorPipeline=$false
                audioTracks=0; audioStreams=@(); audioCodec=''; audioCodecs=@(); audioBitRate=0
                sourceAdapter='rad-bink2'; sourceAdapterRequired=$true
                sourceAdapterAvailable=[bool]$adapter.available; sourceAdapterApplied=$false
                sourceAdapterTool=[string]$adapter.tool
                sourceOriginalName=$sourceItem.Name; sourceOriginalSize=$sourceItem.Length; sourceOriginalKind='bink2'
            }
        }
        throw ($r.StdErr.Trim())
    }

    $json = $r.StdOut | ConvertFrom-Json
    $videos = @($json.streams | Where-Object { $_.codec_type -eq 'video' })
    if (-not $videos.Count) {
        if ($adapter.isBink2 -and -not $adapterApplied) {
            $fallbackDuration = 0.0
            [void][double]::TryParse([string]$json.format.duration,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$fallbackDuration)
            return [pscustomobject]@{
                ok=$true; seekable=$true
                statSize=$sourceItem.Length; executionStatSize=$sourceItem.Length
                inputDecodeSmoke=$false; inputDecodeDeferred=$false; inputDecodeError='FFprobe found no decodable video stream.'
                format=[string]$json.format.format_name; duration=$fallbackDuration; bitRate=0
                videoTracks=0; videoStreams=@(); videoCodec='bink2'; videoBitRate=0
                width=0; height=0; fps='0/1'; pixelFormat=''; bitDepth=8
                colorTransfer=''; colorPrimaries=''; colorSpace=''; hdr=$false; unsafeColorPipeline=$false
                audioTracks=0; audioStreams=@(); audioCodec=''; audioCodecs=@(); audioBitRate=0
                sourceAdapter='rad-bink2'; sourceAdapterRequired=$true
                sourceAdapterAvailable=[bool]$adapter.available; sourceAdapterApplied=$false
                sourceAdapterTool=[string]$adapter.tool
                sourceOriginalName=$sourceItem.Name; sourceOriginalSize=$sourceItem.Length; sourceOriginalKind='bink2'
            }
        }
        throw 'FFprobe found no video stream.'
    }

    $audios = @($json.streams | Where-Object { $_.codec_type -eq 'audio' })
    $videoFacts = @()
    for($i=0;$i -lt $videos.Count;$i++){
        $stream=$videos[$i]
        $streamPix=[string]$stream.pix_fmt
        $streamDepth=if($stream.bits_per_raw_sample -as [int]){[int]$stream.bits_per_raw_sample}elseif($streamPix -match '(10|12|14|16)(?:le|be)?'){[int]$Matches[1]}else{8}
        $streamTransfer=[string]$stream.color_transfer
        $streamPrimaries=[string]$stream.color_primaries
        $streamHdr=($streamTransfer -match 'smpte2084|arib-std-b67') -or (($streamPrimaries -match 'bt2020') -and $streamDepth -gt 8)
        $videoFacts += [pscustomobject]@{
            ordinal=$i; index=if($null -ne $stream.index){[int]$stream.index}else{$i}
            codec=[string]$stream.codec_name
            bitRate=if($adapterApplied){0L}elseif($stream.bit_rate){[long]$stream.bit_rate}else{0L}
            width=[int]$stream.width; height=[int]$stream.height; fps=[string]$stream.avg_frame_rate
            sar=[string]$stream.sample_aspect_ratio
            pixelFormat=$streamPix; bitDepth=$streamDepth; colorTransfer=$streamTransfer
            colorPrimaries=$streamPrimaries; colorSpace=[string]$stream.color_space
            hdr=$streamHdr; unsafeColorPipeline=($streamHdr -or $streamDepth -gt 8)
        }
    }
    $audioFacts=@()
    for($i=0;$i -lt $audios.Count;$i++){
        $stream=$audios[$i]
        $audioFacts += [pscustomobject]@{
            ordinal=$i; index=if($null -ne $stream.index){[int]$stream.index}else{$i}
            codec=[string]$stream.codec_name
            bitRate=if($adapterApplied){0L}elseif($stream.bit_rate){[long]$stream.bit_rate}else{0L}
            language=[string]$stream.tags.language;title=[string]$stream.tags.title
            channels=if($stream.channels){[int]$stream.channels}else{0}
            sampleRate=if($stream.sample_rate){[int]$stream.sample_rate}else{0}
        }
    }

    $v=$videoFacts[0]
    $duration = 0.0
    [void][double]::TryParse([string]$json.format.duration,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$duration)
    $decode = Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -loglevel error -ss 0 -i ' + (Quote-NativeArg $video) + ' -map 0:v:0 -frames:v 1 -f null NUL')
    $decodeOk = $decode.ExitCode -eq 0
    $audioRate = 0L
    if(-not $adapterApplied){foreach($a in $audios){if($a.bit_rate){$audioRate += [long]$a.bit_rate}}}
    $planningRate = if($adapterApplied){0L}elseif($json.format.bit_rate){[long]$json.format.bit_rate}else{0L}

    return [pscustomobject]@{
        ok=$true; seekable=$true
        statSize=$sourceItem.Length; executionStatSize=$executionItem.Length
        inputDecodeSmoke=$decodeOk; inputDecodeDeferred=$false; inputDecodeError=$decode.StdErr.Trim()
        format=[string]$json.format.format_name; duration=$duration; bitRate=$planningRate
        videoTracks=$videoFacts.Count; videoStreams=$videoFacts
        videoCodec=[string]$v.codec; videoBitRate=[long]$v.bitRate
        width=[int]$v.width; height=[int]$v.height; fps=[string]$v.fps
        pixelFormat=[string]$v.pixelFormat; bitDepth=[int]$v.bitDepth
        colorTransfer=[string]$v.colorTransfer; colorPrimaries=[string]$v.colorPrimaries
        colorSpace=[string]$v.colorSpace; hdr=[bool]$v.hdr; unsafeColorPipeline=[bool]$v.unsafeColorPipeline
        subtitleTracks=@($json.streams | Where-Object {$_.codec_type -eq 'subtitle'}).Count
        subtitleStreams=@($json.streams | Where-Object {$_.codec_type -eq 'subtitle'})
        attachmentTracks=@($json.streams | Where-Object {$_.codec_type -eq 'attachment'}).Count
        attachmentStreams=@($json.streams | Where-Object {$_.codec_type -eq 'attachment'})
        audioTracks=$audios.Count; audioStreams=$audioFacts
        audioCodec=if($audios.Count){[string]$audios[0].codec_name}else{''}
        audioCodecs=@($audios | ForEach-Object { [string]$_.codec_name }); audioBitRate=$audioRate
        sourceAdapter=if($adapter.isBink2){'rad-bink2'}else{''}
        sourceAdapterRequired=[bool]($adapter.isBink2 -and -not $adapterApplied -and -not $decodeOk)
        sourceAdapterAvailable=[bool]$adapter.available
        sourceAdapterApplied=$adapterApplied
        sourceAdapterTool=[string]$adapter.tool
        sourceOriginalName=$sourceItem.Name
        sourceOriginalSize=$sourceItem.Length
        sourceOriginalKind=if($adapter.isBink2){'bink2'}else{'native'}
    }
}

# Stream packets with constant memory; stop on deadline/packet count instead of
# retaining millions of JSON packet objects. Evidence describes full-source only.
function Measure-AuxiliaryPackets([string]$Video,[string]$Kind) {
    $p=New-Object Diagnostics.Process
    $p.StartInfo.FileName=$script:Ffprobe
    $p.StartInfo.Arguments='-v error -select_streams '+$Kind+' -show_packets -show_entries packet=stream_index,size -of csv=p=0 '+(Quote-NativeArg $Video)
    $p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true
    $p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true
    $clock=[Diagnostics.Stopwatch]::StartNew();$totals=@{};$count=0
    try{
        [void]$p.Start();$stderr=$p.StandardError.ReadToEndAsync()
        while($true){
            $lineTask=$p.StandardOutput.ReadLineAsync()
            while(-not $lineTask.Wait(100)){if($clock.Elapsed.TotalSeconds -gt 30){throw 'Source cost scan timed out; costs remain unknown.'}}
            if($clock.Elapsed.TotalSeconds -gt 30){throw 'Source cost scan timed out; costs remain unknown.'}
            $line=$lineTask.Result;if($null -eq $line){break}
            if(++$count -gt 2000000){throw 'Source packet scan exceeds bounded work limit.'}
            if($line -notmatch '^(\d+),(\d+)(?:,.*)?$'){throw 'Malformed packet cost; costs remain unknown.'}
            $index=[int]$Matches[1];$bytes=[long]$Matches[2]
            if(-not $totals.ContainsKey($index)){$totals[$index]=0L}
            $totals[$index]+=$bytes
        }
        if(-not $p.WaitForExit(1000) -or $p.ExitCode -ne 0){throw 'Source packet scan failed.'}
        return $totals
    }finally{try{if(-not $p.HasExited){$p.Kill();$p.WaitForExit()}}catch{};$p.Dispose()}
}
function Get-SourceBudgetEvidence {
    $video=Get-SelectedPath 'video';if(-not $video){throw 'No video selected.'}
    foreach($j in $script:Jobs.Values){if($j.State -in @('encoding','validating')){throw 'Cannot scan costs while a job is active.'}}
    $before=Get-Item -LiteralPath $video
    $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -show_streams -show_entries stream=index,codec_type,extradata_size -of json '+(Quote-NativeArg $video)) '' 10
    if($probe.ExitCode -ne 0){throw 'Source stream scan failed.'}
    $streams=@(($probe.StdOut | ConvertFrom-Json).streams)
    if($streams.Count -gt 64){throw 'Source stream count exceeds measurement limit.'}
    $audio=Measure-AuxiliaryPackets $video 'a';$sub=Measure-AuxiliaryPackets $video 's'
    $after=Get-Item -LiteralPath $video
    if($after.Length -ne $before.Length -or $after.LastWriteTimeUtc.Ticks -ne $before.LastWriteTimeUtc.Ticks){throw 'Source changed while measuring; costs remain unknown.'}
    $audioCosts=@($streams | Where-Object {$_.codec_type -eq 'audio'} | ForEach-Object {if($audio.ContainsKey([int]$_.index)){$audio[[int]$_.index]}else{$null}})
    $script:BudgetMeasurement=[pscustomobject]@{Id=[guid]::NewGuid().ToString('N');Path=$video;Length=$after.Length;WriteTicks=$after.LastWriteTimeUtc.Ticks;AudioPacketBytes=$audioCosts}
    return [pscustomobject]@{
        measurementId=$script:BudgetMeasurement.Id
        version=1;scope='full-source'
        audioPacketBytes=$audioCosts
        subtitlePacketBytes=@($streams | Where-Object {$_.codec_type -eq 'subtitle'} | ForEach-Object {if($sub.ContainsKey([int]$_.index)){$sub[[int]$_.index]}else{$null}})
        attachmentBytes=@($streams | Where-Object {$_.codec_type -eq 'attachment'} | ForEach-Object {if($null -ne $_.extradata_size){[long]$_.extradata_size}else{$null}})
    }
}

function Get-SelfTest {
    $enc = @($script:Capabilities.Encoders)
    $filters = if($script:Ffmpeg){(Invoke-BridgeTool $script:Ffmpeg '-hide_banner -filters').StdOut}else{''}
    $decoders = if($script:Ffmpeg){(Invoke-BridgeTool $script:Ffmpeg '-hide_banner -decoders').StdOut}else{''}
    return [pscustomobject]@{
        ok=$true
        x264EncodeSmoke=[bool](@($enc | Where-Object { $_.Key -in @('h264_nvenc','libx264') -and $_.Available }).Count)
        x265EncodeSmoke=[bool](@($enc | Where-Object { $_.Key -in @('hevc_nvenc','libx265') -and $_.Available }).Count)
        svtAv1EncodeSmoke=[bool](@($enc | Where-Object { $_.Key -in @('av1_nvenc','libsvtav1') -and $_.Available }).Count)
        dav1d=($decoders -match '(?im)\b(av1|libdav1d)\b')
        libassVisualSmoke=[bool]$script:Capabilities.HasAss
        ssimSmoke=($filters -match '(?im)\bssim\b')
        bundledFallbackReady=$true
        ffprobeSmoke=[bool]$script:Ffprobe
        encoders=$enc
    }
}


function Get-LibassFontEvents([string]$Text) {
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($line in ($Text -split '\r?\n')) {
        if ($line -match '(?i)fontselect:|Glyph .* not found|failed to find.*fallback|font provider') {
            $clean = $line -replace '^.*?(?=(?i:fontselect:|Glyph |failed to find|font provider))',''
            if ($clean.Trim()) { [void]$out.Add($clean.Trim()) }
        }
    }
    return @($out)
}

function Invoke-Preview($Body) {
    $video = Get-SelectedPath 'video'
    if (-not $video) { throw 'No video selected.' }
    $work = New-BridgeWorkDir 'quick-hardsub-preview-'
    try {
        Stage-BridgeAssets $work ([string]$Body.assText)
        $time = [double]$Body.timeSeconds
        $base = Join-Path $work 'base.png'
        $sub = Join-Path $work 'sub.png'
        $baseArgs = '-hide_banner -loglevel error -y -ss ' + $time.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture) +
            ' -i ' + (Quote-NativeArg $video) + ' -map 0:v:0 -an -sn -frames:v 1 -vf scale=1280:-2:force_original_aspect_ratio=decrease -c:v png ' + (Quote-NativeArg $base)
        $r1 = Invoke-BridgeTool $script:Ffmpeg $baseArgs $work
        if ($r1.ExitCode -ne 0 -or -not(Test-Path $base)) { throw ($r1.StdErr.Trim()) }
        $r2 = Invoke-BridgeTool $script:Ffmpeg '-hide_banner -loglevel info -y -loop 1 -framerate 10 -i base.png -vf "ass=subtitle.ass:fontsdir=fonts" -ss 0.500 -frames:v 1 -c:v png sub.png' $work
        if ($r2.ExitCode -ne 0 -or -not(Test-Path $sub)) { throw ($r2.StdErr.Trim()) }
        $baseBytes=[IO.File]::ReadAllBytes($base); $subBytes=[IO.File]::ReadAllBytes($sub)
        $sha = [Security.Cryptography.SHA256]::Create()
        $same = ([Convert]::ToBase64String($sha.ComputeHash($baseBytes)) -eq [Convert]::ToBase64String($sha.ComputeHash($subBytes)))
        $sha.Dispose()
        return [pscustomobject]@{
            requestId=[string]$Body.requestId; ok=$true
            url=('data:image/png;base64,'+[Convert]::ToBase64String($subBytes))
            baseUrl=('data:image/png;base64,'+[Convert]::ToBase64String($baseBytes))
            visualChange=(-not $same); time=$time
            fontEvents=@(Get-LibassFontEvents ($r2.StdErr+[Environment]::NewLine+$r2.StdOut))
        }
    } finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}

function Invoke-Frame($Body) {
    $video = Get-SelectedPath 'video'
    if (-not $video) { throw 'No video selected.' }
    $time = [Math]::Max(0.0, [double]$Body.timeSeconds)
    $width = [Math]::Max(320, [Math]::Min(1280, $(if($Body.width){[int]$Body.width}else{720})))
    $videoStream = [Math]::Max(0, [Math]::Min(63, $(if($null -ne $Body.videoStream){[int]$Body.videoStream}else{0})))
    $work = New-BridgeWorkDir 'quick-hardsub-frame-'
    try {
        $output = Join-Path $work 'frame.png'
        $timeText = $time.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $args = '-hide_banner -loglevel error -y -ss ' + $timeText +
            ' -i ' + (Quote-NativeArg $video) +
            ' -map 0:v:' + $videoStream + ' -an -sn -frames:v 1 -vf scale=' + $width + ':-2:force_original_aspect_ratio=decrease -c:v png ' +
            (Quote-NativeArg $output)
        $result = Invoke-BridgeTool $script:Ffmpeg $args $work
        if($result.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $output)){throw ($result.StdErr.Trim())}
        $bytes=[IO.File]::ReadAllBytes($output)
        if(-not $bytes.Length){throw 'Timeline frame output is empty.'}
        return [pscustomobject]@{
            requestId=[string]$Body.requestId; ok=$true
            url=('data:image/png;base64,'+[Convert]::ToBase64String($bytes))
            time=$time; width=$width
        }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-OutputFrame([string]$JobId,$Body) {
    if(-not $script:Jobs.ContainsKey($JobId)){throw 'Unknown job.'}
    $job=$script:Jobs[$JobId]
    $status=Get-JobStatus $JobId
    if(-not $status.ok -or $status.state -ne 'completed'){throw 'Verified output is not ready.'}
    if(-not(Test-Path -LiteralPath $job.Output)){throw 'Verified output staging file is missing.'}
    $time=[Math]::Max(0.0,[double]$Body.timeSeconds)
    $width=[Math]::Max(320,[Math]::Min(1600,$(if($Body.width){[int]$Body.width}else{960})))
    $work=New-BridgeWorkDir 'quick-hardsub-output-frame-'
    try {
        $output=Join-Path $work 'frame.png'
        $timeText=$time.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $args='-hide_banner -loglevel error -y -ss '+$timeText+
            ' -i '+(Quote-NativeArg $job.Output)+
            ' -map 0:v:0 -an -sn -frames:v 1 -vf scale='+$width+':-2:force_original_aspect_ratio=decrease -c:v png '+
            (Quote-NativeArg $output)
        $result=Invoke-BridgeTool $script:Ffmpeg $args $work
        if($result.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $output)){throw ($result.StdErr.Trim())}
        $bytes=[IO.File]::ReadAllBytes($output)
        if(-not $bytes.Length){throw 'Output verification frame is empty.'}
        return [pscustomobject]@{
            requestId=[string]$Body.requestId;ok=$true
            url=('data:image/png;base64,'+[Convert]::ToBase64String($bytes))
            time=$time;width=$width
        }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-HardsubReferenceFrame([string]$JobId,$Body) {
    if(-not $script:Jobs.ContainsKey($JobId)){throw 'Unknown job.'}
    $job=$script:Jobs[$JobId]
    $status=Get-JobStatus $JobId
    if(-not $status.ok -or $status.state -ne 'completed'){throw 'Verified output is not ready.'}
    if(-not $job.Task -or [string]$job.Task.operation -ne 'hardsub'){throw 'Reference frame requires a structured hardsub job.'}
    if(-not $job.Source -or -not(Test-Path -LiteralPath $job.Source)){throw 'Original source is unavailable for reference rendering.'}
    $ass=Join-Path $job.Work 'subtitle.ass'
    $fonts=Join-Path $job.Work 'fonts'
    if(-not(Test-Path -LiteralPath $ass)){throw 'Hardsub reference ASS is missing.'}

    $time=[Math]::Max(0.0,[double]$Body.timeSeconds)
    $width=[Math]::Max(320,[Math]::Min(1600,$(if($Body.width){[int]$Body.width}else{1200})))
    $argsList=@($job.Task.outputArgs)
    $vfIndex=[Array]::IndexOf($argsList,'-vf')
    if($vfIndex -lt 0 -or $vfIndex+1 -ge $argsList.Count){throw 'Hardsub task has no video filter chain.'}
    $parts=New-Object 'System.Collections.Generic.List[string]'
    $foundAss=$false
    $timeText=$time.ToString('0.######',[Globalization.CultureInfo]::InvariantCulture)
    foreach($raw in ([string]$argsList[$vfIndex+1]).Split(',')){
        $part=$raw.Trim()
        if($part -match '^setpts=PTS[+-]\d+(?:\.\d+)?/TB$'){continue}
        if($part -eq 'ass=__ASS__:fontsdir=__FONTS__'){
            $foundAss=$true
            $parts.Add('setpts=PTS-STARTPTS+'+$timeText+'/TB')
            $parts.Add('ass=subtitle.ass:fontsdir=fonts')
            $parts.Add('setpts=PTS-STARTPTS')
        }else{$parts.Add($part)}
    }
    if(-not $foundAss){throw 'Hardsub task filter chain has no authoritative ASS step.'}
    $parts.Add('scale='+$width+':-2:force_original_aspect_ratio=decrease')
    $filter=$parts -join ','

    $work=New-BridgeWorkDir 'quick-hardsub-reference-frame-'
    try {
        Copy-Item -LiteralPath $ass -Destination (Join-Path $work 'subtitle.ass') -Force
        if(Test-Path -LiteralPath $fonts){Copy-Item -LiteralPath $fonts -Destination (Join-Path $work 'fonts') -Recurse -Force}
        $output=Join-Path $work 'reference.png'
        $primaryVideo=if(@($job.Task.videoStreams).Count){[int]@($job.Task.videoStreams)[0]}elseif($null -ne $job.Task.videoStream){[int]$job.Task.videoStream}else{0}
        $cmd='-hide_banner -loglevel error -y -ss '+$timeText+
            ' -i '+(Quote-NativeArg $job.Source)+
            ' -map 0:v:'+$primaryVideo+' -an -sn -frames:v 1 -vf '+(Quote-NativeArg $filter)+' -c:v png '+(Quote-NativeArg $output)
        $run=Invoke-BridgeTool $script:Ffmpeg $cmd $work
        if($run.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $output)){throw ($run.StdErr.Trim())}
        $bytes=[IO.File]::ReadAllBytes($output)
        if(-not $bytes.Length){throw 'Hardsub reference frame is empty.'}
        return [pscustomobject]@{
            requestId=[string]$Body.requestId;ok=$true
            url=('data:image/png;base64,'+[Convert]::ToBase64String($bytes))
            time=$time;width=$width;referenceKind='hardsub-authoritative'
        }
    } finally {Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
}

function Invoke-Waveform($Body) {
    $video = Get-SelectedPath 'video'
    if (-not $video) { throw 'No video selected.' }
    $requestId = [string]$Body.requestId
    $audioTrack = if ($null -ne $Body.audioTrack) { [int]$Body.audioTrack } else { 0 }
    if ($audioTrack -lt 0 -or $audioTrack -gt 63) { throw 'Audio track index out of range.' }
    $videoStream = if ($null -ne $Body.videoStream) { [int]$Body.videoStream } else { 0 }
    if ($videoStream -lt 0 -or $videoStream -gt 63) { throw 'Video stream index out of range.' }
    $width = [Math]::Max(512, [Math]::Min(4096, $(if($Body.width){[int]$Body.width}else{2048})))
    $height = [Math]::Max(96, [Math]::Min(320, $(if($Body.height){[int]$Body.height}else{160})))
    $duration = if($Body.duration){[double]$Body.duration}else{0.0}
    $includeKeyframes = [bool]$Body.includeKeyframes
    $maxKeyframes = [Math]::Max(256,[Math]::Min(50000,$(if($Body.maxKeyframes){[int]$Body.maxKeyframes}else{12000})))
    $keyframes = New-Object System.Collections.Generic.List[double]
    $keyframesTruncated = $false

    if($includeKeyframes){
        $probe = Invoke-BridgeTool $script:Ffprobe (
            '-v error -select_streams v:'+$videoStream+' -skip_frame nokey -show_frames ' +
            '-show_entries frame=best_effort_timestamp_time -of csv=p=0 ' +
            (Quote-NativeArg $video)
        )
        if($probe.ExitCode -ne 0){throw 'Keyframe timeline scan failed.'}
        foreach($line in ($probe.StdOut -split "\r?\n")){
            $time=0.0
            if([double]::TryParse(($line.Split(',')[0]),[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$time) -and $time -ge 0){
                if($duration -le 0 -or $time -le $duration + 0.001){
                    if($keyframes.Count -lt $maxKeyframes){[void]$keyframes.Add($time)}
                    else{$keyframesTruncated=$true;break}
                }
            }
        }
    }

    $work = New-BridgeWorkDir 'quick-hardsub-waveform-'
    try {
        $output = Join-Path $work 'waveform.png'
        $filter = "aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:split_channels=0"
        $args = '-hide_banner -loglevel error -y -i ' + (Quote-NativeArg $video) +
            ' -map 0:a:' + $audioTrack + ' -vn -sn -filter_complex ' + (Quote-NativeArg $filter) +
            ' -frames:v 1 -c:v png ' + (Quote-NativeArg $output)
        $result = Invoke-BridgeTool $script:Ffmpeg $args $work
        $waveformError = ''
        $url = ''
        if ($result.ExitCode -eq 0 -and (Test-Path -LiteralPath $output)) {
            $bytes = [IO.File]::ReadAllBytes($output)
            if($bytes.Length){$url='data:image/png;base64,'+[Convert]::ToBase64String($bytes)}
            else{$waveformError='Waveform output is empty.'}
        } else {
            $waveformError = $result.StdErr.Trim()
            if(-not $waveformError){$waveformError='FFmpeg waveform generation failed.'}
        }
        if(-not $url -and -not $includeKeyframes){throw $waveformError}
        return [pscustomobject]@{
            requestId=$requestId; ok=$true
            url=$url; waveformError=$waveformError
            duration=$duration; width=$width; height=$height; audioTrack=$audioTrack
            keyframes=@($keyframes); keyframesTruncated=$keyframesTruncated
        }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
function Get-Ssim([string]$Candidate,[string]$Reference,[string]$Work,[int]$ReferenceWidth=0,[int]$ReferenceHeight=0) {
    # Downscaled candidates are always bicubic-upsampled to the same original
    # full-resolution, subtitle-rendered reference before SSIM is measured.
    $filter=if($ReferenceWidth -gt 0 -and $ReferenceHeight -gt 0){
        '[0:v]scale='+$ReferenceWidth+':'+$ReferenceHeight+':flags=bicubic,setpts=PTS-STARTPTS[up];[1:v]setpts=PTS-STARTPTS[ref];[up][ref]ssim'
    }else{'[0:v][1:v]ssim'}
    $r=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -nostdin -i '+(Quote-NativeArg $Candidate)+' -i '+(Quote-NativeArg $Reference)+' -lavfi "'+$filter+'" -f null NUL') $Work
    $m=[regex]::Match(($r.StdErr+[Environment]::NewLine+$r.StdOut),'All:(?<v>[0-9.]+)')
    if($m.Success){return [double]::Parse($m.Groups['v'].Value,[Globalization.CultureInfo]::InvariantCulture)}
    return $null
}

function Get-SsimAgainstSource([string]$Candidate,[string]$Source,[string]$Start,[string]$Duration,[string]$Work,[int]$ReferenceWidth=0,[int]$ReferenceHeight=0) {
    # Only for the validated, filter-free video-transcode calibration path.
    # Decode the source directly: no multi-GB FFV1 reference written to disk.
    # Independent seek windows reset PTS before same-frame SSIM comparison.
    $up=if($ReferenceWidth -gt 0){'scale='+$ReferenceWidth+':'+$ReferenceHeight+':flags=bicubic,'}else{''}
    $cmd='-hide_banner -nostdin -loglevel info -i '+(Quote-NativeArg $Candidate)+
      ' -ss '+$Start+' -t '+$Duration+' -i '+(Quote-NativeArg $Source)+
      ' -filter_complex "[0:v]'+$up+'setpts=PTS-STARTPTS[encoded];[1:v]format=yuv420p,setpts=PTS-STARTPTS[reference];[encoded][reference]ssim" -an -sn -f null NUL'
    $r=Invoke-BridgeTool $script:Ffmpeg $cmd $Work
    if($r.ExitCode -ne 0){throw 'Source-backed SSIM failed: '+$r.StdErr.Trim()}
    $match=[regex]::Match(($r.StdErr+[Environment]::NewLine+$r.StdOut),'All:(?<v>[0-9.]+)')
    if(-not $match.Success){throw 'Source-backed SSIM did not report All value.'}
    return [double]::Parse($match.Groups['v'].Value,[Globalization.CultureInfo]::InvariantCulture)
}

function Get-PacketStats([string]$File) {
    $r=Invoke-BridgeTool $script:Ffprobe ('-v error -select_streams v:0 -show_packets -show_entries packet=size -of csv=p=0 '+(Quote-NativeArg $File))
    $count=0;$bytes=0L
    if($r.ExitCode -eq 0){
        foreach($line in ($r.StdOut -split '\r?\n')){
            $n=($line.Trim().Split(',')[0] -as [long])
            if($n -gt 0){$count++;$bytes+=$n}
        }
    }
    return [pscustomobject]@{count=$count;bytes=$bytes}
}

# Low-cost, time-limited decoded scene scan, never a quality measurement.
function Invoke-SceneRiskProbe($Body) {
    $o=$Body.options
    $video=Get-SelectedPath 'video'
    if(-not $video){throw 'No video selected.'}
    $start=[double]$o.start
    $duration=[double]$o.duration
    if([double]::IsNaN($start) -or $start -lt 0 -or
        [double]::IsNaN($duration) -or $duration -lt 0.5 -or $duration -gt 3) {
        throw 'Invalid scene risk scan range.'
    }
    $timeout=if($o.timeoutSeconds){[Math]::Max(2,[Math]::Min(8,[double]$o.timeoutSeconds))}else{3}
    $work=New-BridgeWorkDir 'quick-risk-probe-'
    try {
        $from=$start.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $span=$duration.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $stats=Join-Path $work 'risk.stats'
        $filter="fps=2,scale=w='max(2,trunc(iw*min(1,320/max(iw,ih))/2)*2)':h='max(2,trunc(ih*min(1,320/max(iw,ih))/2)*2)':flags=bilinear,format=yuv420p,signalstats,scdet=threshold=10,metadata=print:file=risk.stats"
        $watch=[Diagnostics.Stopwatch]::StartNew()
        $run=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -nostdin -loglevel error -ss '+$from+
            ' -t '+$span+' -i '+(Quote-NativeArg $video)+
            ' -an -sn -vf "'+$filter+'" -f null NUL') $work $timeout
        $watch.Stop()
        if($run.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $stats)){
            throw ('Scene risk probe failed: '+[string]$run.StdErr)
        }
        $data=@{luma=@();dif=@();low=@();high=@();cut=@()}
        foreach($line in (Get-Content -LiteralPath $stats)){
            if($line -notmatch '^lavfi\.(?:signalstats|scd)\.(YAVG|YDIF|YLOW|YHIGH|score)=(?<number>[0-9]+(?:\.[0-9]+)?)$') {continue}
            $kind=$Matches[1]
            $value=0.0
            if(-not [double]::TryParse($Matches['number'],
                [Globalization.NumberStyles]::Float,
                [Globalization.CultureInfo]::InvariantCulture,[ref]$value)){continue}
            switch($kind){
                'YAVG' {$data.luma+= $value}
                'YDIF' {$data.dif+= $value}
                'YLOW' {$data.low+= $value}
                'YHIGH' {$data.high+= $value}
                'score' {$data.cut+= $value}
            }
        }
        if(-not $data.luma.Count){throw 'Scene risk signalstats returned no valid frames.'}
        $meanLuma=($data.luma | Measure-Object -Average).Average
        $meanDiff=if($data.dif.Count){($data.dif | Measure-Object -Average).Average}else{0.0}
        $maxScene=if($data.cut.Count){($data.cut | Measure-Object -Maximum).Maximum}else{0.0}
        $contrast=0.0
        if($data.low.Count -eq $data.high.Count -and $data.low.Count){
            $sum=0.0
            for($i=0;$i -lt $data.low.Count;$i++){$sum+=$data.high[$i]-$data.low[$i]}
            $contrast=$sum/$data.low.Count
        }
        return [pscustomobject]@{
            ok=$true;requestId=[string]$Body.requestId;sceneRiskOnly=$true
            start=$start;duration=$duration;frameCount=$data.luma.Count
            meanLuma=[double]$meanLuma;meanYdif=[double]$meanDiff
            peakScene=[double]$maxScene;meanContrast=[double]$contrast
            elapsedSeconds=[double]$watch.Elapsed.TotalSeconds
        }
    }finally{Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
}

function Invoke-Sample($Body) {
    $video=Get-SelectedPath 'video'
    if(-not $video){throw 'No video selected.'}
    $o=$Body.options
    if([bool]$o.sceneRiskOnly){return Invoke-SceneRiskProbe $Body}
    $requestedEncoder=[string]$o.encoder
    if($requestedEncoder){
        $allowedEncoders=@()
        switch([string]$o.codec){
            'h264' { $allowedEncoders=@('libx264','h264_nvenc') }
            'h265' { $allowedEncoders=@('libx265','hevc_nvenc') }
            'av1'  { $allowedEncoders=@('libsvtav1','av1_nvenc') }
        }
        if($requestedEncoder -notin $allowedEncoders){
            throw 'Sample encoder does not match the selected codec.'
        }
        $profile=@($script:Capabilities.Encoders | Where-Object { $_.Key -eq $requestedEncoder -and $_.Available }) | Select-Object -First 1
        if(-not $profile){throw 'Selected sample encoder is not runtime-available.'}
    }else{
        $profile=Get-PreferredEncoder ([string]$o.codec)
    }
    if(-not $profile){throw 'No available Windows Native encoder for this codec.'}
    $duration=[double]$o.duration
    if($duration -le 0 -or $duration -gt 8){throw 'Sample duration must be between 0 and 8 seconds.'}
    $start=[Math]::Max(0,[double]$o.start)
    $exactManualEvidence=[bool]$o.sampleExact -and -not [bool]$o.withSubtitles -and [bool]$o.measureSsim
    $exactGuidedEvidence=[bool]$o.sampleExact -and [bool]$o.guidedRenderedReference -and
        [bool]$o.withSubtitles -and [bool]$o.measureSsim -and [long]$o.targetVideoBitrate -gt 0
    if([bool]$o.sampleExact -and
       (([bool]$o.withSubtitles -and -not $exactGuidedEvidence) -or
        ([bool]$o.guidedRenderedReference -and -not $exactGuidedEvidence))){
        throw 'Exact Guided and Manual sample reference modes cannot be mixed.'
    }
    $snapshotBefore=if($exactManualEvidence -or $exactGuidedEvidence){
        $version=Get-FfmpegVersionInfo $script:Ffmpeg
        New-ManualNativeSampleSnapshot $video $script:Ffmpeg ([string]$version.Text)
    }else{$null}
    $work=New-BridgeWorkDir 'quick-hardsub-sample-'
    $sampleId=[guid]::NewGuid().ToString('N')
    try{
        $withSubs=[bool]$o.withSubtitles
        if($withSubs){Stage-BridgeAssets $work ([string]$Body.assText)}
        $assetBefore=if($exactGuidedEvidence){Get-GuidedRenderedAssetStamp $work}else{$null}
        $reference=Join-Path $work 'reference.mkv'
        $candidate=Join-Path $work 'sample.mkv'
        $startText=$start.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $durationText=$duration.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $outW=[int]$o.outputWidth
        $outH=[int]$o.outputHeight
        $refW=[int]$o.referenceWidth
        $refH=[int]$o.referenceHeight
        $common=$exactManualEvidence -and [bool]$o.commonReference
        $scaled=$outW -gt 0 -or $outH -gt 0
        if([bool]$o.commonReference -and (-not $common -or -not $scaled)){throw 'Common reference requires exact measured manual geometry.'}
        if($scaled){
            if(-not $common -and (-not $withSubs -or ([bool]$o.sampleExact -and -not $exactGuidedEvidence))){throw 'Resolution trials require subtitle-rendered common reference mode.'}
            if($outW -lt 2 -or $outH -lt 2 -or $outW -gt 16384 -or $outH -gt 16384 -or
                ($outW % 2) -or ($outH % 2) -or
                $refW -lt $outW -or $refH -lt $outH -or
                $refW -gt 16384 -or $refH -gt 16384){
                throw 'Invalid common-reference candidate resolution.'
            }
        }
        if($common){
            $sourceGeometry=Invoke-BridgeTool $script:Ffprobe ('-v error -select_streams v:0 -show_entries stream=width,height -of json '+(Quote-NativeArg $video))
            if($sourceGeometry.ExitCode -ne 0){throw 'Cannot verify common source reference geometry.'}
            $sourceStream=@(($sourceGeometry.StdOut | ConvertFrom-Json).streams)[0]
            if([int]$sourceStream.width -ne $refW -or [int]$sourceStream.height -ne $refH){throw 'Common reference geometry differs from source.'}
        }
        $referenceFilter=if($withSubs){' -vf "ass=subtitle.ass:fontsdir=fonts"'}else{''}
        $vf=if($withSubs){
            $filter='ass=subtitle.ass:fontsdir=fonts'
            if($scaled){$filter+=',scale='+$outW+':'+$outH+':flags=bicubic'}
            ' -vf "'+$filter+'"'
        }elseif($common){' -vf "scale='+$outW+':'+$outH+':flags=bicubic"'}else{''}
        if(-not [bool]$o.sampleExact -or $exactGuidedEvidence){
            # Guided exact VBR samples also require the subtitle-rendered FFV1
            # reference; exact filter-free transcoding measures from source.
            $rr=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -loglevel error -y -ss '+$startText+' -t '+$durationText+' -i '+(Quote-NativeArg $video)+' -an -sn'+$referenceFilter+' -c:v ffv1 '+(Quote-NativeArg $reference)) $work
            if($rr.ExitCode -ne 0){throw ($rr.StdErr.Trim())}
        }
        $encArgs=Get-BridgeEncoderArgs $profile $o
        $sw=[Diagnostics.Stopwatch]::StartNew()
        $encodeTimeout = if ($o.timeoutSeconds) { [Math]::Max(2, [Math]::Min(300, [double]$o.timeoutSeconds)) } else { 0 }
        $run=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -loglevel error -y -ss '+$startText+' -t '+$durationText+' -i '+(Quote-NativeArg $video)+' -an -sn'+$vf+' '+$encArgs+' -pix_fmt yuv420p '+(Quote-NativeArg $candidate)) $work $encodeTimeout
        $sw.Stop()
        if($run.ExitCode -ne 0 -or -not(Test-Path $candidate)){throw ($run.StdErr.Trim())}
        $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $candidate))
        $measured=if($probe.ExitCode -eq 0){[double]::Parse($probe.StdOut.Trim(),[Globalization.CultureInfo]::InvariantCulture)}else{$duration}
        if($common){
            $outputGeometry=Invoke-BridgeTool $script:Ffprobe ('-v error -select_streams v:0 -show_entries stream=width,height -of json '+(Quote-NativeArg $candidate))
            if($outputGeometry.ExitCode -ne 0){throw 'Cannot verify measured output geometry.'}
            $actualStream=@(($outputGeometry.StdOut | ConvertFrom-Json).streams)[0]
            if([int]$actualStream.width -ne $outW -or [int]$actualStream.height -ne $outH){throw 'Measured output geometry differs from requested candidate.'}
        }
        $packets=Get-PacketStats $candidate
        $ssim=if([bool]$o.measureSsim){
            if($exactManualEvidence){
                Get-SsimAgainstSource $candidate $video $startText $durationText $work $(if($common){$refW}else{0}) $(if($common){$refH}else{0})
            }else{
                if($scaled){Get-Ssim $candidate $reference $work $refW $refH}
                else{Get-Ssim $candidate $reference $work}
            }
        }else{$null}
        $sampleBytes=(Get-Item $candidate).Length
        if($exactGuidedEvidence -and ($null -eq $ssim -or [double]$ssim -lt 0 -or [double]$ssim -gt 1)){
            throw 'Guided rendered-reference SSIM not available.'
        }
        $nativeEvidence=if($exactManualEvidence){
            $snapshotAfter=New-ManualNativeSampleSnapshot $video $script:Ffmpeg ([string]$snapshotBefore.runtimeVersion)
            New-ManualNativeSampleReceipt $snapshotBefore $snapshotAfter $o ([string]$profile.Encoder) $measured
        }elseif($exactGuidedEvidence){
            $snapshotAfter=New-ManualNativeSampleSnapshot $video $script:Ffmpeg ([string]$snapshotBefore.runtimeVersion)
            $assetAfter=Get-GuidedRenderedAssetStamp $work
            New-GuidedExactVbrReceipt $snapshotBefore $snapshotAfter $o ([string]$profile.Encoder) $(if($profile.Hardware){'p7'}elseif([string]$o.preset){[string]$o.preset}else{[string]$profile.SoftwarePreset}) $measured $assetBefore $assetAfter
        }else{$null}
        if([bool]$o.retainSample){
            $keep=Join-Path ([IO.Path]::GetTempPath()) ("quick-hardsub-sample-$sampleId.mkv")
            Copy-Item -LiteralPath $candidate -Destination $keep -Force
            $script:Samples[$sampleId]=$keep
        }
        return [pscustomobject]@{
            requestId=[string]$Body.requestId;ok=$true;sampleId=$sampleId
            encoder=$profile.Encoder;hardware=[bool]$profile.Hardware
            elapsedSeconds=$sw.Elapsed.TotalSeconds;duration=$measured
            encodeSpeed=($measured/[Math]::Max(.001,$sw.Elapsed.TotalSeconds))
            totalVideoBytes=$packets.bytes;packetCount=$packets.count;ssim=$ssim;sampleBytes=$sampleBytes
            nativeEvidence=$nativeEvidence
        }
    }finally{Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
}

function Assert-CurrentCopyBudgetEvidence($Evidence,[string]$Video) {
    $measured=$script:BudgetMeasurement
    $item=Get-Item -LiteralPath $Video
    if(-not $Evidence -or -not $measured -or
       [string]$Evidence.measurementId -ne [string]$measured.Id -or
       $Video -ne $measured.Path -or
       $item.Length -ne $measured.Length -or
       $item.LastWriteTimeUtc.Ticks -ne $measured.WriteTicks) {
        throw 'Budget measurement does not match current source; measure again.'
    }
    # The token is not permission for the UI to rewrite the measured packet
    # bytes. Bind the claimed copy cost to the Windows-local observation too.
    $expected=@($measured.AudioPacketBytes)
    $actual=@($Evidence.audioPacketBytes)
    if($actual.Count -ne $expected.Count) {
        throw 'Measured copied-audio packet costs differ from current source evidence.'
    }
    for($i=0;$i -lt $expected.Count;$i++) {
        if([string]$actual[$i] -ne [string]$expected[$i]) {
            throw 'Measured copied-audio packet costs differ from current source evidence.'
        }
    }
}

function Start-MediaTaskJob($Body) {
    if($script:FlacPreflightJob -and (Get-FlacEncodePreflightStatus).state -eq 'running'){
      throw 'Finish FLAC preflight before formal encoding.'
    }
    if($script:TrimPreflightJob -and (Get-IsolatedTrimPreflightStatus).state -eq 'running'){
      throw 'Finish isolated copy preflight before formal encoding.'
    }
    if (Test-Bink2ImportBusy) { throw 'Bink 2 import is still running.' }
    foreach($existing in $script:Jobs.Values){if($existing.State -eq 'encoding' -and -not $existing.Started.Process.HasExited){throw 'A Native job is already running.'}}
    $request=$Body.request; $task=$request.task
    $outputArgs=Get-MediaTaskArgs $task
    $video=Get-SelectedPath 'video'
    if(-not $video){throw 'No video selected.'}
    if($task.budgetEvidence){
        Assert-CurrentCopyBudgetEvidence $task.budgetEvidence $video
    }
    $probe=Get-ProbeMedia
    if($probe.sourceAdapterRequired){throw 'Bink 2 must be imported through RAD Video Tools before FFmpeg can process it.'}
    if(-not $probe.inputDecodeSmoke){throw ('Selected video metadata is readable, but FFmpeg cannot decode the video stream. '+$probe.inputDecodeError)}
    if($probe.sourceAdapterApplied -and $task.operation -eq 'copy'){throw 'Stream Copy is unavailable for a Bink 2 source after external decode import; choose transcode or hard-sub instead.'}
    if($task.operation -ne 'copy'){
        $selected=@($task.videoStreams)
        if(-not $selected.Count){$selected=@(0)}
        foreach($ordinal in $selected){
            if([int]$ordinal -lt 0 -or [int]$ordinal -ge @($probe.videoStreams).Count){throw 'Selected video stream does not exist.'}
            if(@($probe.videoStreams)[[int]$ordinal].unsafeColorPipeline){throw 'Selected HDR/high-bit-depth video stream cannot be transcoded safely.'}
        }
    }
    if([double]$task.end -gt [double]$probe.duration + 0.1){throw 'Range exceeds source duration.'}
    $codecIndex=[Array]::IndexOf($outputArgs,'-c:v')
    $encoder=$outputArgs[$codecIndex+1]
    if($encoder -ne 'copy'){
        $profile=@($script:Capabilities.Encoders | Where-Object { $_.Key -eq $encoder -and $_.Available }) | Select-Object -First 1
        if(-not $profile){throw 'Selected encoder is unavailable; no automatic substitution.'}
        if($encoder -eq 'libvvenc' -and $profile.RuntimeValidation -ne 'encode-mkv-decode-v1'){throw 'VVC runtime chain was not validated.'}
        if($profile.PixelFormats.Count -and $outputArgs -contains '-pix_fmt' -and $profile.PixelFormats -notcontains $outputArgs[[Array]::IndexOf($outputArgs,'-pix_fmt')+1]){throw 'Selected pixel format is unsupported.'}
        foreach($flag in @('-fps_mode','-vsync','-multipass','-rc-lookahead','-spatial-aq','-temporal-aq','-aq-strength','-cq','-crf','-qp','-preset','-tune')){if($outputArgs -contains $flag -and $profile.Options -notcontains $flag -and $script:Capabilities.GlobalOptions -notcontains $flag){throw "FFmpeg encoder does not support $flag"}}
    }
    $audioEncoders=@()
    for($i=0;$i -lt $outputArgs.Count;$i++){if($outputArgs[$i] -match '^-c:a(?::[0-9]+)?$'){$audioEncoders+=$outputArgs[$i+1]}}
    foreach($name in @($audioEncoders | Select-Object -Unique)){
        if($name -eq 'copy'){continue}
        $audioHelp=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -h encoder='+$name)
        if($audioHelp.StdOut -notmatch ('(?m)^Encoder '+[regex]::Escape([string]$name)+'\s')){throw 'Selected audio encoder is unavailable.'}
    }

    $actualStart=[double]$task.start
    if($task.operation -eq 'copy' -and [string]$task.videoRange -ne 'full' -and $actualStart -gt 0){
        $stop=($actualStart+1).ToString('0.######',[Globalization.CultureInfo]::InvariantCulture)
        $primary=if(@($task.videoStreams).Count){[int]@($task.videoStreams)[0]}else{0}
        $scan=Invoke-BridgeTool $script:Ffprobe ('-v error -select_streams v:'+$primary+' -skip_frame nokey -read_intervals 0%'+$stop+' -show_frames -show_entries frame=best_effort_timestamp_time -of csv=p=0 '+(Quote-NativeArg $video))
        if($scan.ExitCode -ne 0){throw 'Keyframe scan failed.'}
        $found=$false; $last=0.0
        foreach($line in ($scan.StdOut -split "\r?\n")){
            $time=0.0
            if([double]::TryParse(($line.Split(',')[0]),[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$time) -and $time -ge 0 -and $time -le $actualStart){$last=[Math]::Max($last,$time);$found=$true}
        }
        if(-not $found){throw 'No suitable keyframe found.'}
        $actualStart=$last
    }
    $outputFormat=[string]$task.outputFormat
    $outputExtension=[string]$task.outputExtension
    if($outputFormat -notin @('matroska','mp4')){throw 'Unsupported output container format.'}
    if(($outputFormat -eq 'matroska' -and $outputExtension -ne 'mkv') -or ($outputFormat -eq 'mp4' -and $outputExtension -ne 'mp4')){throw 'Output container format/extension mismatch.'}
    $outputFile='output.'+$outputExtension
    $jobId=[guid]::NewGuid().ToString('N')
    $work=New-BridgeWorkDir ("quick-media-job-$jobId-")
    if($task.operation -eq 'hardsub'){Stage-BridgeAssets $work ([string]$Body.assText)}
    $parts=New-Object 'System.Collections.Generic.List[string]'
    foreach($a in @('-hide_banner','-nostdin','-loglevel','error','-y','-progress','progress.txt')){$parts.Add($a)}
    if([int]$task.version -ge 4){
        $parts.Add('-i');$parts.Add($video)
        if([bool]$task.usesTrimInput){
            $parts.Add('-ss');$parts.Add($actualStart.ToString('0.######',[Globalization.CultureInfo]::InvariantCulture))
            $parts.Add('-t');$parts.Add(([double]$task.end-$actualStart).ToString('0.######',[Globalization.CultureInfo]::InvariantCulture))
            $parts.Add('-i');$parts.Add($video)
        }
    }else{
        if($actualStart -gt 0){$parts.Add('-ss');$parts.Add($actualStart.ToString('0.######',[Globalization.CultureInfo]::InvariantCulture))}
        $parts.Add('-i');$parts.Add($video);$parts.Add('-t');$parts.Add(([double]$task.end-$actualStart).ToString('0.######',[Globalization.CultureInfo]::InvariantCulture))
    }
    $baseParts=@($parts.ToArray())
    foreach($a in $outputArgs){$parts.Add($a.Replace('__ASS__','subtitle.ass').Replace('__FONTS__','fonts'))}
    if($task.twoPass){foreach($a in @('-pass','2','-passlogfile','task-pass')){$parts.Add($a)}}
    foreach($a in @('-f',$outputFormat,$outputFile)){$parts.Add($a)}
    $args=($parts | ForEach-Object { Quote-NativeArg $_ }) -join ' '
    $secondArgs=$args
    if($task.twoPass){$first=@($baseParts)+@((Get-MediaFirstPassArgs $outputArgs) | ForEach-Object {$_.Replace('__ASS__','subtitle.ass').Replace('__FONTS__','fonts')})+@('-pass','1','-passlogfile','task-pass','-f','null','NUL');$args=($first | ForEach-Object { Quote-NativeArg $_ }) -join ' '}
    $started=Start-BridgeTool $script:Ffmpeg $args $work
    $trimDuration=[Math]::Max(0.0,[double]$task.end-$actualStart)
    $sourceDuration=[double]$probe.duration
    $videoDuration=if([int]$task.version -ge 4 -and [string]$task.videoRange -eq 'full'){$sourceDuration}else{$trimDuration}
    $audioDuration=if([int]$task.expectedAudioTracks -le 0){0.0}elseif($task.audioPlan){if(@($task.audioPlan | Where-Object {$_.action -ne 'drop' -and $_.range -eq 'full'}).Count){$sourceDuration}else{$trimDuration}}elseif([int]$task.version -ge 4 -and [string]$task.audioRange -eq 'full'){$sourceDuration}else{$trimDuration}
    $subtitleDuration=if(-not [bool]$task.keepSubtitles){0.0}elseif([int]$task.version -ge 4 -and [string]$task.subtitleRange -eq 'full'){$sourceDuration}else{$trimDuration}
    $duration=[Math]::Max($videoDuration,[Math]::Max($audioDuration,$subtitleDuration))
    $job=[pscustomobject]@{
        Id=$jobId;Work=$work;Output=(Join-Path $work $outputFile);Progress=(Join-Path $work 'progress.txt');Started=$started
        Duration=$duration;ExpectedVideoDuration=$videoDuration;ExpectedAudioDuration=$audioDuration;Encoder=$encoder;Hardware=$encoder.EndsWith('_nvenc');ActualStart=$actualStart;Task=$task;Request=$request;Source=$video;SourceProbe=$probe;Phase=if($task.twoPass){1}else{2};SecondArgs=$secondArgs
        OutputExtension=$outputExtension;OutputFormat=$outputFormat;SuggestedName=[string]$request.suggestedName;State='encoding';Finalized=$false;Error='';Cancelled=$false
        StrictBudget=([string]$task.budgetPolicy -eq 'strict-ceiling');BudgetCeiling=[long]$task.sizeCeilingBytes;StrictVerifiedHash='';StrictVerifiedWriteTicks=0L;BudgetRejected=$false
        StartedAt=(Get-Date);HistoryRecorded=$false;EncodeSeconds=0.0;TimedProcessKey='';VvcValidating=$false
        TrimPacketAuditFinished=$false;TrimPacketEvidence=$null;TrimPacketAuditState='not-requested';TrimPacketAuditStarted=$null;TrimPacketAuditReceipt='';TrimPacketAuditExpectedLength=0L;TrimPacketAuditExpectedTicks=0L
    }
    $script:Jobs[$jobId]=$job
    return [pscustomobject]@{ok=$true;jobId=$jobId;suggestedName=$job.SuggestedName;actualStart=$actualStart;encoder=$encoder}
}

function Resolve-GuidedBudgetPolicy($Request,$Profile) {
    $policy=[string]$Request.sizeBudgetPolicy
    if(-not $policy){$policy='best-effort'}
    if($policy -notin @('best-effort','two-pass','strict-ceiling')){
        throw 'Unknown guided size-budget execution policy.'
    }
    if([string]$Request.mode -ne 'budget-rate'){
        if($policy -ne 'best-effort'){throw 'Two-pass size strategy is only valid for budget-rate jobs.'}
        return [pscustomobject]@{Policy='best-effort';TwoPass=$false;Strict=$false;Ceiling=0L}
    }
    $twoPass=$policy -ne 'best-effort'
    if($twoPass -and (-not $Profile -or [string]$Profile.Encoder -ne 'libx264')){
        throw 'Two-pass guided size mode requires explicit Windows Native libx264 software encoding.'
    }
    $ceiling=0L
    if($policy -eq 'strict-ceiling'){
        $value=0L
        if(-not [long]::TryParse([string]$Request.sizeCeilingBytes,[ref]$value) -or $value -le 0){
            throw 'Strict byte-ceiling mode requires a positive whole-container byte limit.'
        }
        $ceiling=$value
    }
    return [pscustomobject]@{Policy=$policy;TwoPass=$twoPass;Strict=($policy -eq 'strict-ceiling');Ceiling=$ceiling}
}

function Start-EncodeJob($Body) {
    if($script:FlacPreflightJob -and (Get-FlacEncodePreflightStatus).state -eq 'running'){
      throw 'Finish FLAC preflight before formal encoding.'
    }
    if($script:TrimPreflightJob -and (Get-IsolatedTrimPreflightStatus).state -eq 'running'){
      throw 'Finish isolated copy preflight before formal encoding.'
    }
    if (Test-Bink2ImportBusy) { throw 'Bink 2 import is still running.' }
    foreach($existing in $script:Jobs.Values){if($existing.State -eq 'encoding' -and -not $existing.Started.Process.HasExited){throw 'A Native job is already running.'}}
    $video=Get-SelectedPath 'video'
    if(-not $video){throw 'No video selected.'}
    $request=$Body.request
    if($request.task){return Start-MediaTaskJob $Body}
    $probe=Get-ProbeMedia
    if($probe.sourceAdapterRequired){throw 'Bink 2 must be imported through RAD Video Tools before FFmpeg can process it.'}
    if(-not $probe.inputDecodeSmoke){throw ('Selected video metadata is readable, but FFmpeg cannot decode the video stream. '+$probe.inputDecodeError)}
    # The client-reported track count cannot waive the receipt requirement.
    # Check the *probed Native source*, which also owns the packet observation.
    if([string]$request.mode -eq 'budget-rate' -and [string]$request.audio -eq 'copy') {
        if([int]$request.expectedAudioTracks -ne [int]$probe.audioTracks) {
            throw 'Guided copied-audio track count differs from current Native source.'
        }
        if([int]$probe.audioTracks -gt 0) {
            Assert-CurrentCopyBudgetEvidence $request.budgetEvidence $video
        }
    }
    $outputFormat=if([string]$request.outputFormat){[string]$request.outputFormat}else{'matroska'}
    $outputExtension=if([string]$request.outputExtension){[string]$request.outputExtension}else{'mkv'}
    if($outputFormat -notin @('matroska','mp4')){throw 'Unsupported output container format.'}
    if(($outputFormat -eq 'matroska' -and $outputExtension -ne 'mkv') -or ($outputFormat -eq 'mp4' -and $outputExtension -ne 'mp4')){throw 'Output container format/extension mismatch.'}
    $requestedPolicy=[string]$request.sizeBudgetPolicy
    if(-not $requestedPolicy){$requestedPolicy='best-effort'}
    if($requestedPolicy -in @('two-pass','strict-ceiling')){
        if([string]$request.codec -ne 'h264'){
            throw 'Two-pass guided size strategy supports only H.264; no implicit codec switch.'
        }
        # Explicit opt-in overrides NVENC preference; never silently run
        # a one-pass hardware encoder for a requested software two-pass job.
        $profile=@($script:Capabilities.Encoders |
            Where-Object { $_.Key -eq 'libx264' -and $_.Available } |
            Select-Object -First 1)[0]
        if(-not $profile){throw 'Software libx264 is unavailable; requested two-pass mode cannot run.'}
    }else{
        $profile=Get-PreferredEncoder ([string]$request.codec)
    }
    if(-not $profile){throw 'No available Windows Native encoder for this codec.'}
    $budgetPolicy=Resolve-GuidedBudgetPolicy $request $profile
    $jobId=[guid]::NewGuid().ToString('N')
    $work=New-BridgeWorkDir ("quick-hardsub-job-$jobId-")
    Stage-BridgeAssets $work ([string]$Body.assText)
    $outputFile='output.'+$outputExtension
    $output=Join-Path $work $outputFile
    $progress=Join-Path $work 'progress.txt'
    $encArgs=Get-BridgeEncoderArgs $profile $request
    $containerArgs=if($outputFormat -eq 'mp4'){' -movflags +faststart'}else{''}
    $audioMode=if([string]$request.audio){[string]$request.audio}else{'copy'}
    if($audioMode -notin @('copy','aac','libopus','none')){throw 'Unsupported audio strategy.'}
    if($audioMode -eq 'none'){
        $audioArgs=' -an'
    }else{
        $audioArgs=' -map 0:a? -c:a '+$audioMode
        if($audioMode -in @('aac','libopus')){
            $audioBitrate=if($request.audioBitrate){[int]$request.audioBitrate}else{128000}
            if($audioBitrate -lt 8000 -or $audioBitrate -gt 1024000){throw 'Audio bitrate out of range.'}
            $audioArgs+=' -b:a '+$audioBitrate
            if($request.audioChannels){
                $audioChannels=[int]$request.audioChannels
                if($audioChannels -lt 1 -or $audioChannels -gt 8){throw 'Audio channel count out of range.'}
                $audioArgs+=' -ac '+$audioChannels
            }
            if($request.audioSampleRate){
                $audioSampleRate=[int]$request.audioSampleRate
                if($audioSampleRate -lt 8000 -or $audioSampleRate -gt 192000){throw 'Audio sample rate out of range.'}
                if($audioMode -eq 'libopus' -and $audioSampleRate -notin @(8000,12000,16000,24000,48000)){throw 'Unsupported Opus sample rate.'}
                $audioArgs+=' -ar '+$audioSampleRate
            }
        }
    }
    $outW=[int]$request.outputWidth
    $outH=[int]$request.outputHeight
    $scaled=$outW -gt 0 -or $outH -gt 0
    if($scaled -and ($outW -lt 2 -or $outH -lt 2 -or $outW -gt 16384 -or $outH -gt 16384 -or
        ($outW % 2) -or ($outH % 2))){throw 'Invalid guided output size.'}
    $videoFilter='ass=subtitle.ass:fontsdir=fonts'
    if($scaled){$videoFilter+=',scale='+$outW+':'+$outH+':flags=bicubic'}
    $inputArgs='-hide_banner -nostdin -loglevel error -y -progress progress.txt -i '+(Quote-NativeArg $video)+' -map 0:v:0 -sn -vf "'+$videoFilter+'" '+$encArgs
    $secondArgs=$inputArgs+$audioArgs+
        $(if($budgetPolicy.TwoPass){' -pass 2 -passlogfile guided-budget'}else{''})+
        $containerArgs+' -f '+$outputFormat+' '+(Quote-NativeArg $outputFile)
    $args=if($budgetPolicy.TwoPass){
        # Both passes use the exact same source, subtitle/font filter, resolution,
        # software encoder, preset and target video bitrate. First pass has no
        # audio and no publishable output. All paths are private to $work.
        $inputArgs+' -an -pass 1 -passlogfile guided-budget -f null NUL'
    }else{$secondArgs}
    $started=Start-BridgeTool $script:Ffmpeg $args $work
    $job=[pscustomobject]@{
        Id=$jobId;Work=$work;Output=$output;Progress=$progress;Started=$started
        Duration=[double]$request.expectedDuration;Encoder=$profile.Encoder;Hardware=[bool]$profile.Hardware;ActualStart=0;Task=$null;Request=$request;SourceProbe=$null
        SizeBudgetPolicy=$budgetPolicy.Policy;StrictBudget=[bool]$budgetPolicy.Strict;BudgetCeiling=[long]$budgetPolicy.Ceiling
        StrictVerifiedHash='';StrictVerifiedWriteTicks=0L;VerifiedOutputDuration=0.0
        Phase=if($budgetPolicy.TwoPass){1}else{2};SecondArgs=$secondArgs
        OutputExtension=$outputExtension;OutputFormat=$outputFormat;SuggestedName=[string]$request.suggestedName;State='encoding';Finalized=$false;Error='';Cancelled=$false
        StartedAt=(Get-Date);HistoryRecorded=$false;EncodeSeconds=0.0;TimedProcessKey=''
    }
    $script:Jobs[$jobId]=$job
    return [pscustomobject]@{ok=$true;jobId=$jobId;suggestedName=$job.SuggestedName;encoder=$job.Encoder;hardware=$job.Hardware}
}

function Get-CodecKeyForEncoder([string]$Encoder) {
    if($Encoder -match '^(?:libx264|h264_nvenc)$'){return 'h264'}
    if($Encoder -match '^(?:libx265|hevc_nvenc)$'){return 'h265'}
    if($Encoder -match '^(?:libsvtav1|av1_nvenc)$'){return 'av1'}
    return ''
}

function Ensure-CompletedJobHistory($Job) {
    if(-not $Job -or $Job.HistoryRecorded -or $Job.State -ne 'completed' -or $Job.Encoder -eq 'copy'){return}
    if($Job.Task -and $null -ne $Job.Task.expectedVideoTracks -and [int]$Job.Task.expectedVideoTracks -ne 1){
        # The current Compression Evidence model is single-video. Do not collapse
        # a multi-video execution into one misleading source/bitrate observation.
        $Job.HistoryRecorded=$true
        return
    }
    try {
        $codec=Get-CodecKeyForEncoder ([string]$Job.Encoder)
        if(-not $codec){return}

        $request=$Job.Request
        $task=$Job.Task
        $source=$Job.SourceProbe
        $outputBytes=(Get-Item -LiteralPath $Job.Output).Length
        $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -select_streams v:0 -show_entries stream=bit_rate,width,height,avg_frame_rate,codec_name -show_entries format=duration -of json '+(Quote-NativeArg $Job.Output))
        $outputDuration=[double]$Job.Duration
        $outputVideoBitrate=0L
        if($probe.ExitCode -eq 0){
            $info=$probe.StdOut | ConvertFrom-Json
            if($info.format.duration){[void][double]::TryParse([string]$info.format.duration,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$outputDuration)}
            $outVideo=@($info.streams | Select-Object -First 1)
            if($outVideo.Count -and $outVideo[0].bit_rate){[void][long]::TryParse([string]$outVideo[0].bit_rate,[ref]$outputVideoBitrate)}
        }

        $elapsed=[Math]::Max(.001,[double]$Job.EncodeSeconds)
        $sourceIdentity=if($request -and $request.sourceIdentity){[string]$request.sourceIdentity}else{''}
        $mode=if($request -and $request.mode){[string]$request.mode}elseif($task){[string]$task.rateMode}else{''}
        $preset=if($request -and $request.preset){[string]$request.preset}elseif($task){[string]$task.preset}else{''}
        $crf=if($request -and $null -ne $request.crf){$request.crf}elseif($task -and $task.rateMode -eq 'quality'){$task.quality}else{$null}
        $targetVideoBitrate=if($request -and $request.targetVideoBitrate){[long]$request.targetVideoBitrate}elseif($task -and $task.rateMode -ne 'quality'){[long]$task.bitrate}else{0L}
        $width=if($request -and $request.sourceWidth){[int]$request.sourceWidth}elseif($source){[int]$source.width}else{0}
        $height=if($request -and $request.sourceHeight){[int]$request.sourceHeight}elseif($source){[int]$source.height}else{0}
        $fps=if($request -and $request.sourceFps){Convert-MediaFrameRate $request.sourceFps}elseif($source){Convert-MediaFrameRate $source.fps}else{0.0}
        $sourceCodec=if($request -and $request.sourceCodec){[string]$request.sourceCodec}elseif($source){[string]$source.videoCodec}else{''}
        $sourcePixelFormat=if($request -and $request.sourcePixelFormat){[string]$request.sourcePixelFormat}elseif($source){[string]$source.pixelFormat}else{''}
        $sourceVideoBitrate=if($request -and $request.sourceVideoBitrate){[long]$request.sourceVideoBitrate}elseif($source){[long]$source.videoBitRate}else{0L}
        $audioTracks=if($request -and $null -ne $request.expectedAudioTracks){[int]$request.expectedAudioTracks}elseif($task){[int]$task.expectedAudioTracks}else{0}

        $record=[ordered]@{
            evidenceVersion=1
            evidenceKind='full-encode'
            evidenceScope=if($sourceIdentity){'source'}else{'device'}
            backend='windows-native'
            sourceIdentity=$sourceIdentity
            codec=$codec
            mode=$mode
            goal=if($request){[string]$request.goal}else{''}
            preset=$preset
            crf=$crf
            targetVideoBitrate=$targetVideoBitrate
            sourceCodec=$sourceCodec
            sourcePixelFormat=$sourcePixelFormat
            sourceVideoBitrate=$sourceVideoBitrate
            width=$width
            height=$height
            fps=$fps
            duration=[double]$Job.Duration
            audioTracks=$audioTracks
            subtitleEventCount=if($request){[int]$request.subtitleEventCount}else{0}
            selectedFontCount=if($request){[int]$request.selectedFontCount}else{0}
            sampleEncodeSpeed=if($request){[double]$request.sampleEncodeSpeed}else{0.0}
            calibrationSampleBitrate=if($request){[long]$request.calibrationSampleBitrate}else{0L}
            encodeSeconds=$elapsed
            averageSpeed=([double]$Job.Duration/$elapsed)
            outputBytes=[long]$outputBytes
            outputVideoBitrate=[long]$outputVideoBitrate
            validation='ffprobe+packet-scan'
        }
        [void](Add-CompressionHistoryRecord $record)
        $Job.HistoryRecorded=$true
    } catch {
        Write-BridgeLog ('Compression history write failed: '+$_.Exception.Message) 'WARN'
    }
}

function Clear-IncompleteJobStaging($Job) {
    # Call only after process exit/disposal. Completed staging belongs to the
    # pending save operation and must survive cancellation retries.
    if($Job.State -notin @('failed','cancelled') -or $Job.BudgetRejected){return}
    try {
        if($Job.Work -and (Test-Path -LiteralPath $Job.Work)){
            Remove-Item -LiteralPath $Job.Work -Recurse -Force -ErrorAction Stop
        }
    } catch {
        Write-BridgeLog ('Incomplete job staging cleanup failed: '+$_.Exception.Message) 'WARN'
    }
}

function Cancel-EncodeJob([string]$JobId) {
    if(-not $script:Jobs.ContainsKey($JobId)){return [pscustomobject]@{ok=$false;error='Unknown Windows Native job id.'}}
    $j=$script:Jobs[$JobId]
    if($j.State -in @('completed','failed','cancelled')){return Get-JobStatus $JobId}
    # Set this before querying status, including the gap after pass one has
    # exited, so Get-JobStatus cannot launch a cancelled second pass.
    $j.Cancelled=$true
    $p=$j.Started.Process
    try {
        if(-not $p.HasExited){$p.Kill()}
    } catch {
        # Natural exit can race with Kill. A stop exception is not evidence
        # that the process is still running; independently confirm exit.
        Write-BridgeLog ('Encode cancellation stop failed: '+$_.Exception.Message) 'WARN'
    }
    try {
        if(-not $p.WaitForExit(3000)){
            return [pscustomobject]@{ok=$true;state='cancelling';jobId=$JobId}
        }
    } catch {
        Write-BridgeLog ('Encode cancellation exit confirmation failed: '+$_.Exception.Message) 'WARN'
        return [pscustomobject]@{ok=$true;state='cancelling';jobId=$JobId}
    }
    # Finalize now: the client may disconnect and never poll again. Cleanup
    # must happen after confirmed exit, rather than while FFmpeg owns files.
    return Get-JobStatus $JobId
}

function Test-GuidedOutputStreams($Job) {
    # Guided encodes previously checked only the existence of a video header.
    # Enforce the same bounded stream/packet integrity checks as manual tasks
    # before a completed guided artifact becomes exportable.
    $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -show_streams -show_format -of json '+(Quote-NativeArg $Job.Output))
    if($probe.ExitCode -ne 0){throw 'Guided output FFprobe failed.'}
    $info=$probe.StdOut | ConvertFrom-Json
    $videos=@($info.streams | Where-Object { $_.codec_type -eq 'video' })
    $audios=@($info.streams | Where-Object { $_.codec_type -eq 'audio' })
    if($videos.Count -ne 1){throw 'Guided output must contain exactly one video stream.'}
    $request=$Job.Request
    if($null -ne $request.expectedAudioTracks -and $audios.Count -ne [int]$request.expectedAudioTracks){
        throw 'Guided output audio stream count differs from requested input.'
    }
    if([string]$request.audio -eq 'none' -and $audios.Count -ne 0){
        throw 'Guided output unexpectedly contains audio.'
    }
    $outputDuration=0.0
    if(-not [double]::TryParse([string]$info.format.duration,
        [Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,
        [ref]$outputDuration) -or $outputDuration -le 0 -or
        ($Job.Duration -gt 0 -and [Math]::Abs($outputDuration-$Job.Duration) -gt 2)){
        throw 'Guided output duration validation failed.'
    }
    $scan=Invoke-BridgeTool $script:Ffmpeg ('-v error -nostdin -i '+(Quote-NativeArg $Job.Output)+' -map 0:v -map 0:a? -c copy -f null -')
    if($scan.ExitCode -ne 0){throw 'Guided output packet scan failed.'}
    $Job.VerifiedOutputDuration=$outputDuration
}

function Get-GuidedContainerFingerprint([string]$Path) {
    # Stream the file through PowerShell/.NET SHA-256; no whole-file buffering.
    # Reject a container modified while its fingerprint was being calculated.
    $before=Get-Item -LiteralPath $Path -ErrorAction Stop
    if($before.Length -le 0){throw 'Container fingerprint source is empty.'}
    $hash=(Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash
    $after=Get-Item -LiteralPath $Path -ErrorAction Stop
    if($before.Length -ne $after.Length -or
        $before.LastWriteTimeUtc.Ticks -ne $after.LastWriteTimeUtc.Ticks){
        throw 'Container changed while computing its fingerprint.'
    }
    if(-not $hash){throw 'Container fingerprint is missing.'}
    return [pscustomobject]@{
        Hash=[string]$hash
        Length=[long]$after.Length
        WriteTicks=[long]$after.LastWriteTimeUtc.Ticks
    }
}

function Test-GuidedStrictBudget($Job,[bool]$CaptureEvidence=$false) {
    # The completed state is only valid while its private staged *container*
    # stays within the user's explicit ceiling. An earlier successful check
    # cannot authorize a later, modified output or an export copy.
    if(-not $Job.StrictBudget){return $true}
    $limit=[long]$Job.BudgetCeiling
    $actual=0L
    if(Test-Path -LiteralPath $Job.Output -PathType Leaf){
        $actual=[long](Get-Item -LiteralPath $Job.Output).Length
    }
    if($limit -gt 0 -and $actual -gt 0 -and $actual -le $limit){
        try{
            if($CaptureEvidence){
                # Initial terminal verification: bind the approved staged bytes
                # to the same content later copied into the user's destination.
                $fingerprint=Get-GuidedContainerFingerprint $Job.Output
                if($fingerprint.Length -ne $actual){throw 'Container size changed after byte-ceiling validation.'}
                $Job.StrictVerifiedHash=$fingerprint.Hash
                $Job.StrictVerifiedWriteTicks=$fingerprint.WriteTicks
            }else{
                if(-not $Job.StrictVerifiedHash){throw 'The completed strict job has no verified content fingerprint.'}
                $file=Get-Item -LiteralPath $Job.Output -ErrorAction Stop
                # Avoid re-reading a multi-hour movie during every status poll.
                # Changes to length are handled above; changed write stamps
                # trigger a cryptographic re-check before retaining completion.
                if([long]$file.LastWriteTimeUtc.Ticks -ne [long]$Job.StrictVerifiedWriteTicks){
                    $fingerprint=Get-GuidedContainerFingerprint $Job.Output
                    if($fingerprint.Hash -ne $Job.StrictVerifiedHash){
                        throw 'Previously verified staged container content has changed.'
                    }
                    $Job.StrictVerifiedWriteTicks=$fingerprint.WriteTicks
                }
            }
            return $true
        }catch{
            $Job.State='failed'
            $Job.Error='Strict container content fingerprint verification failed: '+$_.Exception.Message
            Remove-Item -LiteralPath $Job.Output -Force -ErrorAction SilentlyContinue
            Clear-IncompleteJobStaging $Job
            Write-BridgeLog ('Strict content guard rejected job '+$Job.Id+': '+$Job.Error) 'WARN'
            return $false
        }
    }
    if($Job.Task -and $actual -gt $limit -and $limit -gt 0){$Job.BudgetRejected=$true}
    $Job.State='failed'
    $Job.Error=if($actual -gt $limit){
        'Strict container byte ceiling exceeded: actual '+$actual+
        ' bytes > limit '+$limit+' bytes. No output exported; retry is not automatic.'
    }else{
        'Strict container byte verification failed: staged output missing, empty or invalid ceiling.'
    }
    if(-not $Job.Task){Remove-Item -LiteralPath $Job.Output -Force -ErrorAction SilentlyContinue;Clear-IncompleteJobStaging $Job}
    Write-BridgeLog ('Strict size guard rejected job '+$Job.Id+': '+$Job.Error) 'WARN'
    return $false
}

# Long-duration post-output packet measurement runs in its own bounded worker.
# Status reads only launch/poll it; the output remains saveable independently.
function Get-AsyncTrimPacketEvidence($Job) {
    if($Job.TrimPacketAuditFinished){
        # Even after the worker has exited, never reuse an observed receipt for
        # a staged file whose ordinary stat identity has since changed.
        if($null -ne $Job.TrimPacketEvidence){
            try{
                $current=Get-Item -LiteralPath $Job.Output -ErrorAction Stop
                if([long]$current.Length -ne [long]$Job.TrimPacketAuditExpectedLength -or
                   [long]$current.LastWriteTimeUtc.Ticks -ne [long]$Job.TrimPacketAuditExpectedTicks){
                    $Job.TrimPacketEvidence=$null
                    $Job.TrimPacketAuditState='unavailable'
                }
            }catch{
                $Job.TrimPacketEvidence=$null
                $Job.TrimPacketAuditState='unavailable'
            }
        }
        return $Job.TrimPacketEvidence
    }
    if(-not $Job.TrimPacketAuditStarted){
        try{
            $worker=Join-Path $PSScriptRoot 'trim-packet-audit.ps1'
            if(-not(Test-Path -LiteralPath $worker -PathType Leaf)){throw 'Long trim audit worker is missing.'}
            $snapshot=Get-Item -LiteralPath $Job.Output
            $Job.TrimPacketAuditExpectedLength=[long]$snapshot.Length
            $Job.TrimPacketAuditExpectedTicks=[long]$snapshot.LastWriteTimeUtc.Ticks
            $Job.TrimPacketAuditReceipt=Join-Path $Job.Work 'trim-packet-audit.json'
            $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File '+(Quote-NativeArg $worker)+
                ' -Ffprobe '+(Quote-NativeArg $script:Ffprobe)+
                ' -OutputFile '+(Quote-NativeArg $Job.Output)+
                ' -ReceiptFile '+(Quote-NativeArg $Job.TrimPacketAuditReceipt)
            $Job.TrimPacketAuditStarted=Start-BridgeTool 'powershell.exe' $args $Job.Work
            $Job.TrimPacketAuditState='running'
        }catch{
            $Job.TrimPacketAuditFinished=$true
            $Job.TrimPacketAuditState='unavailable'
            Write-BridgeLog ('Long trim audit launch unavailable: '+$_.Exception.Message) 'WARN'
        }
        return $null
    }
    $proc=$Job.TrimPacketAuditStarted.Process
    if(-not $proc.HasExited){return $null}
    $exitCode=$proc.ExitCode
    try{
        $Job.TrimPacketAuditFinished=$true
        $Job.TrimPacketAuditState='unavailable'
        if($exitCode -ne 0){throw 'Bounded FFprobe trim audit worker failed.'}
        if(-not(Test-Path -LiteralPath $Job.TrimPacketAuditReceipt -PathType Leaf)){throw 'Trim audit receipt missing.'}
        $receipt=Get-Content -Raw -LiteralPath $Job.TrimPacketAuditReceipt | ConvertFrom-Json
        $artifact=Get-Item -LiteralPath $Job.Output
        if($receipt.version -ne 1 -or $receipt.scope -ne 'completed-artifact' -or
           [long]$receipt.sourceLength -ne [long]$artifact.Length -or
           [long]$receipt.sourceWriteTicks -ne [long]$artifact.LastWriteTimeUtc.Ticks -or
           [long]$receipt.sourceLength -ne [long]$Job.TrimPacketAuditExpectedLength -or
           [long]$receipt.sourceWriteTicks -ne [long]$Job.TrimPacketAuditExpectedTicks){
            throw 'Trim audit output identity changed.'
        }
        $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -show_entries stream=codec_type -of json '+(Quote-NativeArg $Job.Output)) '' 10
        if($probe.ExitCode -ne 0){throw 'Trim audit final stream inventory failed.'}
        $streams=@(($probe.StdOut|ConvertFrom-Json).streams)
        if($streams.Count -gt 64 -or
           @($receipt.videoPacketBytes).Count -ne @($streams | Where-Object {$_.codec_type -eq 'video'}).Count -or
           @($receipt.audioPacketBytes).Count -ne @($streams | Where-Object {$_.codec_type -eq 'audio'}).Count -or
           @($receipt.subtitlePacketBytes).Count -ne @($streams | Where-Object {$_.codec_type -eq 'subtitle'}).Count){
            throw 'Trim audit track ordinals do not match completed output.'
        }
        foreach($bytes in @($receipt.videoPacketBytes)+@($receipt.audioPacketBytes)+@($receipt.subtitlePacketBytes)){
            if($null -eq $bytes -or [long]$bytes -lt 0){throw 'Trim audit packet totals incomplete.'}
        }
        $Job.TrimPacketEvidence=[pscustomobject]@{
            version=1;scope='completed-artifact'
            artifactBytes=[long]$artifact.Length
            artifactWriteTicks=[string]$artifact.LastWriteTimeUtc.Ticks
            artifactJobId=[string]$Job.Id
            videoPacketBytes=@($receipt.videoPacketBytes)
            audioPacketBytes=@($receipt.audioPacketBytes)
            subtitlePacketBytes=@($receipt.subtitlePacketBytes)
        }
        $Job.TrimPacketAuditState='ready'
    }catch{
        $Job.TrimPacketEvidence=$null
        Write-BridgeLog ('Long trim audit unavailable for '+$Job.Id+': '+$_.Exception.Message) 'WARN'
    }finally{
        $proc.Dispose()
    }
    return $Job.TrimPacketEvidence
}

function Get-CompletedTrimPacketEvidence($Job) {
    if(-not $Job.Task){return $null}
    # Actual mixed-mux packet evidence is needed for FLAC even in quality
    # mode, where there is no sizePlan and no copied-trim reserve.
    $needsFlac=@($Job.Task.audioPlan | Where-Object {$_.action -eq 'flac'}).Count -gt 0
    $needsCopy=([bool]$Job.Task.hasTrimRange -and
       [long]$Job.Task.sizePlan.copiedTrimReserveBytes -gt 0)
    if(-not $needsFlac -and -not $needsCopy){return $null}
    if($Job.TrimPacketAuditFinished){
        # Short-output observations are cached as well. Their source artifact
        # must still have the original file stat before any status exposes it.
        if($Job.TrimPacketEvidence){
            try{
                $current=Get-Item -LiteralPath $Job.Output -ErrorAction Stop
                if([long]$current.Length -ne [long]$Job.TrimPacketEvidence.artifactBytes -or
                   [string]$current.LastWriteTimeUtc.Ticks -ne [string]$Job.TrimPacketEvidence.artifactWriteTicks){
                    throw 'Completed audio packet audit artifact has changed.'
                }
            }catch{
                $Job.TrimPacketEvidence=$null
                $Job.TrimPacketAuditState='unavailable'
            }
        }
        return $Job.TrimPacketEvidence
    }
    # Keep the existing synchronous short-output path. Large files do not block
    # /api/jobs; use a separately owned, bounded scan with independent receipt.
    if([double]$Job.ExpectedVideoDuration -gt 180 -or
       (Get-Item -LiteralPath $Job.Output).Length -gt 536870912) {
        return Get-AsyncTrimPacketEvidence $Job
    }
    $Job.TrimPacketAuditFinished=$true
    try{
        $artifactBefore=Get-Item -LiteralPath $Job.Output -ErrorAction Stop
        # One bounded read of the actual staged artifact, never a prediction
        # based on cut duration. A failed audit cannot invalidate an otherwise
        # valid completed encode or relax its strict byte ceiling.
        $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -show_entries stream=index,codec_type -of json '+(Quote-NativeArg $Job.Output)) '' 10
        if($probe.ExitCode -ne 0){throw 'Completed trim output stream probe failed.'}
        $streams=@(($probe.StdOut|ConvertFrom-Json).streams)
        if($streams.Count -gt 64){throw 'Too many streams for bounded trim packet audit.'}
        $video=Measure-AuxiliaryPackets $Job.Output 'v'
        $audio=Measure-AuxiliaryPackets $Job.Output 'a'
        $sub=Measure-AuxiliaryPackets $Job.Output 's'
        $videoBytes=@($streams | Where-Object {$_.codec_type -eq 'video'} | ForEach-Object {
            if($video.ContainsKey([int]$_.index)){$video[[int]$_.index]}else{$null}
        })
        $audioBytes=@($streams | Where-Object {$_.codec_type -eq 'audio'} | ForEach-Object {
            if($audio.ContainsKey([int]$_.index)){$audio[[int]$_.index]}else{$null}
        })
        $subtitleBytes=@($streams | Where-Object {$_.codec_type -eq 'subtitle'} | ForEach-Object {
            if($sub.ContainsKey([int]$_.index)){$sub[[int]$_.index]}else{$null}
        })
        $artifactAfter=Get-Item -LiteralPath $Job.Output -ErrorAction Stop
        if([long]$artifactAfter.Length -ne [long]$artifactBefore.Length -or
           [string]$artifactAfter.LastWriteTimeUtc.Ticks -ne [string]$artifactBefore.LastWriteTimeUtc.Ticks){
            throw 'Completed output file changed during short packet audit.'
        }
        $Job.TrimPacketEvidence=[pscustomobject]@{
            version=1;scope='completed-artifact'
            artifactBytes=[long]$artifactAfter.Length
            artifactWriteTicks=[string]$artifactAfter.LastWriteTimeUtc.Ticks
            artifactJobId=[string]$Job.Id
            videoPacketBytes=$videoBytes
            audioPacketBytes=$audioBytes;subtitlePacketBytes=$subtitleBytes
        }
    }catch{
        Write-BridgeLog ('Trimmed output packet cost audit unavailable for '+$Job.Id+': '+$_.Exception.Message) 'WARN'
        $Job.TrimPacketEvidence=$null
    }
    $Job.TrimPacketAuditState=if($null -ne $Job.TrimPacketEvidence){'ready'}else{'unavailable'}
    return $Job.TrimPacketEvidence
}

function Get-GuidedCompletedBudgetProjection($Job,[long]$ActualBytes) {
    if($Job.Task -or -not $Job.Request -or [string]$Job.Request.mode -ne 'budget-rate'){return $null}
    $request=$Job.Request
    $planned=0L
    $limit=0L
    if(-not [long]::TryParse([string]$request.plannedWholeFileBytes,[ref]$planned) -or $planned -le 0){return $null}
    if(-not [long]::TryParse([string]$request.sizeCeilingBytes,[ref]$limit) -or $limit -le 0){return $null}
    $policy=[string]$Job.SizeBudgetPolicy
    if($policy -notin @('best-effort','two-pass','strict-ceiling')){return $null}
    # Completion and strict output checks run before this receipt is emitted.
    $verified=($policy -eq 'strict-ceiling' -and [bool]$Job.StrictBudget -and
        $Job.BudgetCeiling -eq $limit -and $ActualBytes -le $limit)
    return [pscustomobject]@{
        plannedBytes=$planned;budgetBytes=$limit;policy=$policy
        costBasis=[string]$request.budgetCostBasis
        withinBudget=($ActualBytes -le $limit);strictVerified=$verified
    }
}

function Get-JobStatus([string]$JobId) {
    if(-not $script:Jobs.ContainsKey($JobId)){return [pscustomobject]@{ok=$false;error='Unknown Windows Native job id.'}}
    $j=$script:Jobs[$JobId]

    # Terminal job state must be queryable repeatedly without touching the
    # disposed Process handle. Export-Job intentionally re-reads status after
    # encoding has finished, so terminal snapshots are resolved first.
    if($j.State -eq 'completed'){
        if(-not(Test-GuidedStrictBudget $j)){
            return [pscustomobject]@{ok=$true;state='failed';progress=0;error=$j.Error;message=$j.Error}
        }
        if(-not(Test-Path -LiteralPath $j.Output -PathType Leaf) -or (Get-Item -LiteralPath $j.Output).Length -le 0){
            $j.State='failed';$j.Error='Verified output staging file is missing.'
            Clear-IncompleteJobStaging $j
            return [pscustomobject]@{ok=$true;state='failed';progress=0;error=$j.Error;message=$j.Error}
        }
        Ensure-CompletedJobHistory $j
        if(-not $j.Task -and [double]$j.VerifiedOutputDuration -gt 0){
            # The guided full-output probe already established duration.
            # Avoid redundant FFprobe launches on long-movie status polls.
            $outputDuration=[double]$j.VerifiedOutputDuration
        }else{
            $dur=Invoke-BridgeTool $script:Ffprobe ('-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $j.Output))
            $outputDuration=if($dur.ExitCode -eq 0){[double]::Parse($dur.StdOut.Trim(),[Globalization.CultureInfo]::InvariantCulture)}else{$j.Duration}
        }
        $actualBytes=(Get-Item -LiteralPath $j.Output).Length
        $budgetProjection=Get-GuidedCompletedBudgetProjection $j $actualBytes
        $outputPacketEvidence=Get-CompletedTrimPacketEvidence $j
        return [pscustomobject]@{ok=$true;state='completed';progress=1;outputBytes=$actualBytes;budgetProjection=$budgetProjection;outputPacketEvidence=$outputPacketEvidence;outputPacketAuditState=$j.TrimPacketAuditState;outputDuration=$outputDuration;actualStart=$j.ActualStart;durationDelta=($outputDuration-$j.Duration);videoDecodeSeconds=0;suggestedName=$j.SuggestedName;encoder=$j.Encoder;hardware=$j.Hardware}
    }
    if($j.State -eq 'cancelled'){Clear-IncompleteJobStaging $j;return [pscustomobject]@{ok=$true;state='cancelled';progress=0}}
    if($j.State -eq 'failed'){Clear-IncompleteJobStaging $j;return [pscustomobject]@{ok=$true;state='failed';progress=0;error=$j.Error;message=$j.Error}}

    # Decode validation is a second owned process. Keep the internal encoding
    # lock until it exits, while reporting validating to the UI. Status never
    # waits for the decoder, so the serial Bridge can still handle cancellation.
    if($j.VvcValidating){
        $snapshot=Get-VvcValidationSnapshot $j
        if(-not $snapshot.terminal){return $snapshot}
        $j.State=$snapshot.state;$j.Error=$snapshot.error;$j.VvcValidating=$false
        $j.Started.Process.Dispose()
        Clear-IncompleteJobStaging $j
        return Get-JobStatus $JobId
    }

    $p=$j.Started.Process
    if(-not $p.HasExited){
        $timeMs=0.0
        if(Test-Path -LiteralPath $j.Progress){
            $recent=Get-Content -LiteralPath $j.Progress -Tail 30 -ErrorAction SilentlyContinue
            $line=$recent|Where-Object{$_ -match '^out_time_ms=\d+'}|Select-Object -Last 1
            if($line){$timeMs=([double]($line-replace'^out_time_ms=',''))/1000}
        }
        $progress=if($j.Duration -gt 0){[Math]::Min(0.99,[Math]::Max(0,$timeMs/1000/$j.Duration))}else{0}
        if(($j.Task -and $j.Task.twoPass) -or ($j.Request -and $j.SizeBudgetPolicy -in @('two-pass','strict-ceiling'))){
            $progress=if($j.Phase -eq 1){$progress*.5}else{.5+$progress*.5}
        }
        $elapsed=((Get-Date)-$p.StartTime).TotalSeconds
        $speed=if($elapsed -gt 0){($timeMs/1000)/$elapsed}else{0}
        return [pscustomobject]@{ok=$true;state=if($j.Cancelled){'cancelling'}else{'encoding'};progress=$progress;timeMs=$timeMs;duration=$j.Duration;speed=$speed;encoder=$j.Encoder;hardware=$j.Hardware;actualStart=$j.ActualStart;pass=$j.Phase;totalPasses=if(($j.Task -and $j.Task.twoPass) -or ($j.Request -and $j.SizeBudgetPolicy -in @('two-pass','strict-ceiling'))){2}else{1}}
    }
    $processKey=([string]$p.Id)+':'+([string]$p.StartTime.Ticks)
    if([string]$j.TimedProcessKey -ne $processKey){
        $j.EncodeSeconds += [Math]::Max(.001,($p.ExitTime-$p.StartTime).TotalSeconds)
        $j.TimedProcessKey=$processKey
    }
    if((($j.Task -and $j.Task.twoPass) -or ($j.Request -and $j.SizeBudgetPolicy -in @('two-pass','strict-ceiling'))) -and
        $j.Phase -eq 1 -and -not $j.Cancelled -and $p.ExitCode -eq 0){
        $p.Dispose();Remove-Item -LiteralPath $j.Progress -Force -ErrorAction SilentlyContinue
        try{
            $j.Started=Start-BridgeTool $script:Ffmpeg $j.SecondArgs $j.Work
            $j.Phase=2
            return Get-JobStatus $JobId
        }catch{
            $j.State='failed';$j.Error='Second-pass launch failed: '+$_.Exception.Message
            Remove-Item -LiteralPath $j.Output -Force -ErrorAction SilentlyContinue
            Clear-IncompleteJobStaging $j
            return [pscustomobject]@{ok=$true;state='failed';progress=0;error=$j.Error;message=$j.Error}
        }
    }
    if(-not $j.Finalized){
        $j.Finalized=$true
        $stderr=[string]$j.Started.StdErrTask.Result
        if($j.Cancelled){
            $j.State='cancelled'
            Remove-Item -LiteralPath $j.Output -Force -ErrorAction SilentlyContinue
        }elseif($p.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $j.Output) -or (Get-Item -LiteralPath $j.Output).Length -le 0){
            $j.State='failed';$j.Error=$stderr.Trim()
        }else{
            $check=Invoke-BridgeTool $script:Ffprobe ('-v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $j.Output))
            if($check.ExitCode -ne 0 -or -not $check.StdOut.Trim()){$j.State='failed';$j.Error='FFprobe could not validate the encoded video stream.'}else{
                $j.State='completed'
                if(-not $j.Task -and [int]$j.Request.outputWidth -gt 0) {
                    try{
                        $dimensions=Invoke-BridgeTool $script:Ffprobe ('-v error -select_streams v:0 -show_entries stream=width,height -of json '+(Quote-NativeArg $j.Output))
                        if($dimensions.ExitCode -ne 0){throw 'Guided output size probe failed.'}
                        $videoInfo=$dimensions.StdOut | ConvertFrom-Json
                        $stream=@($videoInfo.streams | Select-Object -First 1)
                        if(-not $stream.Count -or [int]$stream[0].width -ne [int]$j.Request.outputWidth -or
                            [int]$stream[0].height -ne [int]$j.Request.outputHeight){
                            throw 'Guided output resolution differs from adopted calibration branch.'
                        }
                    }catch{$j.State='failed';$j.Error=$_.Exception.Message}
                }
                if($j.State -eq 'completed' -and -not $j.Task){
                    try { Test-GuidedOutputStreams $j }
                    catch { $j.State='failed';$j.Error=$_.Exception.Message }
                }
                if($j.State -eq 'completed' -and $j.Task){
                    try {
                        $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -show_streams -show_format -of json '+(Quote-NativeArg $j.Output))
                        if($probe.ExitCode -ne 0){throw 'Output probe failed.'}
                        $info=$probe.StdOut | ConvertFrom-Json
                        $videos=@($info.streams | Where-Object {$_.codec_type -eq 'video'})
                        $audios=@($info.streams | Where-Object {$_.codec_type -eq 'audio'})
                        $duration=[double]::Parse([string]$info.format.duration,[Globalization.CultureInfo]::InvariantCulture)
                        $expectedVideos=if($null -ne $j.Task.expectedVideoTracks){[int]$j.Task.expectedVideoTracks}else{1}
                        if($videos.Count -ne $expectedVideos -or $audios.Count -ne [int]$j.Task.expectedAudioTracks -or $duration -le 0 -or [Math]::Abs($duration-$j.Duration) -gt 2){throw 'Output stream count/duration validation failed.'}
                        foreach($outVideo in $videos){Test-MediaOutput $j.Task $outVideo}
                        Test-PlannedAudioOutput $j.Task $audios $j.SourceProbe.audioStreams
                        $scan=Invoke-BridgeTool $script:Ffmpeg ('-v error -i '+(Quote-NativeArg $j.Output)+' -map 0:v -map 0:a? -c copy -f null -')
                        if($scan.ExitCode -ne 0){throw 'Output packet scan failed.'}
                    }catch{$j.State='failed';$j.Error=$_.Exception.Message}
                }
            }
        }
        # A strict ceiling is an actual *container byte* acceptance gate,
        # not a bitrate prediction. On miss, leave no staged file available
        # to Export-Job; existing user exports are never modified.
        if($j.State -eq 'completed' -and $j.StrictBudget){
            [void](Test-GuidedStrictBudget $j $true)
        }
        $p.Dispose()
        if($j.State -eq 'completed' -and $j.Encoder -eq 'libvvenc'){
            try{
                $j.Started=Start-BridgeTool $script:Ffmpeg ('-nostdin -v error -xerror -i '+(Quote-NativeArg $j.Output)+' -map 0:v -f null -') $j.Work
                $j.State='encoding';$j.VvcValidating=$true
                return Get-JobStatus $JobId
            }catch{$j.State='failed';$j.Error='VVC validation launch failed: '+$_.Exception.Message}
        }
        Clear-IncompleteJobStaging $j
        if($j.State -eq 'completed'){Ensure-CompletedJobHistory $j}
        if($j.State -eq 'completed'){Write-BridgeLog ("Job "+$JobId+" completed · "+$j.Encoder)}
        elseif($j.State -eq 'cancelled'){Write-BridgeLog ("Job "+$JobId+" cancelled") 'WARN'}
        elseif($j.State -eq 'failed'){Write-BridgeLog ("Job "+$JobId+" failed: "+$j.Error) 'ERROR'}
    }
    if($j.State -eq 'completed'){
        if(-not $j.Task -and [double]$j.VerifiedOutputDuration -gt 0){
            # The guided full-output probe already established duration.
            # Avoid redundant FFprobe launches on long-movie status polls.
            $outputDuration=[double]$j.VerifiedOutputDuration
        }else{
            $dur=Invoke-BridgeTool $script:Ffprobe ('-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $j.Output))
            $outputDuration=if($dur.ExitCode -eq 0){[double]::Parse($dur.StdOut.Trim(),[Globalization.CultureInfo]::InvariantCulture)}else{$j.Duration}
        }
        $actualBytes=(Get-Item -LiteralPath $j.Output).Length
        $budgetProjection=Get-GuidedCompletedBudgetProjection $j $actualBytes
        $outputPacketEvidence=Get-CompletedTrimPacketEvidence $j
        return [pscustomobject]@{ok=$true;state='completed';progress=1;outputBytes=$actualBytes;budgetProjection=$budgetProjection;outputPacketEvidence=$outputPacketEvidence;outputPacketAuditState=$j.TrimPacketAuditState;outputDuration=$outputDuration;actualStart=$j.ActualStart;durationDelta=($outputDuration-$j.Duration);videoDecodeSeconds=0;suggestedName=$j.SuggestedName;encoder=$j.Encoder;hardware=$j.Hardware}
    }
    if($j.State -eq 'cancelled'){return [pscustomobject]@{ok=$true;state='cancelled';progress=0}}
    return [pscustomobject]@{ok=$true;state='failed';progress=0;error=$j.Error;message=$j.Error}
}


# WU05: optional read-only FIRST-boundary output-clock evidence. Bounded
# FFprobe sampling is NOT full source packet identity or A/V sync proof.
function Get-CutTimelineEvidence([string]$JobId){
  if(-not $script:Jobs.ContainsKey($JobId)){throw 'Unknown Native job id.'}
  $j=$script:Jobs[$JobId]
  if(-not $j.Task -or [string]$j.Task.operation -ne 'copy' -or
     -not [bool]$j.Task.hasTrimRange){throw 'Timeline receipt is available only for copy-trim jobs.'}
  $status=Get-JobStatus $JobId
  if($status.state -ne 'completed'){throw 'Completed cut is required for output timeline inspection.'}
  $before=Get-Item -LiteralPath $j.Output -ErrorAction Stop
  if($before.Length -le 0){throw 'Completed output is empty.'}
  $file=Quote-NativeArg $j.Output
  $frames=Invoke-BridgeTool $script:Ffprobe (
    '-v error -select_streams v:0 -read_intervals '+(Quote-NativeArg '%+#128')+
    ' -show_frames -show_entries frame=best_effort_timestamp_time -of json '+$file
  ) '' 18
  if($frames.ExitCode -ne 0){throw 'First decoded frame probe failed.'}
  $firstFrame=$null
  foreach($frame in @(($frames.StdOut|ConvertFrom-Json).frames)){
    $value=0.0
    if([double]::TryParse([string]$frame.best_effort_timestamp_time,
      [Globalization.NumberStyles]::Float,
      [Globalization.CultureInfo]::InvariantCulture,[ref]$value) -and
      -not [double]::IsNaN($value)){
      $firstFrame=$value;break
    }
  }
  if($null -eq $firstFrame){throw 'No decoded video presentation observed within first 128 packets.'}
  $video=Invoke-BridgeTool $script:Ffprobe (
    '-v error -select_streams v:0 -read_intervals '+(Quote-NativeArg '%+#64')+
    ' -show_packets -show_entries packet=pts_time,dts_time -of json '+$file
  ) '' 15
  if($video.ExitCode -ne 0){throw 'First video packet probe failed.'}
  $firstVideo=@(($video.StdOut|ConvertFrom-Json).packets|Where-Object{
    $_.pts_time -ne $null -and $_.dts_time -ne $null
  })|Select-Object -First 1
  if(-not $firstVideo){throw 'First encoded video packet with PTS and DTS was not observed.'}
  $streamProbe=Invoke-BridgeTool $script:Ffprobe (
    '-v error -show_entries stream=index,codec_type -of json '+$file
  ) '' 12
  if($streamProbe.ExitCode -ne 0){throw 'Output stream inventory failed.'}
  $audioStreams=@(($streamProbe.StdOut|ConvertFrom-Json).streams|Where-Object{$_.codec_type -eq 'audio'})
  if($audioStreams.Count -gt 8){throw 'Audio timestamp report supports at most eight output audio streams.'}
  $audio=@()
  for($n=0;$n -lt $audioStreams.Count;$n++){
    $packets=Invoke-BridgeTool $script:Ffprobe (
      '-v error -select_streams a:'+$n+
      ' -read_intervals '+(Quote-NativeArg '%+#32')+
      ' -show_packets -show_entries packet=pts_time,dts_time -of json '+$file
    ) '' 12
    if($packets.ExitCode -ne 0){throw 'Output audio first-packet scan failed.'}
    $packet=@(($packets.StdOut|ConvertFrom-Json).packets|Where-Object{
      $_.pts_time -ne $null -and $_.dts_time -ne $null
    })|Select-Object -First 1
    if(-not $packet){throw 'Output audio first packet unavailable.'}
    $audio+=@{outputOrdinal=$n;outputFirstPts=[double]::Parse([string]$packet.pts_time,
      [Globalization.CultureInfo]::InvariantCulture);
      outputFirstDts=[double]::Parse([string]$packet.dts_time,
      [Globalization.CultureInfo]::InvariantCulture)}
  }
  $after=Get-Item -LiteralPath $j.Output -ErrorAction Stop
  if([long]$before.Length -ne [long]$after.Length -or
    [long]$before.LastWriteTimeUtc.Ticks -ne [long]$after.LastWriteTimeUtc.Ticks){
    throw 'Completed artifact changed while probing its output timeline.'
  }
  return [pscustomobject]@{
    ok=$true;version=1;scope='completed-artifact-first-boundary'
    jobId=$JobId;artifactBytes=[long]$after.Length
    artifactWriteTicks=[string]$after.LastWriteTimeUtc.Ticks
    requestedIn=[double]$j.Task.start;requestedOut=[double]$j.Task.end
    executionSeekIn=[double]$j.ActualStart
    actualFirstPresentation=[double]$firstFrame
    firstVideoPacketPts=[double]::Parse([string]$firstVideo.pts_time,[Globalization.CultureInfo]::InvariantCulture)
    firstVideoPacketDts=[double]::Parse([string]$firstVideo.dts_time,[Globalization.CultureInfo]::InvariantCulture)
    audioTimeMapping=@($audio)
    copiedPacketRange=$null
    verificationStatus='output-first-boundary-observed-source-packet-and-sync-unverified'
  }
}

function Arm-CiExportFault([string]$Mode) {
    # Runner-only. No filename/path can be specified by this endpoint.
    if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP -or
       -not $script:CiSaveDirectory -or
       -not $script:CiSaveDirectory.StartsWith(
          [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char]92,[char]47)+[IO.Path]::DirectorySeparatorChar,
          [StringComparison]::OrdinalIgnoreCase)){
        throw 'CI export fault is disabled outside the approved runner fixture.'
    }
    if($Mode -notin @('cancel','publish-denied')){
        throw 'Unknown CI export fault mode.'
    }
    if($script:CiNextExportFault){throw 'CI export fault already armed.'}
    $script:CiNextExportFault=$Mode
    return [pscustomobject]@{ok=$true;armed=$Mode}
}

function Export-Job([string]$JobId,[string]$SuggestedName) {
    if(-not $script:Jobs.ContainsKey($JobId)){throw 'Unknown job.'}
    $j=$script:Jobs[$JobId]
    $status=Get-JobStatus $JobId
    if($status.state -ne 'completed'){throw 'Job is not completed.'}
    $ext=if($j.OutputExtension){[string]$j.OutputExtension}else{'mkv'}
    $filter=if($ext -eq 'mp4'){'MP4 video|*.mp4'}else{'Matroska video|*.mkv'}
    $name=if($SuggestedName){$SuggestedName}else{$j.SuggestedName}
    $dest=Show-NativeSaveFileDialog $filter $ext $name
    if($script:CiNextExportFault -eq 'cancel'){
        $script:CiNextExportFault=''
        $dest=''
    }
    if(-not $dest){return [pscustomobject]@{ok=$false;jobId=$JobId;cancelled=$true;error='Save cancelled.'}}
    # Native save dialogs are modal: the original status check may be stale
    # by the time the user chooses a destination.
    $status=Get-JobStatus $JobId
    if($status.state -ne 'completed'){throw 'Staged job became invalid while choosing the export destination.'}
    $dir=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($dest))
    $temp=Join-Path $dir ('.'+[IO.Path]::GetFileName($dest)+'.quick-hardsub-'+[guid]::NewGuid().ToString('N')+'.tmp')
    try{
        # Every job, including non-strict Manual/CRF, must publish only
        # byte-identical contents of the verified staged output. The strict
        # path additionally matches its earlier ceiling-approval SHA.
        $approved=Get-GuidedContainerFingerprint $j.Output
        if([long]$approved.Length -ne [long]$status.outputBytes){
            throw 'Staged container bytes changed since completed-job verification.'
        }
        if($j.StrictBudget -and $approved.Hash -ne $j.StrictVerifiedHash){
            throw 'Strict staged content changed after budget approval.'
        }
        Copy-Item -LiteralPath $j.Output -Destination $temp -Force
        $status=Get-JobStatus $JobId
        if($status.state -ne 'completed'){throw 'Staged output changed during export copy.'}
        $after=Get-GuidedContainerFingerprint $j.Output
        $copied=Get-GuidedContainerFingerprint $temp
        if($after.Length -ne $approved.Length -or $after.Hash -ne $approved.Hash -or
           $copied.Length -ne $approved.Length -or $copied.Hash -ne $approved.Hash -or
           [long]$status.outputBytes -ne [long]$copied.Length){
            throw 'Export copy differs from the verified staged container.'
        }
        if($j.StrictBudget -and
           ($copied.Length -gt [long]$j.BudgetCeiling -or
            $copied.Hash -ne $j.StrictVerifiedHash)){
            throw 'Strict export bytes or fingerprint no longer match budget approval.'
        }
        # Runner-only deterministic denial AFTER staging and SHA verification,
        # BEFORE touching the user's existing destination.
        if($script:CiNextExportFault -eq 'publish-denied'){
            $script:CiNextExportFault=''
            throw 'CI-only publish denied after verified temporary copy.'
        }
        Publish-VerifiedOutput $temp $dest
    }finally{
        if(Test-Path -LiteralPath $temp -PathType Leaf){
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        }
    }
    return [pscustomobject]@{ok=$true;jobId=$JobId;bytes=(Get-Item -LiteralPath $dest).Length;sha256=$approved.Hash.ToLowerInvariant();path=$dest}
}

function Export-Sample([string]$SampleId,[string]$SuggestedName) {
    if(-not $script:Samples.ContainsKey($SampleId)){throw 'Unknown sample.'}
    $src=$script:Samples[$SampleId]
    if(-not(Test-Path -LiteralPath $src)){throw 'Sample file is missing.'}
    $name=if($SuggestedName){$SuggestedName}else{'hardsub_test.mkv'}
    $dest=Show-NativeSaveFileDialog 'Matroska video|*.mkv' 'mkv' $name
    if(-not $dest){return [pscustomobject]@{ok=$false;error='Save cancelled.'}}
    Copy-Item -LiteralPath $src -Destination $dest -Force
    $bytes=(Get-Item -LiteralPath $dest).Length
    return [pscustomobject]@{ok=$true;bytes=$bytes}
}

function Read-HttpRequest($Client) {
    $stream=$Client.GetStream()
    $headerBytes = New-Object 'System.Collections.Generic.List[byte]'
    $matched = 0
    while($headerBytes.Count -lt 65536){
        $value = $stream.ReadByte()
        if($value -lt 0){break}
        $b = [byte]$value
        $headerBytes.Add($b)
        if(($matched -eq 0 -and $b -eq 13) -or
           ($matched -eq 1 -and $b -eq 10) -or
           ($matched -eq 2 -and $b -eq 13) -or
           ($matched -eq 3 -and $b -eq 10)){
            $matched++
            if($matched -eq 4){break}
        }else{
            $matched = if($b -eq 13){1}else{0}
        }
    }
    if($headerBytes.Count -eq 0){return $null}
    if($matched -ne 4){throw 'Malformed HTTP request headers.'}

    $headerText=[Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
    $lines=$headerText -split "\r\n"
    $requestLine=$lines[0]
    $parts=$requestLine.Split(' ')
    if($parts.Count -lt 2){throw 'Malformed HTTP request line.'}

    $headers=@{}
    foreach($line in $lines[1..($lines.Count-1)]){
        if(-not $line){continue}
        $idx=$line.IndexOf(':')
        if($idx -gt 0){$headers[$line.Substring(0,$idx).Trim().ToLowerInvariant()]=$line.Substring($idx+1).Trim()}
    }

    $length=0
    if($headers.ContainsKey('content-length')){[void][int]::TryParse($headers['content-length'],[ref]$length)}
    if($length -lt 0 -or $length -gt 64MB){throw 'HTTP request body exceeds bridge safety limit.'}
    $body=''
    if($length -gt 0){
        $bodyBytes=New-Object byte[] $length
        $read=0
        while($read -lt $length){
            $n=$stream.Read($bodyBytes,$read,$length-$read)
            if($n -le 0){break}
            $read+=$n
        }
        if($read -ne $length){throw 'Incomplete HTTP request body.'}
        $body=[Text.Encoding]::UTF8.GetString($bodyBytes)
    }
    return [pscustomobject]@{Method=$parts[0];Path=$parts[1].Split('?')[0];Headers=$headers;Body=$body;Stream=$stream}
}

function Send-HttpJson($Request,[int]$Status,$Payload) {
    # HTTP 204 (including browser CORS/PNA preflight) MUST NOT contain a
    # response body or Content-Length. Chromium can reject malformed 204
    # framing even when a direct Node/PowerShell GET health check succeeds.
    $bytes=if($Status -eq 204){[byte[]]@()}else{[Text.Encoding]::UTF8.GetBytes((ConvertTo-JsonUtf8 $Payload))}
    $origin=if($Request.Headers.ContainsKey('origin')){$Request.Headers['origin']}else{''}
    $allowOrigin=if($origin -eq $script:AllowedOrigin -or $origin -match '^http://(127\.0\.0\.1|localhost)(:\d+)?$'){$origin}else{$script:AllowedOrigin}
    $reason=if($Status -eq 200){'OK'}elseif($Status -eq 204){'No Content'}elseif($Status -eq 403){'Forbidden'}elseif($Status -eq 404){'Not Found'}else{'Error'}
    $crlf=[Environment]::NewLine
    $head='HTTP/1.1 '+$Status+' '+$reason+$crlf+
        'Content-Type: application/json; charset=utf-8'+$crlf+
        $(if($Status -ne 204){'Content-Length: '+$bytes.Length+$crlf}else{''})+
        'Access-Control-Allow-Origin: '+$allowOrigin+$crlf+
        'Access-Control-Allow-Headers: Content-Type, X-Quick-Hardsub-Token'+$crlf+
        'Access-Control-Allow-Methods: GET, POST, OPTIONS'+$crlf+
        'Access-Control-Allow-Private-Network: true'+$crlf+
        'Cache-Control: no-store'+$crlf+
        'Connection: close'+$crlf+$crlf
    $headBytes=[Text.Encoding]::ASCII.GetBytes($head)
    $Request.Stream.Write($headBytes,0,$headBytes.Length)
    if($bytes.Length){$Request.Stream.Write($bytes,0,$bytes.Length)}
    $Request.Stream.Flush()
}

function Handle-Request($Request) {
    if($Request.Method -eq 'OPTIONS'){Send-HttpJson $Request 204 @{};return}
    $origin=if($Request.Headers.ContainsKey('origin')){$Request.Headers['origin']}else{''}
    if($origin -and $origin -ne $script:AllowedOrigin -and $origin -notmatch '^http://(127\.0\.0\.1|localhost)(:\d+)?$'){Send-HttpJson $Request 403 @{ok=$false;error='Origin rejected.'};return}
    $token=if($Request.Headers.ContainsKey('x-quick-hardsub-token')){$Request.Headers['x-quick-hardsub-token']}else{''}
    if($token -ne $script:Token){Send-HttpJson $Request 403 @{ok=$false;error='Invalid bridge token.'};return}
    try{
        $body=if($Request.Body){$Request.Body|ConvertFrom-Json}else{$null}
        $path=$Request.Path
        $quietRequest = $path -eq '/api/health' -or $path -eq '/api/history' -or
            $path -eq '/api/preview' -or $path -eq '/api/frame' -or
            ($Request.Method -eq 'GET' -and $path -match '^/api/jobs/[A-Za-z0-9]+$') -or
            ($Request.Method -eq 'GET' -and $path -match '^/api/import-jobs/[A-Za-z0-9]+$')
        if(-not $quietRequest){Write-BridgeLog ($Request.Method+' '+$path)}
        if($Request.Method -eq 'GET' -and $path -eq '/api/health'){Send-HttpJson $Request 200 (Get-BackendInfo);return}
        if($Request.Method -eq 'GET' -and $path -eq '/api/self-test'){Send-HttpJson $Request 200 (Get-SelfTest);return}
        if($Request.Method -eq 'GET' -and $path -eq '/api/history'){Send-HttpJson $Request 200 (Get-CompressionHistorySnapshot);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/history'){Send-HttpJson $Request 200 (Add-ClientCompressionEvidence $body.record);return}
        if($Request.Method -eq 'POST' -and $path -match '^/api/pick/(video|ass|fonts)$'){Send-HttpJson $Request 200 (Show-BridgePicker $Matches[1]);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/batch/videos/pick'){Send-HttpJson $Request 200 (Select-BridgeBatchVideos);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/batch/videos/activate'){Send-HttpJson $Request 200 (Activate-BridgeBatchVideo ([string]$body.id));return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/ci/export-fault'){Send-HttpJson $Request 200 (Arm-CiExportFault ([string]$body.mode));return}
        if($Request.Method -eq 'GET' -and $path -eq '/api/selection/video'){
            $p=Get-OriginalVideoPath
            if(-not $p -or -not(Test-Path -LiteralPath $p -PathType Leaf)){Send-HttpJson $Request 200 @{ok=$false;error='No video selected.'};return}
            $item=Get-Item -LiteralPath $p
            $modified=[DateTimeOffset]$item.LastWriteTimeUtc
            Send-HttpJson $Request 200 @{ok=$true;name=$item.Name;size=$item.Length;lastModified=$modified.ToUnixTimeMilliseconds()};return
        }
        if($Request.Method -eq 'GET' -and $path -eq '/api/selection/ass'){
            $p=Get-SelectedPath 'ass';if(-not $p){throw 'No ASS selected.'};$item=Get-Item -LiteralPath $p
            Send-HttpJson $Request 200 @{ok=$true;name=$item.Name;size=$item.Length;base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($p))};return
        }
        if($Request.Method -eq 'POST' -and $path -eq '/api/source-budget'){Send-HttpJson $Request 200 (Get-SourceBudgetEvidence);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/trim-copy-preflight'){Send-HttpJson $Request 200 (Start-IsolatedTrimPreflight $body);return}
        if($Request.Method -eq 'GET' -and $path -eq '/api/trim-copy-preflight'){Send-HttpJson $Request 200 (Get-IsolatedTrimPreflightStatus);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/flac-encode-preflight'){Send-HttpJson $Request 200 (Start-FlacEncodePreflight $body);return}
        if($Request.Method -eq 'GET' -and $path -eq '/api/flac-encode-preflight'){Send-HttpJson $Request 200 (Get-FlacEncodePreflightStatus);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/probe'){Send-HttpJson $Request 200 (Get-ProbeMedia);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/embedded-ass'){Send-HttpJson $Request 200 (Import-BridgeEmbeddedAss $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/import/bink2'){Send-HttpJson $Request 200 (Start-Bink2ImportJob);return}
        if($Request.Method -eq 'GET' -and $path -match '^/api/import-jobs/([A-Za-z0-9]+)$'){Send-HttpJson $Request 200 (Get-Bink2ImportJobStatus $Matches[1]);return}
        if($Request.Method -eq 'POST' -and $path -match '^/api/import-jobs/([A-Za-z0-9]+)/cancel$'){Send-HttpJson $Request 200 (Cancel-Bink2ImportJob $Matches[1]);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/preview'){Send-HttpJson $Request 200 (Invoke-Preview $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/frame'){Send-HttpJson $Request 200 (Invoke-Frame $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/waveform'){Send-HttpJson $Request 200 (Invoke-Waveform $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/sample'){Send-HttpJson $Request 200 (Invoke-Sample $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/sample/export'){Send-HttpJson $Request 200 (Export-Sample ([string]$body.sampleId) ([string]$body.suggestedName));return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/encode'){Send-HttpJson $Request 200 (Start-EncodeJob $body);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)$' -and $Request.Method -eq 'GET'){Send-HttpJson $Request 200 (Get-JobStatus $Matches[1]);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/cancel$' -and $Request.Method -eq 'POST'){
            $id=$Matches[1]
            Send-HttpJson $Request 200 (Cancel-EncodeJob $id);return
        }
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/cut-timeline$' -and $Request.Method -eq 'GET'){Send-HttpJson $Request 200 (Get-CutTimelineEvidence $Matches[1]);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/frame$' -and $Request.Method -eq 'POST'){Send-HttpJson $Request 200 (Invoke-OutputFrame $Matches[1] $body);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/reference-frame$' -and $Request.Method -eq 'POST'){Send-HttpJson $Request 200 (Invoke-HardsubReferenceFrame $Matches[1] $body);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/export$' -and $Request.Method -eq 'POST'){Send-HttpJson $Request 200 (Export-Job $Matches[1] ([string]$body.suggestedName));return}
        Send-HttpJson $Request 404 @{ok=$false;error='Unknown bridge endpoint.'}
    }catch{
        Write-BridgeLog ($Request.Method+' '+$Request.Path+' failed: '+$_.Exception.Message) 'ERROR'
        Send-HttpJson $Request 500 @{ok=$false;error=$_.Exception.Message}
    }
}

# CI-only two-source fixture is restricted to the runner's own temporary
# subtree. Ordinary applications cannot authorize paths through HTTP.
if($requestedCiBatchVideoSeedList){
    if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){
        throw 'Native batch seed requires GitHub Actions.'
    }
    $root=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char]92,[char]47)+[IO.Path]::DirectorySeparatorChar
    $seeds=@($requestedCiBatchVideoSeedList.Split([char]124))
    if($seeds.Count -lt 2 -or $seeds.Count -gt 8){
        throw 'CI batch seed requires 2-8 files.'
    }
    foreach($seedPath in $seeds){
        $full=[IO.Path]::GetFullPath($seedPath)
        if(-not $full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or
           -not(Test-Path -LiteralPath $full -PathType Leaf)){
            throw 'CI batch file must exist under RUNNER_TEMP.'
        }
    }
    $script:CiBatchPickerResult=Register-BridgeBatchVideos $seeds
    Write-BridgeLog ('CI-only Native batch preauthorized sources: '+$seeds.Count)
}

if(-not $script:Ffmpeg -or -not $script:Ffprobe){
    Write-BridgeLog 'FFmpeg / FFprobe was not found. Install Gyan.FFmpeg or place the toolchain under tools\ffmpeg\bin.' 'ERROR'
    [Windows.Forms.MessageBox]::Show('Windows Native Bridge requires ffmpeg.exe and ffprobe.exe. Install Gyan.FFmpeg with winget or place them in tools\ffmpeg\bin.','Quick Hardsub - FFmpeg missing')|Out-Null
    exit 2
}

$listener=$null
for($candidate=$Port;$candidate -lt ($Port+20);$candidate++){
    try{$listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$candidate);$listener.Start();$Port=$candidate;break}catch{$listener=$null}
}
if(-not $listener){throw 'Could not bind a localhost port for Windows Native Bridge.'}

Write-BridgeLog ("Bridge ready: http://127.0.0.1:"+$Port)
Write-BridgeLog ("FFmpeg: "+$script:Ffmpeg)
if($script:Capabilities){
    Write-BridgeLog ("FFmpeg version: "+$script:Capabilities.FfmpegVersion+" · source: "+$script:Capabilities.FfmpegSource)
    Write-BridgeLog ("CPU: "+$script:Capabilities.Cpu)
    $gpus=@($script:Capabilities.Gpus | Where-Object { $_ })
    Write-BridgeLog ("GPU: "+$(if($gpus.Count){$gpus -join ' / '}else{'not detected'}))
    $available=@($script:Capabilities.Encoders | Where-Object { $_.Available } | ForEach-Object { $_.Key })
    Write-BridgeLog ("Encoders: "+$(if($available.Count){$available -join ' / '}else{'none'}))
}
if($script:RadVideo){
    Write-BridgeLog ("Bink 2 import adapter: "+$script:RadVideo.Label+" · source: "+$script:RadVideo.Source)
}else{
    Write-BridgeLog 'Bink 2 import adapter: RAD Video Tools not detected; .bk2 files will be identified but cannot be decoded automatically.' 'WARN'
}
Write-BridgeLog 'Keep this window open while using Windows Native. Closing it disconnects the local backend.'
Write-Host ''

$launch='https://11576865.github.io/Quick-Automatic-Hardsub-Encoder/?windowsNative='+[uri]::EscapeDataString("http://127.0.0.1:$Port")+'&token='+[uri]::EscapeDataString($script:Token)
if(-not $NoBrowser){
    Write-BridgeLog 'Opening the Web UI and handing it this session token.'
    Start-Process $launch|Out-Null
}

try{
    while($true){
        $client=$listener.AcceptTcpClient()
        try{$request=Read-HttpRequest $client;if($request){Handle-Request $request}}catch{}finally{$client.Close()}
    }
}finally{
    try{$listener.Stop()}catch{}
    foreach($j in $script:Jobs.Values){
        try{if($j.State -eq 'encoding'){[void](Cancel-EncodeJob $j.Id)}else{Clear-IncompleteJobStaging $j}}catch{}
    }
    foreach($j in $script:ImportJobs.Values){
        try{if($j.State -eq 'importing' -and -not $j.Started.Process.HasExited){$j.Started.Process.Kill()}}catch{}
        try{if($j.Work -and (Test-Path -LiteralPath $j.Work)){Remove-Item -LiteralPath $j.Work -Recurse -Force -ErrorAction SilentlyContinue}}catch{}
    }
    Clear-Bink2ImportStaging
}
