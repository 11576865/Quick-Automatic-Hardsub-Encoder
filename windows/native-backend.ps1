# Shared Windows Native FFmpeg/NVENC capability and encoder helpers.
# PowerShell 5.1 compatible; safe to dot-source from the WinForms launcher and CI.

function Find-NativeTool([string]$Name, [string]$ScriptRoot = $PSScriptRoot) {
    $base = Split-Path $ScriptRoot -Parent
    $candidates = @(
        (Join-Path $base "tools\ffmpeg\bin\$Name.exe"),
        (Join-Path $base "tools\ffmpeg\$Name.exe"),
        (Join-Path $ScriptRoot "$Name.exe"),
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\$Name.exe")
    )
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
        $detected += [pscustomobject]@{
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

    return [pscustomobject]@{
        Ffmpeg = $Ffmpeg
        Ffprobe = $Ffprobe
        Cpu = $cpu
        Gpus = @($gpus)
        HasAss = $hasAss
        Encoders = @($detected)
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
        return "-c:v $($Profile.Encoder) -preset p7 -tune $tune -rc vbr -cq $($Profile.Quality) -b:v 0 -multipass fullres"
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
