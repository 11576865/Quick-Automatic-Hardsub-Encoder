param(
    [int]$Port = 8766,
    [switch]$NoBrowser,
    [string]$Token = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'native-backend.ps1')
. (Join-Path $PSScriptRoot 'output-safety.ps1')
. (Join-Path $PSScriptRoot 'media-task.ps1')
. (Join-Path $PSScriptRoot 'compression-history.ps1')

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
$script:Jobs = @{}
$script:Samples = @{}
$script:Ffmpeg = Find-NativeTool 'ffmpeg' $PSScriptRoot
$script:Ffprobe = Find-NativeTool 'ffprobe' $PSScriptRoot
$script:Capabilities = if ($script:Ffmpeg) { Get-NativeCapabilities $script:Ffmpeg $script:Ffprobe $PSScriptRoot } else { $null }

function ConvertTo-JsonUtf8($Object) {
    return ($Object | ConvertTo-Json -Depth 12 -Compress)
}

function Invoke-BridgeTool([string]$Exe, [string]$Arguments, [string]$WorkingDirectory = '') {
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

function Get-SelectedPath([string]$Role) {
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

function Show-BridgePicker([string]$Role) {
    $picked = @()
    if ($Role -eq 'video') {
        $picked = @(Show-NativeOpenFileDialog 'Video files|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.ts;*.m2ts|All files|*.*')
        if ($picked.Count) { $script:Selections.video = @($picked[0]) }
    } elseif ($Role -eq 'ass') {
        $picked = @(Show-NativeOpenFileDialog 'ASS subtitles|*.ass|All files|*.*')
        if ($picked.Count) { $script:Selections.ass = @($picked[0]) }
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
        bridgeVersion=5
        taskSchemaVersion=3
        fpsModeSupported=[bool]$script:Capabilities.FpsModeSupported
        globalOptions=[object[]]$script:Capabilities.GlobalOptions
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
    if ($Profile.Hardware) {
        $cq = [int]($Options.crf)
        if ($cq -lt 0) { $cq = [int]$Profile.Quality }
        $tune = if ($Profile.Tune) { $Profile.Tune } else { 'hq' }
        if ($targetRate -gt 0) {
            return "-c:v $($Profile.Encoder) -preset p7 -tune $tune -rc vbr -b:v $targetRate -maxrate $targetRate -bufsize $($targetRate * 2)"
        }
        $multipass = if ($Profile.SupportsMultipassFullres) { ' -multipass fullres' } else { '' }
        return "-c:v $($Profile.Encoder) -preset p7 -tune $tune -rc vbr -cq $cq -b:v 0$multipass"
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
    $video = Get-SelectedPath 'video'
    if (-not $video) { throw 'No video selected.' }
    $r = Invoke-BridgeTool $script:Ffprobe ('-v error -show_format -show_streams -of json ' + (Quote-NativeArg $video))
    if ($r.ExitCode -ne 0) { throw ($r.StdErr.Trim()) }
    $json = $r.StdOut | ConvertFrom-Json
    $v = @($json.streams | Where-Object { $_.codec_type -eq 'video' }) | Select-Object -First 1
    if (-not $v) { throw 'FFprobe found no video stream.' }
    $audios = @($json.streams | Where-Object { $_.codec_type -eq 'audio' })
    $pix = [string]$v.pix_fmt
    $bitDepth = if ($v.bits_per_raw_sample -as [int]) { [int]$v.bits_per_raw_sample } elseif ($pix -match '(10|12|14|16)(?:le|be)?') { [int]$Matches[1] } else { 8 }
    $transfer = [string]$v.color_transfer
    $primaries = [string]$v.color_primaries
    $hdr = ($transfer -match 'smpte2084|arib-std-b67') -or (($primaries -match 'bt2020') -and $bitDepth -gt 8)
    $duration = [double]($json.format.duration)
    $decode = Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -loglevel error -ss 0 -i ' + (Quote-NativeArg $video) + ' -map 0:v:0 -frames:v 1 -f null NUL')
    $audioRate = 0L
    foreach($a in $audios){ if($a.bit_rate){ $audioRate += [long]$a.bit_rate } }
    return [pscustomobject]@{
        ok=$true; seekable=$true; statSize=(Get-Item -LiteralPath $video).Length
        inputDecodeSmoke=($decode.ExitCode -eq 0); inputDecodeError=$decode.StdErr.Trim()
        format=[string]$json.format.format_name; duration=$duration; bitRate=[long]($json.format.bit_rate)
        videoCodec=[string]$v.codec_name; videoBitRate=if($v.bit_rate){[long]$v.bit_rate}else{0}
        width=[int]$v.width; height=[int]$v.height; fps=[string]$v.avg_frame_rate
        pixelFormat=$pix; bitDepth=$bitDepth; colorTransfer=$transfer; colorPrimaries=$primaries
        colorSpace=[string]$v.color_space; hdr=$hdr; unsafeColorPipeline=($hdr -or $bitDepth -gt 8)
        audioTracks=$audios.Count; audioCodec=if($audios.Count){[string]$audios[0].codec_name}else{''}; audioCodecs=@($audios | ForEach-Object { [string]$_.codec_name }); audioBitRate=$audioRate
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
    $work = New-BridgeWorkDir 'quick-hardsub-frame-'
    try {
        $output = Join-Path $work 'frame.png'
        $timeText = $time.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $args = '-hide_banner -loglevel error -y -ss ' + $timeText +
            ' -i ' + (Quote-NativeArg $video) +
            ' -map 0:v:0 -an -sn -frames:v 1 -vf scale=' + $width + ':-2:force_original_aspect_ratio=decrease -c:v png ' +
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
        $cmd='-hide_banner -loglevel error -y -ss '+$timeText+
            ' -i '+(Quote-NativeArg $job.Source)+
            ' -map 0:v:0 -an -sn -frames:v 1 -vf '+(Quote-NativeArg $filter)+' -c:v png '+(Quote-NativeArg $output)
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
    $width = [Math]::Max(512, [Math]::Min(4096, $(if($Body.width){[int]$Body.width}else{2048})))
    $height = [Math]::Max(96, [Math]::Min(320, $(if($Body.height){[int]$Body.height}else{160})))
    $duration = if($Body.duration){[double]$Body.duration}else{0.0}
    $includeKeyframes = [bool]$Body.includeKeyframes
    $maxKeyframes = [Math]::Max(256,[Math]::Min(50000,$(if($Body.maxKeyframes){[int]$Body.maxKeyframes}else{12000})))
    $keyframes = New-Object System.Collections.Generic.List[double]
    $keyframesTruncated = $false

    if($includeKeyframes){
        $probe = Invoke-BridgeTool $script:Ffprobe (
            '-v error -select_streams v:0 -skip_frame nokey -show_frames ' +
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
function Get-Ssim([string]$Candidate,[string]$Reference,[string]$Work) {
    $r=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -nostdin -i '+(Quote-NativeArg $Candidate)+' -i '+(Quote-NativeArg $Reference)+' -lavfi "[0:v][1:v]ssim" -f null NUL') $Work
    $m=[regex]::Match(($r.StdErr+[Environment]::NewLine+$r.StdOut),'All:(?<v>[0-9.]+)')
    if($m.Success){return [double]::Parse($m.Groups['v'].Value,[Globalization.CultureInfo]::InvariantCulture)}
    return $null
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

function Invoke-Sample($Body) {
    $video=Get-SelectedPath 'video'
    if(-not $video){throw 'No video selected.'}
    $o=$Body.options
    $profile=Get-PreferredEncoder ([string]$o.codec)
    if(-not $profile){throw 'No available Windows Native encoder for this codec.'}
    $duration=[double]$o.duration
    if($duration -le 0 -or $duration -gt 8){throw 'Sample duration must be between 0 and 8 seconds.'}
    $start=[Math]::Max(0,[double]$o.start)
    $work=New-BridgeWorkDir 'quick-hardsub-sample-'
    $sampleId=[guid]::NewGuid().ToString('N')
    try{
        $withSubs=[bool]$o.withSubtitles
        if($withSubs){Stage-BridgeAssets $work ([string]$Body.assText)}
        $reference=Join-Path $work 'reference.mkv'
        $candidate=Join-Path $work 'sample.mkv'
        $startText=$start.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $durationText=$duration.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $vf=if($withSubs){' -vf "ass=subtitle.ass:fontsdir=fonts"'}else{''}
        $rr=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -loglevel error -y -ss '+$startText+' -t '+$durationText+' -i '+(Quote-NativeArg $video)+' -an -sn'+$vf+' -c:v ffv1 '+(Quote-NativeArg $reference)) $work
        if($rr.ExitCode -ne 0){throw ($rr.StdErr.Trim())}
        $encArgs=Get-BridgeEncoderArgs $profile $o
        $sw=[Diagnostics.Stopwatch]::StartNew()
        $run=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -loglevel error -y -ss '+$startText+' -t '+$durationText+' -i '+(Quote-NativeArg $video)+' -an -sn'+$vf+' '+$encArgs+' -pix_fmt yuv420p '+(Quote-NativeArg $candidate)) $work
        $sw.Stop()
        if($run.ExitCode -ne 0 -or -not(Test-Path $candidate)){throw ($run.StdErr.Trim())}
        $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $candidate))
        $measured=if($probe.ExitCode -eq 0){[double]::Parse($probe.StdOut.Trim(),[Globalization.CultureInfo]::InvariantCulture)}else{$duration}
        $packets=Get-PacketStats $candidate
        $ssim=if([bool]$o.measureSsim){Get-Ssim $candidate $reference $work}else{$null}
        $sampleBytes=(Get-Item $candidate).Length
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
        }
    }finally{Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
}

function Start-MediaTaskJob($Body) {
    foreach($existing in $script:Jobs.Values){if($existing.State -eq 'encoding' -and -not $existing.Started.Process.HasExited){throw 'A Native job is already running.'}}
    $request=$Body.request; $task=$request.task
    $outputArgs=Get-MediaTaskArgs $task
    $video=Get-SelectedPath 'video'
    if(-not $video){throw 'No video selected.'}
    $probe=Get-ProbeMedia
    if($task.operation -ne 'copy' -and $probe.unsafeColorPipeline){throw 'HDR/high-bit-depth transcode is not validated.'}
    if([double]$task.end -gt [double]$probe.duration + 0.1){throw 'Range exceeds source duration.'}
    $codecIndex=[Array]::IndexOf($outputArgs,'-c:v')
    $encoder=$outputArgs[$codecIndex+1]
    if($encoder -ne 'copy'){
        $profile=@($script:Capabilities.Encoders | Where-Object { $_.Key -eq $encoder -and $_.Available }) | Select-Object -First 1
        if(-not $profile){throw 'Selected encoder is unavailable; no automatic substitution.'}
        if($profile.PixelFormats.Count -and $outputArgs -contains '-pix_fmt' -and $profile.PixelFormats -notcontains $outputArgs[[Array]::IndexOf($outputArgs,'-pix_fmt')+1]){throw 'Selected pixel format is unsupported.'}
        foreach($flag in @('-fps_mode','-vsync','-multipass','-rc-lookahead','-spatial-aq','-temporal-aq','-aq-strength','-cq','-crf','-preset','-tune')){if($outputArgs -contains $flag -and $profile.Options -notcontains $flag -and $script:Capabilities.GlobalOptions -notcontains $flag){throw "FFmpeg encoder does not support $flag"}}
    }
    if($task.audio -in @('aac','libopus')){$audioHelp=Invoke-BridgeTool $script:Ffmpeg ('-hide_banner -h encoder='+$task.audio);if($audioHelp.StdOut -notmatch ('(?m)^Encoder '+[regex]::Escape([string]$task.audio)+'\s')){throw 'Selected audio encoder is unavailable.'}}
    $actualStart=[double]$task.start
    if($task.operation -eq 'copy' -and $actualStart -gt 0){
        $stop=($actualStart+1).ToString('0.######',[Globalization.CultureInfo]::InvariantCulture)
        $scan=Invoke-BridgeTool $script:Ffprobe ('-v error -select_streams v:0 -skip_frame nokey -read_intervals 0%'+$stop+' -show_frames -show_entries frame=best_effort_timestamp_time -of csv=p=0 '+(Quote-NativeArg $video))
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
    if($actualStart -gt 0){$parts.Add('-ss');$parts.Add($actualStart.ToString('0.######',[Globalization.CultureInfo]::InvariantCulture))}
    $parts.Add('-i');$parts.Add($video);$parts.Add('-t');$parts.Add(([double]$task.end-$actualStart).ToString('0.######',[Globalization.CultureInfo]::InvariantCulture))
    $baseParts=@($parts.ToArray())
    foreach($a in $outputArgs){$parts.Add($a.Replace('__ASS__','subtitle.ass').Replace('__FONTS__','fonts'))}
    if($task.twoPass){foreach($a in @('-pass','2','-passlogfile','task-pass')){$parts.Add($a)}}
    foreach($a in @('-f',$outputFormat,$outputFile)){$parts.Add($a)}
    $args=($parts | ForEach-Object { Quote-NativeArg $_ }) -join ' '
    $secondArgs=$args
    if($task.twoPass){$first=@($baseParts)+@((Get-MediaFirstPassArgs $outputArgs) | ForEach-Object {$_.Replace('__ASS__','subtitle.ass').Replace('__FONTS__','fonts')})+@('-pass','1','-passlogfile','task-pass','-f','null','NUL');$args=($first | ForEach-Object { Quote-NativeArg $_ }) -join ' '}
    $started=Start-BridgeTool $script:Ffmpeg $args $work
    $duration=if($task.operation -eq 'copy'){[double]$task.end-$actualStart}else{[double]$task.expectedDuration}
    $job=[pscustomobject]@{
        Id=$jobId;Work=$work;Output=(Join-Path $work $outputFile);Progress=(Join-Path $work 'progress.txt');Started=$started
        Duration=$duration;Encoder=$encoder;Hardware=$encoder.EndsWith('_nvenc');ActualStart=$actualStart;Task=$task;Request=$request;Source=$video;SourceProbe=$probe;Phase=if($task.twoPass){1}else{2};SecondArgs=$secondArgs
        OutputExtension=$outputExtension;OutputFormat=$outputFormat;SuggestedName=[string]$request.suggestedName;State='encoding';Finalized=$false;Error='';Cancelled=$false
        StartedAt=(Get-Date);HistoryRecorded=$false;EncodeSeconds=0.0;TimedProcessKey=''
    }
    $script:Jobs[$jobId]=$job
    return [pscustomobject]@{ok=$true;jobId=$jobId;suggestedName=$job.SuggestedName;actualStart=$actualStart;encoder=$encoder}
}

function Start-EncodeJob($Body) {
    foreach($existing in $script:Jobs.Values){if($existing.State -eq 'encoding' -and -not $existing.Started.Process.HasExited){throw 'A Native job is already running.'}}
    $video=Get-SelectedPath 'video'
    if(-not $video){throw 'No video selected.'}
    $request=$Body.request
    if($request.task){return Start-MediaTaskJob $Body}
    $outputFormat=if([string]$request.outputFormat){[string]$request.outputFormat}else{'matroska'}
    $outputExtension=if([string]$request.outputExtension){[string]$request.outputExtension}else{'mkv'}
    if($outputFormat -notin @('matroska','mp4')){throw 'Unsupported output container format.'}
    if(($outputFormat -eq 'matroska' -and $outputExtension -ne 'mkv') -or ($outputFormat -eq 'mp4' -and $outputExtension -ne 'mp4')){throw 'Output container format/extension mismatch.'}
    $profile=Get-PreferredEncoder ([string]$request.codec)
    if(-not $profile){throw 'No available Windows Native encoder for this codec.'}
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
    $args='-hide_banner -nostdin -loglevel error -y -progress progress.txt -i '+(Quote-NativeArg $video)+' -map 0:v:0 -sn -vf "ass=subtitle.ass:fontsdir=fonts" '+$encArgs+$audioArgs+$containerArgs+' -f '+$outputFormat+' '+(Quote-NativeArg $outputFile)
    $started=Start-BridgeTool $script:Ffmpeg $args $work
    $job=[pscustomobject]@{
        Id=$jobId;Work=$work;Output=$output;Progress=$progress;Started=$started
        Duration=[double]$request.expectedDuration;Encoder=$profile.Encoder;Hardware=[bool]$profile.Hardware;ActualStart=0;Task=$null;Request=$request;SourceProbe=$null
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
        $fps=if($request -and $request.sourceFps){[double]$request.sourceFps}elseif($source){[double]$source.fps}else{0.0}
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

function Get-JobStatus([string]$JobId) {
    if(-not $script:Jobs.ContainsKey($JobId)){return [pscustomobject]@{ok=$false;error='Unknown Windows Native job id.'}}
    $j=$script:Jobs[$JobId]

    # Terminal job state must be queryable repeatedly without touching the
    # disposed Process handle. Export-Job intentionally re-reads status after
    # encoding has finished, so terminal snapshots are resolved first.
    if($j.State -eq 'completed'){
        Ensure-CompletedJobHistory $j
        if(-not(Test-Path -LiteralPath $j.Output -PathType Leaf) -or (Get-Item -LiteralPath $j.Output).Length -le 0){
            $j.State='failed';$j.Error='Verified output staging file is missing.'
            return [pscustomobject]@{ok=$true;state='failed';progress=0;error=$j.Error;message=$j.Error}
        }
        $dur=Invoke-BridgeTool $script:Ffprobe ('-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $j.Output))
        $outputDuration=if($dur.ExitCode -eq 0){[double]::Parse($dur.StdOut.Trim(),[Globalization.CultureInfo]::InvariantCulture)}else{$j.Duration}
        return [pscustomobject]@{ok=$true;state='completed';progress=1;outputBytes=(Get-Item $j.Output).Length;outputDuration=$outputDuration;actualStart=$j.ActualStart;durationDelta=($outputDuration-$j.Duration);videoDecodeSeconds=0;suggestedName=$j.SuggestedName;encoder=$j.Encoder;hardware=$j.Hardware}
    }
    if($j.State -eq 'cancelled'){return [pscustomobject]@{ok=$true;state='cancelled';progress=0}}
    if($j.State -eq 'failed'){return [pscustomobject]@{ok=$true;state='failed';progress=0;error=$j.Error;message=$j.Error}}

    $p=$j.Started.Process
    if(-not $p.HasExited){
        $timeMs=0.0
        if(Test-Path -LiteralPath $j.Progress){
            $recent=Get-Content -LiteralPath $j.Progress -Tail 30 -ErrorAction SilentlyContinue
            $line=$recent|Where-Object{$_ -match '^out_time_ms=\d+'}|Select-Object -Last 1
            if($line){$timeMs=([double]($line-replace'^out_time_ms=',''))/1000}
        }
        $progress=if($j.Duration -gt 0){[Math]::Min(0.99,[Math]::Max(0,$timeMs/1000/$j.Duration))}else{0}
        if($j.Task -and $j.Task.twoPass){$progress=if($j.Phase -eq 1){$progress*.5}else{.5+$progress*.5}}
        $elapsed=((Get-Date)-$p.StartTime).TotalSeconds
        $speed=if($elapsed -gt 0){($timeMs/1000)/$elapsed}else{0}
        return [pscustomobject]@{ok=$true;state=if($j.Cancelled){'cancelling'}else{'encoding'};progress=$progress;timeMs=$timeMs;duration=$j.Duration;speed=$speed;encoder=$j.Encoder;hardware=$j.Hardware;actualStart=$j.ActualStart}
    }
    $processKey=([string]$p.Id)+':'+([string]$p.StartTime.Ticks)
    if([string]$j.TimedProcessKey -ne $processKey){
        $j.EncodeSeconds += [Math]::Max(.001,($p.ExitTime-$p.StartTime).TotalSeconds)
        $j.TimedProcessKey=$processKey
    }
    if($j.Task -and $j.Task.twoPass -and $j.Phase -eq 1 -and -not $j.Cancelled -and $p.ExitCode -eq 0){
        $p.Dispose();Remove-Item -LiteralPath $j.Progress -Force -ErrorAction SilentlyContinue
        $j.Started=Start-BridgeTool $script:Ffmpeg $j.SecondArgs $j.Work;$j.Phase=2
        return Get-JobStatus $JobId
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
                if($j.Task){
                    try {
                        $probe=Invoke-BridgeTool $script:Ffprobe ('-v error -show_streams -show_format -of json '+(Quote-NativeArg $j.Output))
                        if($probe.ExitCode -ne 0){throw 'Output probe failed.'}
                        $info=$probe.StdOut | ConvertFrom-Json
                        $videos=@($info.streams | Where-Object {$_.codec_type -eq 'video'})
                        $audios=@($info.streams | Where-Object {$_.codec_type -eq 'audio'})
                        $duration=[double]::Parse([string]$info.format.duration,[Globalization.CultureInfo]::InvariantCulture)
                        if($videos.Count -ne 1 -or $audios.Count -ne [int]$j.Task.expectedAudioTracks -or $duration -le 0 -or [Math]::Abs($duration-$j.Duration) -gt 2){throw 'Output stream count/duration validation failed.'}
                        Test-MediaOutput $j.Task $videos[0]
                        $scan=Invoke-BridgeTool $script:Ffmpeg ('-v error -i '+(Quote-NativeArg $j.Output)+' -map 0:v:0 -map 0:a? -c copy -f null -')
                        if($scan.ExitCode -ne 0){throw 'Output packet scan failed.'}
                    }catch{$j.State='failed';$j.Error=$_.Exception.Message}
                }
            }
        }
        $p.Dispose()
        if($j.State -eq 'completed'){Ensure-CompletedJobHistory $j}
        if($j.State -eq 'completed'){Write-BridgeLog ("Job "+$JobId+" completed · "+$j.Encoder)}
        elseif($j.State -eq 'cancelled'){Write-BridgeLog ("Job "+$JobId+" cancelled") 'WARN'}
        elseif($j.State -eq 'failed'){Write-BridgeLog ("Job "+$JobId+" failed: "+$j.Error) 'ERROR'}
    }
    if($j.State -eq 'completed'){
        $dur=Invoke-BridgeTool $script:Ffprobe ('-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $j.Output))
        $outputDuration=if($dur.ExitCode -eq 0){[double]::Parse($dur.StdOut.Trim(),[Globalization.CultureInfo]::InvariantCulture)}else{$j.Duration}
        return [pscustomobject]@{ok=$true;state='completed';progress=1;outputBytes=(Get-Item $j.Output).Length;outputDuration=$outputDuration;actualStart=$j.ActualStart;durationDelta=($outputDuration-$j.Duration);videoDecodeSeconds=0;suggestedName=$j.SuggestedName;encoder=$j.Encoder;hardware=$j.Hardware}
    }
    if($j.State -eq 'cancelled'){return [pscustomobject]@{ok=$true;state='cancelled';progress=0}}
    return [pscustomobject]@{ok=$true;state='failed';progress=0;error=$j.Error;message=$j.Error}
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
    if(-not $dest){return [pscustomobject]@{ok=$false;jobId=$JobId;error='Save cancelled.'}}
    $dir=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($dest))
    $temp=Join-Path $dir ('.'+[IO.Path]::GetFileName($dest)+'.quick-hardsub-'+[guid]::NewGuid().ToString('N')+'.tmp')
    Copy-Item -LiteralPath $j.Output -Destination $temp -Force
    Publish-VerifiedOutput $temp $dest
    return [pscustomobject]@{ok=$true;jobId=$JobId;bytes=(Get-Item -LiteralPath $dest).Length;path=$dest}
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
    $json=ConvertTo-JsonUtf8 $Payload
    $bytes=[Text.Encoding]::UTF8.GetBytes($json)
    $origin=if($Request.Headers.ContainsKey('origin')){$Request.Headers['origin']}else{''}
    $allowOrigin=if($origin -eq $script:AllowedOrigin -or $origin -match '^http://(127\.0\.0\.1|localhost)(:\d+)?$'){$origin}else{$script:AllowedOrigin}
    $reason=if($Status -eq 200){'OK'}elseif($Status -eq 204){'No Content'}elseif($Status -eq 403){'Forbidden'}elseif($Status -eq 404){'Not Found'}else{'Error'}
    $crlf=[Environment]::NewLine
    $head='HTTP/1.1 '+$Status+' '+$reason+$crlf+
        'Content-Type: application/json; charset=utf-8'+$crlf+
        'Content-Length: '+$bytes.Length+$crlf+
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
            ($Request.Method -eq 'GET' -and $path -match '^/api/jobs/[A-Za-z0-9]+$')
        if(-not $quietRequest){Write-BridgeLog ($Request.Method+' '+$path)}
        if($Request.Method -eq 'GET' -and $path -eq '/api/health'){Send-HttpJson $Request 200 (Get-BackendInfo);return}
        if($Request.Method -eq 'GET' -and $path -eq '/api/self-test'){Send-HttpJson $Request 200 (Get-SelfTest);return}
        if($Request.Method -eq 'GET' -and $path -eq '/api/history'){Send-HttpJson $Request 200 (Get-CompressionHistorySnapshot);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/history'){Send-HttpJson $Request 200 (Add-ClientCompressionEvidence $body.record);return}
        if($Request.Method -eq 'POST' -and $path -match '^/api/pick/(video|ass|fonts)$'){Send-HttpJson $Request 200 (Show-BridgePicker $Matches[1]);return}
        if($Request.Method -eq 'GET' -and $path -eq '/api/selection/ass'){
            $p=Get-SelectedPath 'ass';if(-not $p){throw 'No ASS selected.'};$item=Get-Item -LiteralPath $p
            Send-HttpJson $Request 200 @{ok=$true;name=$item.Name;size=$item.Length;base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($p))};return
        }
        if($Request.Method -eq 'POST' -and $path -eq '/api/probe'){Send-HttpJson $Request 200 (Get-ProbeMedia);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/preview'){Send-HttpJson $Request 200 (Invoke-Preview $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/frame'){Send-HttpJson $Request 200 (Invoke-Frame $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/waveform'){Send-HttpJson $Request 200 (Invoke-Waveform $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/sample'){Send-HttpJson $Request 200 (Invoke-Sample $body);return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/sample/export'){Send-HttpJson $Request 200 (Export-Sample ([string]$body.sampleId) ([string]$body.suggestedName));return}
        if($Request.Method -eq 'POST' -and $path -eq '/api/encode'){Send-HttpJson $Request 200 (Start-EncodeJob $body);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)$' -and $Request.Method -eq 'GET'){Send-HttpJson $Request 200 (Get-JobStatus $Matches[1]);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/cancel$' -and $Request.Method -eq 'POST'){
            $id=$Matches[1]
            if($script:Jobs.ContainsKey($id)){$j=$script:Jobs[$id];$j.Cancelled=$true;try{if(-not $j.Started.Process.HasExited){$j.Started.Process.Kill()}}catch{}}
            Send-HttpJson $Request 200 @{ok=$true};return
        }
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/frame$' -and $Request.Method -eq 'POST'){Send-HttpJson $Request 200 (Invoke-OutputFrame $Matches[1] $body);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/reference-frame$' -and $Request.Method -eq 'POST'){Send-HttpJson $Request 200 (Invoke-HardsubReferenceFrame $Matches[1] $body);return}
        if($path -match '^/api/jobs/([A-Za-z0-9]+)/export$' -and $Request.Method -eq 'POST'){Send-HttpJson $Request 200 (Export-Job $Matches[1] ([string]$body.suggestedName));return}
        Send-HttpJson $Request 404 @{ok=$false;error='Unknown bridge endpoint.'}
    }catch{
        Write-BridgeLog ($Request.Method+' '+$Request.Path+' failed: '+$_.Exception.Message) 'ERROR'
        Send-HttpJson $Request 500 @{ok=$false;error=$_.Exception.Message}
    }
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
    foreach($j in $script:Jobs.Values){try{if(-not $j.Started.Process.HasExited){$j.Started.Process.Kill()}}catch{}}
}
