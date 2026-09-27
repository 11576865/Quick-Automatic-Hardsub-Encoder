# Windows 11 native encoder. Uses system/bundled FFmpeg and native GPU/CPU encoders.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
. (Join-Path $PSScriptRoot 'output-safety.ps1')
. (Join-Path $PSScriptRoot 'native-backend.ps1')

$script:ffmpeg = Find-NativeTool 'ffmpeg' $PSScriptRoot
$script:ffprobe = Find-NativeTool 'ffprobe' $PSScriptRoot
$script:capabilities = $null
$script:encoderOptions = @()
$script:selectedFonts = @()
$script:job = $null
$script:work = $null
$script:output = $null
$script:tempOutput = $null
$script:stderrTask = $null
$script:duration = 0.0
$script:cancelled = $false

function New-Label([string]$Text,[int]$Left,[int]$Top,[int]$Width=100,[int]$Height=24) {
    $c=New-Object System.Windows.Forms.Label
    $c.Text=$Text; $c.Left=$Left; $c.Top=$Top; $c.Width=$Width; $c.Height=$Height
    return $c
}
function New-ReadOnlyBox([int]$Left,[int]$Top,[int]$Width) {
    $c=New-Object System.Windows.Forms.TextBox
    $c.Left=$Left; $c.Top=$Top; $c.Width=$Width; $c.ReadOnly=$true
    return $c
}
function New-Button([string]$Text,[int]$Left,[int]$Top,[int]$Width) {
    $c=New-Object System.Windows.Forms.Button
    $c.Text=$Text; $c.Left=$Left; $c.Top=$Top; $c.Width=$Width; $c.Height=30
    return $c
}

$form=New-Object System.Windows.Forms.Form
$form.Text='快捷自动硬字幕压制器 · Windows Native'
$form.Width=980; $form.Height=760
$form.MinimumSize=New-Object System.Drawing.Size(900,680)
$form.StartPosition='CenterScreen'
$form.Font=New-Object System.Drawing.Font('Microsoft YaHei UI',9)

$nativeTitle=New-Label 'WINDOWS NATIVE' 18 14 130 22
$nativeTitle.ForeColor=[System.Drawing.Color]::FromArgb(0,137,123)
$form.Controls.Add($nativeTitle)
$hardware=New-Label '正在检测 CPU / GPU / FFmpeg 编码器…' 150 14 790 44
$hardware.Anchor='Top,Left,Right'; $form.Controls.Add($hardware)

$form.Controls.Add((New-Label '视频' 18 66))
$video=New-ReadOnlyBox 122 64 690; $video.Anchor='Top,Left,Right'; $form.Controls.Add($video)
$pickVideo=New-Button '选择视频' 822 62 120; $pickVideo.Anchor='Top,Right'; $form.Controls.Add($pickVideo)

$form.Controls.Add((New-Label 'ASS 字幕' 18 104))
$ass=New-ReadOnlyBox 122 102 690; $ass.Anchor='Top,Left,Right'; $form.Controls.Add($ass)
$pickAss=New-Button '选择字幕' 822 100 120; $pickAss.Anchor='Top,Right'; $form.Controls.Add($pickAss)

$form.Controls.Add((New-Label '字体文件' 18 142))
$fonts=New-ReadOnlyBox 122 140 690; $fonts.Anchor='Top,Left,Right'; $form.Controls.Add($fonts)
$pickFonts=New-Button '选择字体' 822 138 120; $pickFonts.Anchor='Top,Right'; $form.Controls.Add($pickFonts)

$form.Controls.Add((New-Label '输出 MKV' 18 180))
$out=New-ReadOnlyBox 122 178 690; $out.Anchor='Top,Left,Right'; $form.Controls.Add($out)
$pickOut=New-Button '选择位置' 822 176 120; $pickOut.Anchor='Top,Right'; $form.Controls.Add($pickOut)

$form.Controls.Add((New-Label '编码器' 18 220))
$codec=New-Object System.Windows.Forms.ComboBox
$codec.Left=122; $codec.Top=217; $codec.Width=360; $codec.DropDownStyle='DropDownList'
$form.Controls.Add($codec)
$quality=New-Label '检测后显示实际可用的 NVENC / CPU 编码器。' 495 220 445 38
$quality.Anchor='Top,Left,Right'; $form.Controls.Add($quality)

$refreshHardware=New-Button '重新检测硬件' 18 260 135; $form.Controls.Add($refreshHardware)
$benchmark=New-Button '测试同格式 GPU / CPU' 164 260 185; $benchmark.Enabled=$false; $form.Controls.Add($benchmark)
$install=New-Button '检查 / 安装 FFmpeg' 360 260 175; $form.Controls.Add($install)

$status=New-Label '等待输入。' 18 302 924 42
$status.Anchor='Top,Left,Right'; $form.Controls.Add($status)
$bar=New-Object System.Windows.Forms.ProgressBar
$bar.Left=18; $bar.Top=342; $bar.Width=924; $bar.Height=18
$bar.Anchor='Top,Left,Right'; $form.Controls.Add($bar)

$start=New-Button '开始压制' 18 377 145; $start.Enabled=$false; $form.Controls.Add($start)
$cancel=New-Button '取消' 174 377 105; $cancel.Enabled=$false; $form.Controls.Add($cancel)

$benchmarkTitle=New-Label '短样本比较（同编码格式）' 18 422 260 24
$benchmarkTitle.Font=New-Object System.Drawing.Font($form.Font,[System.Drawing.FontStyle]::Bold)
$form.Controls.Add($benchmarkTitle)

$results=New-Object System.Windows.Forms.ListView
$results.Left=18; $results.Top=448; $results.Width=924; $results.Height=132
$results.Anchor='Top,Left,Right'; $results.View='Details'; $results.FullRowSelect=$true; $results.GridLines=$true
[void]$results.Columns.Add('编码器',230)
[void]$results.Columns.Add('设备',80)
[void]$results.Columns.Add('耗时',85)
[void]$results.Columns.Add('速度',90)
[void]$results.Columns.Add('大小',90)
[void]$results.Columns.Add('SSIM',90)
[void]$results.Columns.Add('结论',210)
$form.Controls.Add($results)

$log=New-Object System.Windows.Forms.TextBox
$log.Left=18; $log.Top=594; $log.Width=924; $log.Height=110
$log.Multiline=$true; $log.ReadOnly=$true; $log.ScrollBars='Vertical'
$log.Anchor='Top,Bottom,Left,Right'; $form.Controls.Add($log)

function Write-Log([string]$Text) { $log.AppendText($Text+[Environment]::NewLine) }

function Resolve-SelectedProfile {
    if($codec.SelectedIndex -lt 0 -or $codec.SelectedIndex -ge $script:encoderOptions.Count){return $null}
    return $script:encoderOptions[$codec.SelectedIndex]
}

function Refresh-Capabilities {
    $script:ffmpeg=Find-NativeTool 'ffmpeg' $PSScriptRoot
    $script:ffprobe=Find-NativeTool 'ffprobe' $PSScriptRoot
    $codec.Items.Clear(); $script:encoderOptions=@()
    if(-not $script:ffmpeg){
        $script:capabilities=$null
        $hardware.Text='未找到 FFmpeg。Windows Native 尚不可用。'
        $quality.Text='安装 FFmpeg 后重新检测。'
        $start.Enabled=$false; $benchmark.Enabled=$false
        return
    }

    $status.Text='正在检测 Windows Native 编码器…'
    [System.Windows.Forms.Application]::DoEvents()
    $script:capabilities=Get-NativeCapabilities $script:ffmpeg $script:ffprobe $PSScriptRoot
    $gpuText=if($script:capabilities.Gpus.Count){$script:capabilities.Gpus -join ' / '}else{'未检测到 NVIDIA GPU'}
    $hardware.Text="CPU: $($script:capabilities.Cpu)  ·  GPU: $gpuText"

    $available=@($script:capabilities.Encoders | Where-Object {$_.Available})
    foreach($profile in $available){
        $script:encoderOptions += $profile
        [void]$codec.Items.Add($profile.Label)
    }
    if($script:encoderOptions.Count){
        $codec.SelectedIndex=0; $start.Enabled=$true; $benchmark.Enabled=$true
    }else{
        [void]$codec.Items.Add('没有可用的视频编码器')
        $codec.SelectedIndex=0; $start.Enabled=$false; $benchmark.Enabled=$false
    }
    $nvencCount=@($available | Where-Object {$_.Hardware}).Count
    $cpuCount=@($available | Where-Object {-not $_.Hardware}).Count
    $assState=if($script:capabilities.HasAss){'可用'}else{'缺失'}
    $quality.Text="可用：NVENC $nvencCount · CPU $cpuCount · libass $assState"
    $status.Text="Windows Native 已就绪：$($available.Count) 个编码器可用。"

    Write-Log "FFmpeg: $script:ffmpeg"
    if($script:ffprobe){Write-Log "FFprobe: $script:ffprobe"}
    Write-Log "CPU: $($script:capabilities.Cpu)"
    Write-Log "GPU: $gpuText"
    foreach($p in $script:capabilities.Encoders){
        $stateText=if($p.Available){'可用'}elseif($p.Listed -and $p.Hardware){'FFmpeg 已列出，但 NVENC 运行探测失败'}else{'不可用'}
        Write-Log "$($p.Label): $stateText"
    }
}

function New-WorkDirectory([string]$Prefix){
    $path=Join-Path ([IO.Path]::GetTempPath()) ($Prefix+[guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $path)
    return $path
}

function Stage-SubtitleAssets([string]$WorkDir){
    Copy-Item -LiteralPath $ass.Text -Destination (Join-Path $WorkDir 'subtitle.ass')
    if($script:selectedFonts.Count){
        $fontDir=Join-Path $WorkDir 'fonts'; [void](New-Item -ItemType Directory -Path $fontDir)
        $n=0
        foreach($font in $script:selectedFonts){
            if(-not(Test-Path -LiteralPath $font -PathType Leaf)){throw "字体不存在：$font"}
            $extension=[IO.Path]::GetExtension($font).ToLowerInvariant()
            if($extension -notin @('.ttf','.otf','.ttc','.otc')){throw "不支持的字体：$font"}
            $n++; Copy-Item -LiteralPath $font -Destination (Join-Path $fontDir ("font$n$extension"))
        }
    }
}
function Get-AssFilter { if($script:selectedFonts.Count){return 'ass=subtitle.ass:fontsdir=fonts'} return 'ass=subtitle.ass' }

function Read-MediaDuration {
    if(-not $script:ffprobe){return 0.0}
    try{
        $r=Invoke-NativeTool $script:ffprobe ('-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $video.Text))
        return [double]::Parse($r.StdOut.Trim(),[Globalization.CultureInfo]::InvariantCulture)
    }catch{
        Write-Log 'FFprobe 未能取得时长。'; return 0.0
    }
}

function Test-OutputMedia([string]$Path){
    if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw '临时成品不存在。'}
    if((Get-Item -LiteralPath $Path).Length -le 0){throw '临时成品为空。'}
    if($script:ffprobe){
        $r=Invoke-NativeTool $script:ffprobe ('-v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 '+(Quote-NativeArg $Path))
        if(-not $r.StdOut.Trim()){throw 'FFprobe 未在临时成品中发现视频流。'}
    }
}

function Measure-Ssim([string]$Candidate,[string]$Reference){
    try{
        $args='-hide_banner -nostdin -i '+(Quote-NativeArg $Candidate)+' -i '+(Quote-NativeArg $Reference)+' -lavfi "[0:v][1:v]ssim" -f null NUL'
        $r=Invoke-NativeTool $script:ffmpeg $args -AllowFailure
        $text=$r.StdErr+[Environment]::NewLine+$r.StdOut
        $m=[regex]::Match($text,'All:(?<value>[0-9.]+)')
        if($m.Success){return [double]::Parse($m.Groups['value'].Value,[Globalization.CultureInfo]::InvariantCulture)}
    }catch{}
    return $null
}

function Add-BenchmarkRow($Profile,[double]$Elapsed,[double]$Realtime,[long]$Bytes,$Ssim,[string]$Conclusion=''){
    $item=New-Object System.Windows.Forms.ListViewItem($Profile.Label)
    [void]$item.SubItems.Add($(if($Profile.Hardware){'GPU'}else{'CPU'}))
    [void]$item.SubItems.Add(("{0:N2} s" -f $Elapsed))
    [void]$item.SubItems.Add(("{0:N2}x" -f $Realtime))
    [void]$item.SubItems.Add(("{0:N1} MB" -f ($Bytes/1MB)))
    [void]$item.SubItems.Add($(if($null -ne $Ssim){("{0:F5}" -f $Ssim)}else{'—'}))
    [void]$item.SubItems.Add($Conclusion)
    [void]$results.Items.Add($item)
}

function Run-CodecBenchmark {
    $selected=Resolve-SelectedProfile
    if(-not $selected){throw '没有选择有效编码器。'}
    $peers=@(Get-NativeCodecPeers $script:capabilities $selected.Key)
    if(-not $peers.Count){throw '当前编码格式没有可测试的编码器。'}
    if(-not(Test-Path -LiteralPath $video.Text -PathType Leaf) -or -not(Test-Path -LiteralPath $ass.Text -PathType Leaf)){throw '请先选择视频和 ASS 字幕。'}
    if(-not $script:capabilities.HasAss){throw '当前 FFmpeg 缺少 libass / ass 滤镜。'}

    $results.Items.Clear()
    $work=New-WorkDirectory 'quick-hardsub-bench-'
    try{
        Stage-SubtitleAssets $work
        $duration=Read-MediaDuration
        $sampleLength=if($duration -gt 0){[Math]::Min(10.0,[Math]::Max(2.0,$duration))}else{8.0}
        $sampleStart=if($duration -gt ($sampleLength+4)){[Math]::Min($duration*0.2,$duration-$sampleLength-1)}else{0.0}
        $assFilter=Get-AssFilter
        $reference=Join-Path $work 'reference.mkv'
        $sampleStartText=$sampleStart.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $sampleLengthText=$sampleLength.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
        $referenceArgs='-hide_banner -nostdin -loglevel error -y -ss '+$sampleStartText+' -t '+$sampleLengthText+' -i '+(Quote-NativeArg $video.Text)+' -an -sn -vf '+$assFilter+' -c:v ffv1 '+(Quote-NativeArg $reference)
        $status.Text='正在生成短样本无损参考…'; [System.Windows.Forms.Application]::DoEvents()
        $refResult=Invoke-NativeTool $script:ffmpeg $referenceArgs -AllowFailure
        if($refResult.ExitCode -ne 0){throw ('生成无损参考失败：'+$refResult.StdErr.Trim())}

        $benchResults=@()
        foreach($profile in $peers){
            $candidate=Join-Path $work ($profile.Key+'.mkv')
            $encoderArgs=Get-NativeEncoderArguments $profile
            $args='-hide_banner -nostdin -loglevel error -y -ss '+$sampleStartText+' -t '+$sampleLengthText+' -i '+(Quote-NativeArg $video.Text)+' -an -sn -vf '+$assFilter+' '+$encoderArgs+' '+(Quote-NativeArg $candidate)
            $status.Text="短样本测试：$($profile.Label)…"; [System.Windows.Forms.Application]::DoEvents()
            $sw=[Diagnostics.Stopwatch]::StartNew()
            $run=Invoke-NativeTool $script:ffmpeg $args -AllowFailure
            $sw.Stop()
            if($run.ExitCode -ne 0 -or -not(Test-Path -LiteralPath $candidate)){
                Write-Log "$($profile.Label) 样本失败：$($run.StdErr.Trim())"; continue
            }
            $bytes=(Get-Item -LiteralPath $candidate).Length
            $ssim=Measure-Ssim $candidate $reference
            $elapsed=[Math]::Max(.001,$sw.Elapsed.TotalSeconds)
            $rt=$sampleLength/$elapsed
            $benchResults += [pscustomobject]@{Profile=$profile;Elapsed=$elapsed;Realtime=$rt;Bytes=$bytes;Ssim=$ssim}
        }
        if(-not $benchResults.Count){throw '没有任何编码器完成短样本测试。'}

        $withSsim=@($benchResults | Where-Object {$null -ne $_.Ssim})
        $bestSsim=if($withSsim.Count){($withSsim|Measure-Object -Property Ssim -Maximum).Maximum}else{$null}
        $recommend=$null
        $hardwareResults=@($benchResults|Where-Object {$_.Profile.Hardware})
        $softwareResults=@($benchResults|Where-Object {-not $_.Profile.Hardware})

        if($hardwareResults.Count -and $softwareResults.Count -and $null -ne $bestSsim){
            $hw=$hardwareResults|Sort-Object @{Expression='Ssim';Descending=$true},@{Expression='Elapsed';Descending=$false}|Select-Object -First 1
            $swBest=$softwareResults|Sort-Object @{Expression='Ssim';Descending=$true},@{Expression='Bytes';Descending=$false}|Select-Object -First 1
            if($hw.Ssim -ge ($bestSsim-0.002) -and $hw.Bytes -le ($swBest.Bytes*1.18) -and $hw.Elapsed -le $swBest.Elapsed){$recommend=$hw}
        }
        if(-not $recommend){
            $eligible=if($null -ne $bestSsim){@($benchResults|Where-Object {$null -ne $_.Ssim -and $_.Ssim -ge ($bestSsim-0.001)})}else{@($benchResults)}
            $recommend=$eligible|Sort-Object @{Expression='Bytes';Descending=$false},@{Expression='Elapsed';Descending=$false}|Select-Object -First 1
        }

        foreach($r in $benchResults){
            $conclusion=if($r -eq $recommend){'建议：质量接近时优先速度/体积平衡'}else{''}
            Add-BenchmarkRow $r.Profile $r.Elapsed $r.Realtime $r.Bytes $r.Ssim $conclusion
        }
        for($i=0;$i -lt $script:encoderOptions.Count;$i++){
            if($script:encoderOptions[$i].Key -eq $recommend.Profile.Key){$codec.SelectedIndex=$i;break}
        }
        $status.Text="短样本完成；已选择：$($recommend.Profile.Label)"
        Write-Log "自动选择：$($recommend.Profile.Label)。规则：同格式内，SSIM 接近时优先更快且体积不过度膨胀的方案。"
    }finally{
        if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
    }
}

$pickVideo.Add_Click({
    $dialog=New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter='视频文件|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.ts|所有文件|*.*'
    if($dialog.ShowDialog()-eq'OK'){$video.Text=$dialog.FileName}
    $dialog.Dispose()
})
$pickAss.Add_Click({
    $dialog=New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter='ASS 字幕|*.ass|所有文件|*.*'
    if($dialog.ShowDialog()-eq'OK'){$ass.Text=$dialog.FileName}
    $dialog.Dispose()
})
$pickFonts.Add_Click({
    $dialog=New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter='字体|*.ttf;*.otf;*.ttc;*.otc|所有文件|*.*'; $dialog.Multiselect=$true
    if($dialog.ShowDialog()-eq'OK'){$script:selectedFonts=@($dialog.FileNames);$fonts.Text="已选择 $($script:selectedFonts.Count) 个字体文件"}
    $dialog.Dispose()
})
$pickOut.Add_Click({
    $dialog=New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter='Matroska 视频|*.mkv';$dialog.DefaultExt='mkv'
    if($video.Text){$dialog.FileName=[IO.Path]::GetFileNameWithoutExtension($video.Text)+'_hardsub.mkv'}
    if($dialog.ShowDialog()-eq'OK'){$out.Text=$dialog.FileName}
    $dialog.Dispose()
})

$codec.Add_SelectedIndexChanged({
    $p=Resolve-SelectedProfile
    if($p){
        $device=if($p.Hardware){'NVIDIA GPU'}else{'CPU'}
        $tune=if($p.Hardware -and $p.Tune){" · tune $($p.Tune)"}else{''}
        $quality.Text="$device · $($p.QualityLabel)$tune · 音频 stream copy"
    }
})
$refreshHardware.Add_Click({Refresh-Capabilities})
$benchmark.Add_Click({
    try{$benchmark.Enabled=$false;$start.Enabled=$false;Run-CodecBenchmark}
    catch{$status.Text="测试失败：$($_.Exception.Message)";Write-Log $status.Text}
    finally{$benchmark.Enabled=($script:encoderOptions.Count-gt 0);$start.Enabled=($script:encoderOptions.Count-gt 0)}
})

$install.Add_Click({
    $script:ffmpeg=Find-NativeTool 'ffmpeg' $PSScriptRoot; $script:ffprobe=Find-NativeTool 'ffprobe' $PSScriptRoot
    if($script:ffmpeg -and $script:ffprobe){
        Refresh-Capabilities
        $message='已找到：'+[Environment]::NewLine+$script:ffmpeg+[Environment]::NewLine+$script:ffprobe
        [Windows.Forms.MessageBox]::Show($message,'FFmpeg')|Out-Null;return
    }
    $message='未找到完整 FFmpeg（含 ffprobe）。'+[Environment]::NewLine+[Environment]::NewLine+'可把 ffmpeg.exe、ffprobe.exe 放入仓库 tools\ffmpeg\bin。'+[Environment]::NewLine+[Environment]::NewLine+'也可以使用 winget 安装 Gyan.FFmpeg。是否现在启动 winget？'
    if([Windows.Forms.MessageBox]::Show($message,'首次安装','YesNo','Question')-ne'Yes'){return}
    if(-not(Get-Command winget.exe -ErrorAction SilentlyContinue)){
        [Windows.Forms.MessageBox]::Show('此电脑没有 winget。请从 FFmpeg 官网取得 Windows 构建并放到 tools\ffmpeg\bin。','无法自动安装')|Out-Null;return
    }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k winget install --id Gyan.FFmpeg -e --source winget'|Out-Null
    Write-Log '已打开 winget 安装窗口；完成后重新检测硬件。'
})

$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=600
$timer.Add_Tick({
    if(-not $script:job){return}
    $progressFile=Join-Path $script:work 'progress.txt'
    if((Test-Path -LiteralPath $progressFile)-and $script:duration-gt 0){
        try{
            $recent=Get-Content -LiteralPath $progressFile -Tail 24 -ErrorAction Stop
            $value=$recent|Where-Object {$_ -match '^out_time_ms=\d+'}|Select-Object -Last 1
            if($value){
                $seconds=([double]($value-replace'^out_time_ms=',''))/1000000
                $bar.Value=[Math]::Min(99,[Math]::Max(0,[int](100*$seconds/$script:duration)))
                $status.Text="压制中：$($bar.Value)% · $([int]$seconds) / $([int]$script:duration) 秒"
            }
        }catch{}
    }
    if(-not $script:job.HasExited){return}
    $timer.Stop();$exit=$script:job.ExitCode
    $errorText=if($script:stderrTask){$script:stderrTask.Result}else{''}
    $script:job.Dispose();$script:job=$null;$script:stderrTask=$null
    $start.Enabled=$true;$cancel.Enabled=$false;$benchmark.Enabled=$true
    if($script:cancelled){
        $status.Text='已取消。';Write-Log '压制已取消，旧成品未改动。'
        if(Test-Path -LiteralPath $script:tempOutput){Remove-Item -LiteralPath $script:tempOutput -Force}
    }elseif($exit-eq 0){
        try{
            Test-OutputMedia $script:tempOutput
            Publish-VerifiedOutput $script:tempOutput $script:output
            $bar.Value=100;$status.Text="压制完成：$script:output";Write-Log $status.Text
        }catch{
            $status.Text='编码完成，但临时成品验证或替换失败；旧成品仍在。'
            Write-Log "$status.Text $($_.Exception.Message)"
        }
    }else{
        $status.Text="压制失败（FFmpeg 退出码 $exit）。"
        Write-Log (($errorText-split"\r?\n"|Select-Object -Last 8)-join[Environment]::NewLine)
        if(Test-Path -LiteralPath $script:tempOutput){Remove-Item -LiteralPath $script:tempOutput -Force}
    }
    if(Test-Path -LiteralPath $script:work){Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue}
})

$cancel.Add_Click({
    if(-not $script:job){return}
    $script:cancelled=$true;$cancel.Enabled=$false
    try{$script:job.Kill()}catch{}
})

$start.Add_Click({
    $script:ffmpeg=Find-NativeTool 'ffmpeg' $PSScriptRoot; $script:ffprobe=Find-NativeTool 'ffprobe' $PSScriptRoot
    $profile=Resolve-SelectedProfile
    if(-not $script:ffmpeg){$status.Text='缺少 FFmpeg，请点“检查 / 安装 FFmpeg”。';return}
    if(-not $profile -or -not $profile.Available){$status.Text='请选择可用编码器。';return}
    if(-not $script:capabilities.HasAss){$status.Text='当前 FFmpeg 缺少 libass / ass 滤镜。';return}
    if(-not(Test-Path -LiteralPath $video.Text -PathType Leaf) -or -not(Test-Path -LiteralPath $ass.Text -PathType Leaf)){$status.Text='请先选择视频和 ASS 字幕。';return}
    if(-not $out.Text){$status.Text='请先选择输出位置。';return}
    $outputFull=[IO.Path]::GetFullPath($out.Text)
    if([string]::Equals($outputFull,[IO.Path]::GetFullPath($video.Text),[StringComparison]::OrdinalIgnoreCase) -or [string]::Equals($outputFull,[IO.Path]::GetFullPath($ass.Text),[StringComparison]::OrdinalIgnoreCase)){$status.Text='输出文件不能覆盖输入文件。';return}
    if((Test-Path -LiteralPath $out.Text) -and [Windows.Forms.MessageBox]::Show('输出文件已存在，是否覆盖？','确认覆盖','YesNo','Warning')-ne'Yes'){return}
    try{
        $script:work=New-WorkDirectory 'quick-hardsub-'
        Stage-SubtitleAssets $script:work
        $script:duration=Read-MediaDuration
        $script:output=$out.Text;$script:cancelled=$false;$bar.Value=0
        $tempName='.'+[IO.Path]::GetFileNameWithoutExtension($script:output)+'.quick-hardsub-'+[guid]::NewGuid().ToString('N')+'.tmp.mkv'
        $script:tempOutput=Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($script:output))) $tempName
        $assFilter=Get-AssFilter;$encoderArgs=Get-NativeEncoderArguments $profile
        $args='-hide_banner -nostdin -loglevel error -y -progress progress.txt -i '+(Quote-NativeArg $video.Text)+' -map 0:v:0 -map 0:a? -sn -vf '+$assFilter+' '+$encoderArgs+' -c:a copy '+(Quote-NativeArg $script:tempOutput)
        $script:job=New-Object System.Diagnostics.Process
        $script:job.StartInfo.FileName=$script:ffmpeg;$script:job.StartInfo.Arguments=$args;$script:job.StartInfo.WorkingDirectory=$script:work
        $script:job.StartInfo.UseShellExecute=$false;$script:job.StartInfo.CreateNoWindow=$true;$script:job.StartInfo.RedirectStandardError=$true
        [void]$script:job.Start();$script:stderrTask=$script:job.StandardError.ReadToEndAsync()
        $start.Enabled=$false;$benchmark.Enabled=$false;$cancel.Enabled=$true
        $status.Text="正在压制：$($profile.Label)…";Write-Log "开始：$($profile.Label) · $encoderArgs";$timer.Start()
    }catch{
        $status.Text="无法开始：$($_.Exception.Message)";Write-Log $status.Text
        if($script:tempOutput -and (Test-Path -LiteralPath $script:tempOutput)){Remove-Item -LiteralPath $script:tempOutput -Force -ErrorAction SilentlyContinue}
        if($script:work -and (Test-Path -LiteralPath $script:work)){Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue}
    }
})

$form.Add_FormClosing({
    param($sender,$eventArgs)
    if($script:job -and -not $script:job.HasExited){
        if([Windows.Forms.MessageBox]::Show('正在压制，确定终止并删除未完成的输出吗？','退出','YesNo','Warning')-ne'Yes'){$eventArgs.Cancel=$true;return}
        try{$script:job.Kill();$script:job.WaitForExit()}catch{}
        if($script:tempOutput -and (Test-Path -LiteralPath $script:tempOutput)){Remove-Item -LiteralPath $script:tempOutput -Force -ErrorAction SilentlyContinue}
    }
    if($script:work -and (Test-Path -LiteralPath $script:work)){Remove-Item -LiteralPath $script:work -Recurse -Force -ErrorAction SilentlyContinue}
})

Refresh-Capabilities
[void]$form.ShowDialog()
