# Windows 11 local encoder. No Python, Node.js, or administrator rights required.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Find-Tool([string]$Name) {
    $base = Split-Path $PSScriptRoot -Parent
    $candidates = @(
        (Join-Path $base "tools\ffmpeg\bin\$Name.exe"),
        (Join-Path $base "tools\ffmpeg\$Name.exe"),
        (Join-Path $PSScriptRoot "$Name.exe"),
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\$Name.exe")
    )
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    $found = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    return $null
}

function Quote-Arg([string]$Value) {
    # Windows file paths cannot contain a double quote. Encode spaces for ProcessStartInfo.
    return '"' + $Value + '"'
}

function Run-Tool([string]$Exe, [string]$Arguments) {
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo.FileName = $Exe
    $p.StartInfo.Arguments = $Arguments
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    try {
        [void]$p.Start()
        $stdout = $p.StandardOutput.ReadToEnd()
        $stderr = $p.StandardError.ReadToEnd()
        $p.WaitForExit()
        if ($p.ExitCode -ne 0) { throw $stderr }
        return $stdout
    } finally { $p.Dispose() }
}

$script:ffmpeg = Find-Tool 'ffmpeg'
$script:ffprobe = Find-Tool 'ffprobe'
$script:job = $null
$script:work = $null
$script:output = $null
$script:duration = 0.0
$script:cancelled = $false

$form = New-Object System.Windows.Forms.Form
$form.Text = '快捷自动硬字幕压制器 - Windows 本地版'
$form.Width = 760; $form.Height = 525
$form.MinimumSize = New-Object System.Drawing.Size(720, 500)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

function Label([string]$Text, [int]$Top) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text; $label.Left = 18; $label.Top = $Top
    $label.Width = 100; $label.Height = 26
    $form.Controls.Add($label)
}
function Input([int]$Top) {
    $box = New-Object System.Windows.Forms.TextBox
    $box.Left = 122; $box.Top = $Top; $box.Width = 490; $box.ReadOnly = $true
    $box.Anchor = 'Top,Left,Right'; $form.Controls.Add($box)
    return $box
}
function Button([string]$Text, [int]$Top) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text; $button.Left = 620; $button.Top = $Top - 2
    $button.Width = 105; $button.Anchor = 'Top,Right'
    $form.Controls.Add($button)
    return $button
}

Label '视频' 20; $video = Input 20; $pickVideo = Button '选择视频' 20
Label 'ASS 字幕' 60; $ass = Input 60; $pickAss = Button '选择字幕' 60
Label '字体文件' 100; $fonts = Input 100; $pickFonts = Button '选择字体' 100
Label '输出 MKV' 140; $out = Input 140; $pickOut = Button '选择位置' 140
Label '编码器' 180
$codec = New-Object System.Windows.Forms.ComboBox
$codec.Left = 122; $codec.Top = 180; $codec.Width = 220
$codec.DropDownStyle = 'DropDownList'; [void]$codec.Items.AddRange(@('H.264 / libx264', 'H.265 / libx265', 'AV1 / libsvtav1'))
$codec.SelectedIndex = 0; $form.Controls.Add($codec)
$quality = New-Object System.Windows.Forms.Label
$quality.Text = '默认使用 CRF 质量模式；音频直接复制。'
$quality.Left = 360; $quality.Top = 183; $quality.Width = 350; $form.Controls.Add($quality)
$status = New-Object System.Windows.Forms.Label
$status.Left = 18; $status.Top = 223; $status.Width = 700; $status.Height = 42
$status.Anchor = 'Top,Left,Right'; $form.Controls.Add($status)
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Left = 18; $bar.Top = 268; $bar.Width = 707; $bar.Height = 19
$bar.Anchor = 'Top,Left,Right'; $form.Controls.Add($bar)
$start = New-Object System.Windows.Forms.Button
$start.Text = '开始压制'; $start.Left = 18; $start.Top = 305; $start.Width = 145
$form.Controls.Add($start)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = '取消'; $cancel.Left = 174; $cancel.Top = 305; $cancel.Width = 110; $cancel.Enabled = $false
$form.Controls.Add($cancel)
$install = New-Object System.Windows.Forms.Button
$install.Text = '检查 / 安装 FFmpeg'; $install.Left = 295; $install.Top = 305; $install.Width = 170
$form.Controls.Add($install)
$log = New-Object System.Windows.Forms.TextBox
$log.Left = 18; $log.Top = 350; $log.Width = 707; $log.Height = 110
$log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = 'Vertical'
$log.Anchor = 'Top,Bottom,Left,Right'; $form.Controls.Add($log)
function Write-Log([string]$Text) { $log.AppendText("$Text`r`n") }

$pickVideo.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = '视频文件|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.ts|所有文件|*.*'
    if ($dialog.ShowDialog() -eq 'OK') { $video.Text = $dialog.FileName }
    $dialog.Dispose()
})
$pickAss.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = 'ASS 字幕|*.ass|所有文件|*.*'
    if ($dialog.ShowDialog() -eq 'OK') { $ass.Text = $dialog.FileName }
    $dialog.Dispose()
})
$pickFonts.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = '字体|*.ttf;*.otf;*.ttc;*.otc|所有文件|*.*'
    $dialog.Multiselect = $true
    if ($dialog.ShowDialog() -eq 'OK') {
        $script:selectedFonts = @($dialog.FileNames)
        $fonts.Text = "已选择 $($script:selectedFonts.Count) 个字体文件"
    }
    $dialog.Dispose()
})
$pickOut.Add_Click({
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter = 'Matroska 视频|*.mkv'; $dialog.DefaultExt = 'mkv'
    if ($video.Text) { $dialog.FileName = [IO.Path]::GetFileNameWithoutExtension($video.Text) + '_hardsub.mkv' }
    if ($dialog.ShowDialog() -eq 'OK') { $out.Text = $dialog.FileName }
    $dialog.Dispose()
})

$install.Add_Click({
    $script:ffmpeg = Find-Tool 'ffmpeg'; $script:ffprobe = Find-Tool 'ffprobe'
    if ($script:ffmpeg -and $script:ffprobe) {
        [Windows.Forms.MessageBox]::Show("已找到：`n$script:ffmpeg`n$script:ffprobe", 'FFmpeg') | Out-Null
        return
    }
    $message = "未找到完整 FFmpeg（含 ffprobe）。`n`n可把 ffmpeg.exe、ffprobe.exe 放入仓库 tools\ffmpeg\bin，再点此按钮检查。`n`n也可以使用 Windows 自带的 winget 安装 Gyan.FFmpeg；安装需要网络，可能弹出许可确认。是否现在启动 winget？"
    if ([Windows.Forms.MessageBox]::Show($message, '首次安装', 'YesNo', 'Question') -ne 'Yes') { return }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        [Windows.Forms.MessageBox]::Show('此电脑没有 winget。请从 FFmpeg 官网选择 Windows 构建，解压到仓库 tools\ffmpeg\bin。', '无法自动安装') | Out-Null
        return
    }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k winget install --id Gyan.FFmpeg -e --source winget' | Out-Null
    Write-Log '已打开 winget 安装窗口；完成后重新启动本程序，或将 FFmpeg 放进 tools\ffmpeg\bin。'
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 600
$timer.Add_Tick({
    if (-not $script:job) { return }
    $progressFile = Join-Path $script:work 'progress.txt'
    if ((Test-Path -LiteralPath $progressFile) -and $script:duration -gt 0) {
        try {
            $recent = Get-Content -LiteralPath $progressFile -Tail 24 -ErrorAction Stop
            $value = $recent | Where-Object { $_ -match '^out_time_ms=\d+' } | Select-Object -Last 1
            if ($value) {
                $seconds = ([double]($value -replace '^out_time_ms=', '')) / 1000000
                $bar.Value = [Math]::Min(99, [Math]::Max(0, [int](100 * $seconds / $script:duration)))
                $status.Text = "压制中：$($bar.Value)% · $([int]$seconds) / $([int]$script:duration) 秒"
            }
        } catch {}
    }
    if (-not $script:job.HasExited) { return }
    $timer.Stop()
    $exit = $script:job.ExitCode
    $errorText = $script:job.StandardError.ReadToEnd()
    $script:job.Dispose(); $script:job = $null
    $start.Enabled = $true; $cancel.Enabled = $false
    if ($script:cancelled) {
        $status.Text = '已取消。'; Write-Log '压制已取消，未完成的输出文件已删除。'
        if (Test-Path -LiteralPath $script:output) { Remove-Item -LiteralPath $script:output -Force }
    } elseif ($exit -eq 0 -and (Test-Path -LiteralPath $script:output)) {
        $bar.Value = 100; $status.Text = "压制完成：$script:output"; Write-Log $status.Text
    } else {
        $status.Text = "压制失败（FFmpeg 退出码 $exit）。"
        Write-Log (($errorText | Select-Object -Last 1) -join '')
        if (Test-Path -LiteralPath $script:output) { Remove-Item -LiteralPath $script:output -Force }
    }
    if (Test-Path -LiteralPath $script:work) { Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue }
})

$cancel.Add_Click({
    if (-not $script:job) { return }
    $script:cancelled = $true; $cancel.Enabled = $false
    try { $script:job.Kill() } catch {}
})

$start.Add_Click({
    $script:ffmpeg = Find-Tool 'ffmpeg'; $script:ffprobe = Find-Tool 'ffprobe'
    if (-not $script:ffmpeg) { $status.Text = '缺少 FFmpeg，请点“检查 / 安装 FFmpeg”。'; return }
    if (-not (Test-Path -LiteralPath $video.Text -PathType Leaf) -or -not (Test-Path -LiteralPath $ass.Text -PathType Leaf)) {
        $status.Text = '请先选择视频和 ASS 字幕。'; return
    }
    if (-not $out.Text) { $status.Text = '请先选择输出位置。'; return }
    if ($out.Text -eq $video.Text -or $out.Text -eq $ass.Text) { $status.Text = '输出文件不能覆盖输入文件。'; return }
    if ((Test-Path -LiteralPath $out.Text) -and
        [Windows.Forms.MessageBox]::Show('输出文件已存在，是否覆盖？', '确认覆盖', 'YesNo', 'Warning') -ne 'Yes') { return }
    try {
        $script:work = Join-Path ([IO.Path]::GetTempPath()) ('quick-hardsub-' + [guid]::NewGuid().ToString('N'))
        [void](New-Item -ItemType Directory -Path $script:work)
        Copy-Item -LiteralPath $ass.Text -Destination (Join-Path $script:work 'subtitle.ass')
        if ($script:selectedFonts.Count) {
            $fontDir = Join-Path $script:work 'fonts'; [void](New-Item -ItemType Directory -Path $fontDir)
            $n = 0
            foreach ($font in $script:selectedFonts) {
                if (-not (Test-Path -LiteralPath $font -PathType Leaf)) { throw "字体不存在：$font" }
                $extension = [IO.Path]::GetExtension($font).ToLowerInvariant()
                if ($extension -notin @('.ttf', '.otf', '.ttc', '.otc')) { throw "不支持的字体：$font" }
                $n++; Copy-Item -LiteralPath $font -Destination (Join-Path $fontDir ("font$n$extension"))
            }
        }
        $filters = Run-Tool $script:ffmpeg '-hide_banner -filters'
        if ($filters -notmatch '(?m)^\s*[.A-Z|]+\s+ass\s') { throw '此 FFmpeg 未包含 libass（ass 滤镜）。' }
        $encoder = @('libx264', 'libx265', 'libsvtav1')[$codec.SelectedIndex]
        $encoders = Run-Tool $script:ffmpeg '-hide_banner -encoders'
        if ($encoders -notmatch "(?m)^\s*[A-Z|.]+\s+$encoder\s") { throw "此 FFmpeg 未包含 $encoder 编码器。" }
        $script:duration = 0.0
        if ($script:ffprobe) {
            try {
                $probe = Run-Tool $script:ffprobe ('-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ' + (Quote-Arg $video.Text))
                $script:duration = [double]::Parse($probe.Trim(), [Globalization.CultureInfo]::InvariantCulture)
            } catch { Write-Log 'FFprobe 未能取得时长，仍可压制，但无法显示百分比。' }
        }
        $script:output = $out.Text; $script:cancelled = $false; $bar.Value = 0
        $preset = @('medium', 'medium', '6')[$codec.SelectedIndex]
        $crf = @(22, 27, 32)[$codec.SelectedIndex]
        $assFilter = if ($script:selectedFonts.Count) { 'ass=subtitle.ass:fontsdir=fonts' } else { 'ass=subtitle.ass' }
        # Relative ASCII filter paths are resolved against our temporary working directory.
        $args = '-hide_banner -nostdin -loglevel error -y -progress progress.txt -i ' + (Quote-Arg $video.Text) +
            ' -map 0:v:0 -map 0:a? -sn -vf ' + $assFilter +
            ' -c:v ' + $encoder + ' -preset ' + $preset + ' -crf ' + $crf +
            ' -c:a copy ' + (Quote-Arg $script:output)
        $script:job = New-Object System.Diagnostics.Process
        $script:job.StartInfo.FileName = $script:ffmpeg
        $script:job.StartInfo.Arguments = $args
        $script:job.StartInfo.WorkingDirectory = $script:work
        $script:job.StartInfo.UseShellExecute = $false
        $script:job.StartInfo.CreateNoWindow = $true
        $script:job.StartInfo.RedirectStandardError = $true
        [void]$script:job.Start()
        $start.Enabled = $false; $cancel.Enabled = $true; $status.Text = '正在压制…'
        Write-Log "开始：$encoder；输出：$script:output"
        $timer.Start()
    } catch {
        $status.Text = "无法开始：$($_.Exception.Message)"
        Write-Log $status.Text
        if ($script:work -and (Test-Path -LiteralPath $script:work)) {
            Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
})

$form.Add_FormClosing({
    param($sender, $eventArgs)
    if ($script:job -and -not $script:job.HasExited) {
        if ([Windows.Forms.MessageBox]::Show('正在压制，确定终止并删除未完成的输出吗？', '退出', 'YesNo', 'Warning') -ne 'Yes') {
            $eventArgs.Cancel = $true; return
        }
        try { $script:job.Kill(); $script:job.WaitForExit() } catch {}
        if ($script:output -and (Test-Path -LiteralPath $script:output)) { Remove-Item -LiteralPath $script:output -Force -ErrorAction SilentlyContinue }
    }
    if ($script:work -and (Test-Path -LiteralPath $script:work)) { Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue }
})

if ($script:ffmpeg) {
    $status.Text = "FFmpeg：$script:ffmpeg"
    Write-Log '已找到 FFmpeg；此版本直接在 Windows 本机压制，无视频体积上限。'
} else {
    $status.Text = '未找到 FFmpeg。请点“检查 / 安装 FFmpeg”。'
}
[void]$form.ShowDialog()
