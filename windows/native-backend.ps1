# Shared Windows Native FFmpeg/NVENC capability and encoder helpers.
# PowerShell 5.1 compatible; safe to dot-source from the WinForms launcher and CI.

$script:NativeFfmpegToolchainCache = @{}

function Get-FfmpegVersionInfo([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $line = (& $Path -version 2>&1 | Select-Object -First 1)
        $text = [string]$line
        $m = [regex]::Match($text, '(?i)ffmpeg version\s+(?:n)?(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?')
        if (-not $m.Success) {
            return [pscustomobject]@{ Text=$text.Trim(); Major=0; Minor=0; Patch=0 }
        }
        return [pscustomobject]@{
            Text = $text.Trim()
            Major = [int]$m.Groups['major'].Value
            Minor = if($m.Groups['minor'].Success){[int]$m.Groups['minor'].Value}else{0}
            Patch = if($m.Groups['patch'].Success){[int]$m.Groups['patch'].Value}else{0}
        }
    } catch {
        return $null
    }
}

function Resolve-NativeFfmpegToolchain([string]$ScriptRoot = $PSScriptRoot) {
    $cacheKey = [IO.Path]::GetFullPath($ScriptRoot)
    if ($script:NativeFfmpegToolchainCache.ContainsKey($cacheKey)) {
        return $script:NativeFfmpegToolchainCache[$cacheKey]
    }

    $base = Split-Path $ScriptRoot -Parent
    $raw = @()
    $explicit = [string]$env:QUICK_HARDSUB_FFMPEG
    if ($explicit) {
        $raw += [pscustomobject]@{ Path=$explicit; Source='explicit'; Priority=1000000 }
    }
    foreach ($candidate in @(
        (Join-Path $base 'tools\ffmpeg\bin\ffmpeg.exe'),
        (Join-Path $base 'tools\ffmpeg\ffmpeg.exe'),
        (Join-Path $ScriptRoot 'ffmpeg.exe')
    )) {
        $raw += [pscustomobject]@{ Path=$candidate; Source='bundled'; Priority=900000 }
    }

    $wingetLink = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
    $raw += [pscustomobject]@{ Path=$wingetLink; Source='winget-link'; Priority=700000 }

    $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $wingetPackages -PathType Container) {
        try {
            foreach ($package in @(Get-ChildItem -LiteralPath $wingetPackages -Directory -Filter 'Gyan.FFmpeg*' -ErrorAction Stop)) {
                foreach ($build in @(Get-ChildItem -LiteralPath $package.FullName -Directory -ErrorAction SilentlyContinue)) {
                    $raw += [pscustomobject]@{
                        Path=(Join-Path $build.FullName 'bin\ffmpeg.exe')
                        Source='winget-package'
                        Priority=700000
                    }
                }
            }
        } catch {}
    }

    foreach ($dir in @([string]$env:PATH -split ';')) {
        $trimmed = $dir.Trim().Trim('"')
        if ($trimmed) {
            $raw += [pscustomobject]@{ Path=(Join-Path $trimmed 'ffmpeg.exe'); Source='PATH'; Priority=0 }
        }
    }

    $seen = @{}
    $evaluated = @()
    foreach ($item in $raw) {
        $candidate = [Environment]::ExpandEnvironmentVariables([string]$item.Path)
        if (-not $candidate) { continue }
        try { $candidate = [IO.Path]::GetFullPath($candidate) } catch { continue }
        $key = $candidate.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }

        $dir = Split-Path -Parent $candidate
        $ffprobe = Join-Path $dir 'ffprobe.exe'
        if (-not (Test-Path -LiteralPath $ffprobe -PathType Leaf)) { continue }

        $version = Get-FfmpegVersionInfo $candidate
        if (-not $version) { continue }

        $score = [long]$item.Priority + ([long]$version.Major * 10000L) + ([long]$version.Minor * 100L) + $version.Patch
        $isConda = $candidate -match '(?i)\\(?:mini)?conda\d*\\|\\anaconda\d*\\|\\envs\\'
        if ($isConda) { $score -= 50000L }

        $fpsMode = $false
        $multipassFullres = $false
        try {
            $help = (& $candidate -hide_banner -h full 2>&1) -join [Environment]::NewLine
            $fpsMode = $help -match '(?m)^\s*-fps_mode(?:\[:[^\]]+\])?\s'
            if ($fpsMode) { $score += 20000L }
        } catch {}
        try {
            $encHelp = (& $candidate -hide_banner -h encoder=hevc_nvenc 2>&1) -join [Environment]::NewLine
            $multipassFullres = ($encHelp -match '(?m)^\s*-multipass\s') -and ($encHelp -match '(?i)\bfullres\b')
            if ($multipassFullres) { $score += 20000L }
        } catch {}

        $evaluated += [pscustomobject]@{
            Ffmpeg=$candidate
            Ffprobe=$ffprobe
            Source=[string]$item.Source
            Version=$version.Text
            Major=$version.Major
            Minor=$version.Minor
            Patch=$version.Patch
            FpsModeSupported=$fpsMode
            MultipassFullresSupported=$multipassFullres
            IsConda=$isConda
            Score=$score
        }
    }

    $selected = @($evaluated | Sort-Object Score -Descending) | Select-Object -First 1
    if (-not $selected) {
        $result = [pscustomobject]@{
            Ffmpeg=$null; Ffprobe=$null; Source='missing'; Version=$null
            FpsModeSupported=$false; MultipassFullresSupported=$false
            Warnings=@('未找到同时包含 ffmpeg.exe 与 ffprobe.exe 的可用工具链。')
            Candidates=[object[]]@()
        }
        $script:NativeFfmpegToolchainCache[$cacheKey] = $result
        return $result
    }

    $warnings = @()
    if ($selected.IsConda) {
        $warnings += '当前选中的 FFmpeg 来自 Conda/Miniconda；如果存在系统新版，请显式指定 QUICK_HARDSUB_FFMPEG 或安装 WinGet Gyan.FFmpeg。'
    }
    if (-not $selected.FpsModeSupported) {
        $warnings += '当前 FFmpeg 不支持 -fps_mode；任务会回退到旧 -vsync。'
    }
    if (-not $selected.MultipassFullresSupported) {
        $warnings += '当前 FFmpeg/NVENC 不支持 -multipass fullres；相关参数必须关闭或降级。'
    }

    $result = [pscustomobject]@{
        Ffmpeg=$selected.Ffmpeg
        Ffprobe=$selected.Ffprobe
        Source=$selected.Source
        Version=$selected.Version
        FpsModeSupported=[bool]$selected.FpsModeSupported
        MultipassFullresSupported=[bool]$selected.MultipassFullresSupported
        Warnings=[object[]]$warnings
        Candidates=[object[]]$evaluated
    }
    $script:NativeFfmpegToolchainCache[$cacheKey] = $result
    return $result
}

function Find-NativeTool([string]$Name, [string]$ScriptRoot = $PSScriptRoot) {
    if ($Name -eq 'ffmpeg' -or $Name -eq 'ffprobe') {
        $toolchain = Resolve-NativeFfmpegToolchain $ScriptRoot
        return if($Name -eq 'ffmpeg'){$toolchain.Ffmpeg}else{$toolchain.Ffprobe}
    }

    $base = Split-Path $ScriptRoot -Parent
    $candidates = @((Join-Path $ScriptRoot "$Name.exe"))
    if ($Name -eq 'nvidia-smi') {
        $candidates += (Join-Path $env:WINDIR 'System32\nvidia-smi.exe')
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    $found = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    return $null
}

function Quote-NativeArg([string]$Value) {
    if ($null -eq $Value) { return '""' }
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-NativeTool([string]$Exe, [string]$Arguments, [switch]$AllowFailure) {
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo.FileName = $Exe
    $p.StartInfo.Arguments = $Arguments
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    try {
        [void]$p.Start()
        $stdoutTask = $p.StandardOutput.ReadToEndAsync()
        $stderrTask = $p.StandardError.ReadToEndAsync()
        $p.WaitForExit()
        $result = [pscustomobject]@{
            ExitCode = $p.ExitCode
            StdOut = [string]$stdoutTask.Result
            StdErr = [string]$stderrTask.Result
        }
        if (-not $AllowFailure -and $result.ExitCode -ne 0) {
            $message = $result.StdErr.Trim()
            if (-not $message) { $message = "$Exe exited with $($result.ExitCode)" }
            throw $message
        }
        return $result
    } finally {
        $p.Dispose()
    }
}


function Convert-AssToUtf8Normalized([string]$InputPath, [string]$OutputPath) {
    if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw "ASS 字幕不存在：$InputPath" }
    $bytes = [IO.File]::ReadAllBytes($InputPath)
    if (-not $bytes.Length) { throw 'ASS 字幕为空。' }

    $text = $null
    $encodingName = $null

    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $text = [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
        $encodingName = 'UTF-8 BOM'
    } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
        $text = [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2)
        $encodingName = 'UTF-16 LE BOM'
    } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) {
        $text = [Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2)
        $encodingName = 'UTF-16 BE BOM'
    } else {
        $sampleLength = [Math]::Min($bytes.Length, 4096)
        $zeroEven = 0
        $zeroOdd = 0
        for ($i = 0; $i -lt $sampleLength; $i++) {
            if ($bytes[$i] -eq 0) {
                if (($i % 2) -eq 0) { $zeroEven++ } else { $zeroOdd++ }
            }
        }
        $zeroThreshold = [Math]::Max(4, [int]($sampleLength / 10))
        if ($zeroOdd -ge $zeroThreshold -and $zeroOdd -gt ($zeroEven * 2)) {
            $text = [Text.Encoding]::Unicode.GetString($bytes)
            $encodingName = 'UTF-16 LE (heuristic)'
        } elseif ($zeroEven -ge $zeroThreshold -and $zeroEven -gt ($zeroOdd * 2)) {
            $text = [Text.Encoding]::BigEndianUnicode.GetString($bytes)
            $encodingName = 'UTF-16 BE (heuristic)'
        } else {
            try {
                $strictUtf8 = New-Object Text.UTF8Encoding($false, $true)
                $text = $strictUtf8.GetString($bytes)
                $encodingName = 'UTF-8'
            } catch [Text.DecoderFallbackException] {
                $fallback = [Text.Encoding]::Default
                $text = $fallback.GetString($bytes)
                $encodingName = "Windows ANSI ($($fallback.WebName))"
            }
        }
    }

    if ($null -eq $text) { throw '无法解码 ASS 字幕。' }
    $text = $text.TrimStart([char]0xFEFF)
    if ($text.IndexOf([char]0) -ge 0) { throw "ASS 解码后仍包含 NUL 字符；检测编码：$encodingName" }

    $required = @(
        @{ Name='[Script Info]'; Pattern='(?im)^\s*\[Script Info\]\s*$' },
        @{ Name='[V4+ Styles] / [V4 Styles]'; Pattern='(?im)^\s*\[V4\+? Styles\]\s*$' },
        @{ Name='[Events]'; Pattern='(?im)^\s*\[Events\]\s*$' }
    )
    foreach ($section in $required) {
        if ($text -notmatch $section.Pattern) {
            throw "ASS 结构无效：缺少 $($section.Name)；检测编码：$encodingName"
        }
    }

    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($OutputPath, $text, $utf8)
    return [pscustomobject]@{
        Encoding = $encodingName
        OutputPath = $OutputPath
        Characters = $text.Length
        Bytes = (Get-Item -LiteralPath $OutputPath).Length
    }
}

function Get-NativeEncoderCatalog {
    return @(
        [pscustomobject]@{ Key='h264_nvenc'; Label='H.264 · NVIDIA NVENC'; Codec='h264'; Encoder='h264_nvenc'; Hardware=$true; QualityLabel='CQ 19'; Quality=19; SoftwarePreset=$null },
        [pscustomobject]@{ Key='hevc_nvenc'; Label='H.265 / HEVC · NVIDIA NVENC'; Codec='h265'; Encoder='hevc_nvenc'; Hardware=$true; QualityLabel='CQ 23'; Quality=23; SoftwarePreset=$null },
        [pscustomobject]@{ Key='av1_nvenc'; Label='AV1 · NVIDIA NVENC'; Codec='av1'; Encoder='av1_nvenc'; Hardware=$true; QualityLabel='CQ 28'; Quality=28; SoftwarePreset=$null },
        [pscustomobject]@{ Key='libx264'; Label='H.264 · CPU / x264'; Codec='h264'; Encoder='libx264'; Hardware=$false; QualityLabel='CRF 22'; Quality=22; SoftwarePreset='medium' },
        [pscustomobject]@{ Key='libx265'; Label='H.265 / HEVC · CPU / x265'; Codec='h265'; Encoder='libx265'; Hardware=$false; QualityLabel='CRF 27'; Quality=27; SoftwarePreset='medium' },
        [pscustomobject]@{ Key='libsvtav1'; Label='AV1 · CPU / SVT-AV1'; Codec='av1'; Encoder='libsvtav1'; Hardware=$false; QualityLabel='CRF 32 · preset 6'; Quality=32; SoftwarePreset='6' }
    )
}

function Test-EncoderListed([string]$EncoderText, [string]$Encoder) {
    return $EncoderText -match ("(?m)^\s*[A-Z|.]+\s+" + [regex]::Escape($Encoder) + "\s")
}

function Get-WindowsCpuName {
    try {
        $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
        if ($cpu -and $cpu.Name) { return ([string]$cpu.Name).Trim() }
    } catch {}
    return $env:PROCESSOR_IDENTIFIER
}

function Get-WindowsGpuNames([string]$ScriptRoot = $PSScriptRoot) {
    $names = @()

    # Prefer NVIDIA's own tool because it reports the marketing model name
    # (for example, "NVIDIA GeForce RTX 5070") instead of a generic adapter label.
    $smiCandidates = @()
    $smi = Find-NativeTool 'nvidia-smi' $ScriptRoot
    if ($smi) { $smiCandidates += $smi }

    if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
        $sysnative = Join-Path $env:WINDIR 'Sysnative\nvidia-smi.exe'
        if (Test-Path -LiteralPath $sysnative -PathType Leaf) { $smiCandidates += $sysnative }
    }

    foreach ($root in @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $root) { continue }
        $candidate = Join-Path $root 'NVIDIA Corporation\NVSMI\nvidia-smi.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $smiCandidates += $candidate }
    }

    foreach ($candidate in @($smiCandidates | Select-Object -Unique)) {
        try {
            $r = Invoke-NativeTool $candidate '--query-gpu=name --format=csv,noheader' -AllowFailure
            if ($r.ExitCode -eq 0) {
                $names = @($r.StdOut -split "\r?\n" |
                    ForEach-Object { $_.Trim() } |
                    Where-Object { $_ -match '^NVIDIA\b' })
                if ($names.Count) { break }
            }

            # Older/driver-specific nvidia-smi builds can reject --query-gpu
            # while still supporting the stable "-L" listing format.
            $r = Invoke-NativeTool $candidate '-L' -AllowFailure
            if ($r.ExitCode -eq 0) {
                $names = @($r.StdOut -split "\r?\n" |
                    ForEach-Object {
                        $line = $_.Trim()
                        $m = [regex]::Match($line, '^GPU\s+\d+:\s+(?<name>NVIDIA.+?)(?:\s+\(UUID:|$)')
                        if ($m.Success) { $m.Groups['name'].Value.Trim() }
                    } |
                    Where-Object { $_ })
                if ($names.Count) { break }
            }
        } catch {}
    }

    # Standard Windows display-controller inventory.
    if (-not $names.Count) {
        try {
            $names = @(Get-CimInstance Win32_VideoController -ErrorAction Stop |
                Where-Object { $_.Name -match '^NVIDIA\b' } |
                ForEach-Object { ([string]$_.Name).Trim() } |
                Where-Object { $_ })
        } catch {}
    }

    # PnP inventory is useful on systems where Win32_VideoController is stale.
    if (-not $names.Count) {
        try {
            if (Get-Command Get-PnpDevice -ErrorAction SilentlyContinue) {
                $names = @(Get-PnpDevice -Class Display -PresentOnly -ErrorAction Stop |
                    Where-Object { $_.FriendlyName -match '^NVIDIA\b' } |
                    ForEach-Object { ([string]$_.FriendlyName).Trim() } |
                    Where-Object { $_ })
            }
        } catch {}
    }

    # CIM PnP fallback does not depend on the Get-PnpDevice module being present.
    if (-not $names.Count) {
        try {
            $names = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Display'" -ErrorAction Stop |
                Where-Object { $_.Name -match '^NVIDIA\b' } |
                ForEach-Object { ([string]$_.Name).Trim() } |
                Where-Object { $_ })
        } catch {}
    }

    # Legacy WMI API fallback for Windows PowerShell hosts where CIM is unavailable.
    if (-not $names.Count) {
        try {
            $searcher = New-Object Management.ManagementObjectSearcher('SELECT Name FROM Win32_VideoController')
            $names = @($searcher.Get() |
                Where-Object { $_.Name -match '^NVIDIA\b' } |
                ForEach-Object { ([string]$_.Name).Trim() } |
                Where-Object { $_ })
            $searcher.Dispose()
        } catch {}
    }

    # Last-resort registry inventory. Modern NVIDIA drivers populate DriverDesc
    # even when WMI/CIM queries are restricted or temporarily unavailable.
    if (-not $names.Count) {
        try {
            $displayClass = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
            $registryNames = @()
            foreach ($key in @(Get-ChildItem -LiteralPath $displayClass -ErrorAction Stop)) {
                try {
                    $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
                    foreach ($value in @($props.DriverDesc, $props.'HardwareInformation.AdapterString')) {
                        if ($value -is [string] -and $value.Trim() -match '^NVIDIA\b') {
                            $registryNames += $value.Trim()
                        }
                    }
                } catch {}
            }
            $names = @($registryNames)
        } catch {}
    }

    return @($names |
        ForEach-Object { ([string]$_).Trim() } |
        Where-Object { $_ -match '^NVIDIA\b' } |
        Select-Object -Unique)
}

function Test-NvencRuntime([string]$Ffmpeg, [string]$Encoder) {
    if (-not $Ffmpeg) {
        return [pscustomobject]@{ Available=$false; ExitCode=-1; Error='FFmpeg path is empty'; Bytes=0 }
    }
    $output = Join-Path ([IO.Path]::GetTempPath()) ("quick-hardsub-nvenc-" + [guid]::NewGuid().ToString('N') + '.mkv')
    try {
        $args = '-hide_banner -nostdin -loglevel error -y -f lavfi -i testsrc2=size=256x144:rate=30 -frames:v 8 -an -pix_fmt yuv420p -c:v ' +
            $Encoder + ' ' + (Quote-NativeArg $output)
        $r = Invoke-NativeTool $Ffmpeg $args -AllowFailure
        $bytes = if (Test-Path -LiteralPath $output -PathType Leaf) { (Get-Item -LiteralPath $output).Length } else { 0 }
        $errorText = ($r.StdErr + [Environment]::NewLine + $r.StdOut).Trim()
        $ok = ($r.ExitCode -eq 0 -and $bytes -gt 0)
        if (-not $ok -and -not $errorText) { $errorText = "NVENC probe failed without FFmpeg stderr (exit $($r.ExitCode))." }
        return [pscustomobject]@{
            Available = $ok
            ExitCode = $r.ExitCode
            Error = $errorText
            Bytes = $bytes
        }
    } catch {
        return [pscustomobject]@{
            Available = $false
            ExitCode = -1
            Error = $_.Exception.Message
            Bytes = 0
        }
    } finally {
        Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
    }
}

function Get-NvencTune([string]$Ffmpeg, [string]$Encoder) {
    try {
        $r = Invoke-NativeTool $Ffmpeg ("-hide_banner -h encoder=" + $Encoder) -AllowFailure
        $text = $r.StdOut + [Environment]::NewLine + $r.StdErr
        if ($text -match '(?im)\buhq\b') { return 'uhq' }
    } catch {}
    return 'hq'
}

function Get-NativeCapabilities([string]$Ffmpeg, [string]$Ffprobe, [string]$ScriptRoot = $PSScriptRoot) {
    $cpu = Get-WindowsCpuName
    $gpus = Get-WindowsGpuNames $ScriptRoot
    $filtersText = ''
    $encodersText = ''
    $hasAss = $false
    if ($Ffmpeg) {
        try {
            $filtersText = (Invoke-NativeTool $Ffmpeg '-hide_banner -filters').StdOut
            $hasAss = $filtersText -match '(?m)^\s*[.A-Z|]+\s+ass\s'
            $encodersText = (Invoke-NativeTool $Ffmpeg '-hide_banner -encoders').StdOut
        } catch {}
    }

    $fullHelp=(Invoke-NativeTool $Ffmpeg '-hide_banner -h full').StdOut
    $globalOptions=@([regex]::Matches($fullHelp,'(?m)^\s*(-[A-Za-z0-9_:.-]+)(?:\s|$)') | ForEach-Object {$_.Groups[1].Value} | Select-Object -Unique)
    $detected = @()
    foreach ($profile in Get-NativeEncoderCatalog) {
        $listed = $false
        $runtime = $false
        $runtimeError = $null
        $runtimeExitCode = $null
        $runtimeProbeBytes = 0
        $tune = $null
        if ($encodersText) { $listed = Test-EncoderListed $encodersText $profile.Encoder }
        if ($listed) {
            if ($profile.Hardware) {
                $probe = Test-NvencRuntime $Ffmpeg $profile.Encoder
                $runtime = [bool]$probe.Available
                $runtimeError = $probe.Error
                $runtimeExitCode = $probe.ExitCode
                $runtimeProbeBytes = $probe.Bytes
                if ($runtime) { $tune = Get-NvencTune $Ffmpeg $profile.Encoder }
            } else {
                $runtime = $true
            }
        }
        $encoderHelp=if($listed){(Invoke-NativeTool $Ffmpeg ('-hide_banner -h encoder='+$profile.Encoder)).StdOut}else{''}
        $options=@([regex]::Matches($encoderHelp,'(?m)^\s*(-[A-Za-z0-9_:.-]+)(?:\s|$)') | ForEach-Object {$_.Groups[1].Value} | Select-Object -Unique)
        $pixelFormats=@()
        if($encoderHelp -match 'Supported pixel formats:\s*([^\r\n]+)'){$pixelFormats=@($Matches[1].Trim() -split '\s+')}
        $supportsMultipassFullres = ($options -contains '-multipass') -and ($encoderHelp -match '(?i)\bfullres\b')
        $detected += [pscustomobject]@{
            Options=[object[]]$options
            SupportsMultipassFullres=[bool]$supportsMultipassFullres
            PixelFormats=[object[]]$pixelFormats
            Key = $profile.Key
            Label = $profile.Label
            Codec = $profile.Codec
            Encoder = $profile.Encoder
            Hardware = $profile.Hardware
            QualityLabel = $profile.QualityLabel
            Quality = $profile.Quality
            SoftwarePreset = $profile.SoftwarePreset
            Listed = $listed
            Runtime = $runtime
            Available = ($listed -and $runtime)
            RuntimeError = $runtimeError
            RuntimeExitCode = $runtimeExitCode
            RuntimeProbeBytes = $runtimeProbeBytes
            Tune = $tune
        }
    }

    if (-not $gpus.Count -and @($detected | Where-Object { $_.Hardware -and $_.Available }).Count) {
        $gpus = @('NVIDIA GPU · NVENC runtime available')
    }

    $toolchain = Resolve-NativeFfmpegToolchain $ScriptRoot
    return [pscustomobject]@{
        Ffmpeg = $Ffmpeg
        Ffprobe = $Ffprobe
        FfmpegVersion = $toolchain.Version
        FfmpegSource = $toolchain.Source
        FfmpegWarnings = [object[]]$toolchain.Warnings
        FfmpegCandidates = [object[]]$toolchain.Candidates
        MultipassFullresSupported = [bool]$toolchain.MultipassFullresSupported
        Cpu = $cpu
        Gpus = @($gpus)
        HasAss = $hasAss
        Encoders = @($detected)
        GlobalOptions = [object[]]$globalOptions
        FpsModeSupported = ($globalOptions -contains '-fps_mode')
    }
}

function Get-NativeEncoderProfile($Capabilities, [string]$Key) {
    if (-not $Capabilities) { return $null }
    return @($Capabilities.Encoders | Where-Object { $_.Key -eq $Key }) | Select-Object -First 1
}

function Get-NativeEncoderArguments($Profile) {
    if (-not $Profile) { throw '编码器配置为空。' }
    if ($Profile.Hardware) {
        $tune = if ($Profile.Tune) { $Profile.Tune } else { 'hq' }
        $multipass = if ($Profile.SupportsMultipassFullres) { ' -multipass fullres' } else { '' }
        return "-c:v $($Profile.Encoder) -preset p7 -tune $tune -rc vbr -cq $($Profile.Quality) -b:v 0$multipass"
    }
    if ($Profile.Encoder -eq 'libsvtav1') {
        return "-c:v libsvtav1 -preset $($Profile.SoftwarePreset) -crf $($Profile.Quality)"
    }
    return "-c:v $($Profile.Encoder) -preset $($Profile.SoftwarePreset) -crf $($Profile.Quality)"
}

function Get-NativeCodecPeers($Capabilities, [string]$Key) {
    $selected = Get-NativeEncoderProfile $Capabilities $Key
    if (-not $selected) { return @() }
    return @($Capabilities.Encoders | Where-Object { $_.Codec -eq $selected.Codec -and $_.Available })
}
