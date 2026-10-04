# Structured output argument validation. No input URLs, file paths or shell commands.
function Get-MediaTaskArgs($Task) {
    if ([int]$Task.version -notin @(1,2,3,4) -or $Task.operation -notin @('copy','transcode','hardsub')) { throw 'Unsupported media task.' }
    $start=[double]$Task.start; $end=[double]$Task.end
    if ([double]::IsNaN($start) -or [double]::IsInfinity($start) -or [double]::IsNaN($end) -or [double]::IsInfinity($end) -or $start -lt 0 -or $end -le $start) { throw 'Invalid task range.' }
    $values=@{
        '-ss'='^(?:0)$'
        '-map'='^(?:(?:0|1):(?:v:\d{1,2}|a\?|a:\d{1,2}|s\?)|0:t\?)$'
        '-c:v'='^(?:copy|libx264|libx265|libsvtav1|h264_nvenc|hevc_nvenc|av1_nvenc)$'
        '-c:a'='^(?:copy|aac|libopus)$'
        '-ac'='^(?:\d{1,2})$'
        '-ar'='^(?:\d{4,6})$'
        '-vsync'='^(?:0|cfr|vfr)$'
        '-c:s'='^(?:copy)$'
        '-c:t'='^(?:copy)$'
        '-map_metadata'='^(?:0|-1)$'
        '-map_chapters'='^(?:0|-1)$'
        '-preset'='^(?:ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow|[0-9]|1[0-3]|p[1-7])$'
        '-rc'='^(?:vbr)$'
        '-b:v'='^(?:\d{1,10})$'
        '-crf'='^(?:\d{1,2}(?:\.\d+)?)$'
        '-cq'='^(?:\d{1,2}(?:\.\d+)?)$'
        '-maxrate'='^(?:\d{1,10})$'
        '-bufsize'='^(?:\d{1,10})$'
        '-g'='^(?:\d{1,6})$'
        '-bf'='^(?:\d{1,2})$'
        '-refs'='^(?:\d{1,2})$'
        '-threads'='^(?:\d{1,3})$'
        '-r'='^(?:\d{1,6}(?:\.\d+)?(?:/\d{1,6})?)$'
        '-fps_mode'='^(?:passthrough|cfr|vfr)$'
        '-pix_fmt'='^(?:yuv420p|yuv420p10le|yuv444p|yuv444p10le|p010le)$'
        '-profile:v'='^(?:[A-Za-z0-9_.-]{1,40})$'
        '-level:v'='^(?:[A-Za-z0-9_.-]{1,40})$'
        '-tune'='^(?:[A-Za-z0-9_.-]{1,40})$'
        '-multipass'='^(?:disabled|qres|fullres)$'
        '-rc-lookahead'='^(?:\d{1,2})$'
        '-spatial-aq'='^(?:0|1)$'
        '-temporal-aq'='^(?:0|1)$'
        '-aq-strength'='^(?:\d{1,2})$'
        '-b:a'='^(?:\d{1,7})$'
        '-frames:v'='^(?:\d{1,9})$'
        '-x264-params'='^(?:(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\d+(?:\.\d+)?(?::(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\d+(?:\.\d+)?)*)$'
        '-x265-params'='^(?:(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\d+(?:\.\d+)?(?::(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\d+(?:\.\d+)?)*)$'
        '-svtav1-params'='^(?:(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\d+(?:\.\d+)?(?::(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\d+(?:\.\d+)?)*)$'
    }
    $filters=@(
        '^(?:setpts=PTS[+-]\d+(?:\.\d+)?/TB)$',
        '^(?:crop=\d+:\d+:\d+:\d+)$',
        '^(?:(?:bwdif|yadif)=mode=send_frame:parity=auto:deint=interlaced)$',
        '^(?:scale=(?:-2|\d+):(?:-2|\d+):flags=(?:bilinear|bicubic|lanczos|spline|neighbor))$',
        '^(?:transpose=(?:clock|cclock))$',
        '^(?:hflip|vflip|setsar=1|hqdn3d|deband|unsharp)$',
        '^(?:ass=__ASS__:fontsdir=__FONTS__)$',
        '^(?:pad=ceil\(iw/2\)\*2:ceil\(ih/2\)\*2:0:0)$'
    )
    $args=@($Task.outputArgs)
    if($args.Count -lt 2 -or $args.Count -gt 128){throw 'Invalid output options.'}
    $result=New-Object 'System.Collections.Generic.List[string]'
    $seen=@{}
    for($i=0;$i -lt $args.Count;$i++){
        $flag=[string]$args[$i]
        if($flag -ne '-map' -and $seen.ContainsKey($flag)){throw 'Duplicate output option.'}
        $seen[$flag]=$true
        $result.Add($flag)
        if($flag -eq '-sn'){continue}
        $i++
        if($i -ge $args.Count){throw 'Missing option value.'}
        $value=[string]$args[$i]
        if($value.Length -gt 2048){throw 'Option value too long.'}
        if($flag -eq '-vf'){
            if($Task.operation -eq 'copy'){throw 'Copy cannot filter.'}
            foreach($part in $value.Split(',')){
                $valid=$false
                foreach($pattern in $filters){if($part -cmatch $pattern){$valid=$true;break}}
                if(-not $valid){throw 'Unsupported filter.'}
            }
            if($value.Contains('ass=__ASS__') -ne ($Task.operation -eq 'hardsub')){throw 'Subtitle mode mismatch.'}
        }elseif(-not $values.ContainsKey($flag) -or $value -cnotmatch $values[$flag]){throw "Unsupported output option: $flag"}
        if($flag -eq '-c:v' -and (($value -eq 'copy') -ne ($Task.operation -eq 'copy'))){throw 'Codec mode mismatch.'}
        $result.Add($value)
    }
    if(-not $seen.ContainsKey('-c:v')){throw 'Missing video codec.'}
    if($Task.twoPass -and ($result[$result.IndexOf('-c:v')+1] -ne 'libx264' -or -not $seen.ContainsKey('-b:v'))){throw 'Two-pass requires x264 bitrate mode.'}
    return ,$result.ToArray()
}

function Get-MediaFirstPassArgs([string[]]$OutputOptions) {
    $out=New-Object 'System.Collections.Generic.List[string]'
    for($i=0;$i -lt $OutputOptions.Count;$i++){
        $flag=$OutputOptions[$i]
        if($flag -eq '-sn'){continue}
        $i++;$value=$OutputOptions[$i]
        if($flag -in @('-c:a','-b:a','-ac','-ar','-c:s','-c:t','-map_metadata','-map_chapters')){continue}
        if($flag -eq '-map' -and $value -notmatch '^\d+:v:'){continue}
        $out.Add($flag);$out.Add($value)
    }
    $out.Add('-an');$out.Add('-sn')
    return ,$out.ToArray()
}
function Test-MediaOutput($Task, $Video) {
    if($Task.expectedWidth -and ([int]$Video.width -ne [int]$Task.expectedWidth -or [int]$Video.height -ne [int]$Task.expectedHeight)){throw 'Output resolution differs from settings.'}
    if($Task.expectedFps){
        $rate=([string]$Video.avg_frame_rate).Split('/')
        $fps=if($rate.Count -eq 2 -and [double]$rate[1] -ne 0){[double]$rate[0]/[double]$rate[1]}else{0}
        if([Math]::Abs($fps-[double]$Task.expectedFps) -gt 0.01){throw 'Output frame rate differs from settings.'}
    }
    if($Task.operation -ne 'copy' -and $Task.expectedBitDepth){
        $bits=if([string]$Video.pix_fmt -match '10|p010'){10}else{8}
        if($bits -ne [int]$Task.expectedBitDepth){throw 'Output bit depth differs from settings.'}
    }
}
