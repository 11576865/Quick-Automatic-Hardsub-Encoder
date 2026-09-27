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
    $smi = Find-NativeTool 'nvidia-smi' $ScriptRoot
    if ($smi) {
        try {
            $r = Invoke-NativeTool $smi '--query-gpu=name --format=csv,noheader' -AllowFailure
            if ($r.ExitCode -eq 0) {
                $names = @($r.StdOut -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
            }
        } catch {}
    }
    if (-not $names.Count) {
        try {
            $names = @(Get-CimInstance Win32_VideoController -ErrorAction Stop |
                Where-Object { $_.Name -match 'NVIDIA' } |
                ForEach-Object { ([string]$_.Name).Trim() } |
                Where-Object { $_ })
        } catch {}
    }
    return $names
}

function Test-NvencRuntime([string]$Ffmpeg, [string]$Encoder) {
    if (-not $Ffmpeg) { return $false }
    $args = "-hide_banner -loglevel error -f lavfi -i color=c=black:s=128x72:r=1:d=1 -frames:v 1 -c:v $Encoder -f null NUL"
    try {
        $r = Invoke-NativeTool $Ffmpeg $args -AllowFailure
        return $r.ExitCode -eq 0
    } catch {
        return $false
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
        $tune = $null
        if ($encodersText) { $listed = Test-EncoderListed $encodersText $profile.Encoder }
        if ($listed) {
            if ($profile.Hardware) {
                $runtime = Test-NvencRuntime $Ffmpeg $profile.Encoder
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
            Tune = $tune
        }
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
