param([string]$Ffmpeg='ffmpeg',[string]$Ffprobe='ffprobe',[switch]$RequireRuntime,[switch]$IncludeHardsub)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'windows/native-backend.ps1')
. (Join-Path $repo 'windows/media-task.ps1')
$work=Join-Path ([IO.Path]::GetTempPath()) ('qhe-vvc-acceptance-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work)
$bridge=$null
$evidence=Join-Path $repo 'vvc-runtime-evidence'
[void](New-Item -ItemType Directory -Path $evidence -Force)
try {
    # A live validation process must remain immediately queryable and cancellable.
    $sleep=Start-Process powershell -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 30' -PassThru
    try{
        $validationJob=[pscustomobject]@{Started=[pscustomobject]@{Process=$sleep};Cancelled=$false}
        $watch=[Diagnostics.Stopwatch]::StartNew()
        $snapshot=Get-VvcValidationSnapshot $validationJob
        if($snapshot.state -ne 'validating' -or $watch.Elapsed.TotalSeconds -gt 2){throw 'VVC validation status blocked on a running process.'}
        Stop-Process -Id $sleep.Id -Force
        $sleep.WaitForExit()
        $validationJob.Cancelled=$true
        if((Get-VvcValidationSnapshot $validationJob).state -ne 'cancelled'){throw 'VVC validator cancellation was lost.'}
    }finally{if(-not $sleep.HasExited){Stop-Process -Id $sleep.Id -Force};$sleep.Dispose()}
    $tasksPath=Join-Path $work 'tasks.json'
    if($IncludeHardsub){& node (Join-Path $PSScriptRoot 'build-vvc-tasks.mjs') $tasksPath --hardsub}
    else{& node (Join-Path $PSScriptRoot 'build-vvc-tasks.mjs') $tasksPath}
    if($LASTEXITCODE -ne 0){throw 'VVC task generation failed.'}
    $parsedTasks=Get-Content $tasksPath -Raw | ConvertFrom-Json
    $tasks=@($parsedTasks)
    $expectedTasks=if($IncludeHardsub){3}else{2}
    if($tasks.Count -ne $expectedTasks -or $tasks[0].version -is [array]){throw 'Top-level task array was not enumerated.'}
    foreach($task in $tasks){[void](Get-MediaTaskArgs $task)}
    $bad=$tasks[0] | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $bad.outputArgs=@($bad.outputArgs)+@('-crf','32')
    $rejected=$false
    try{[void](Get-MediaTaskArgs $bad)}catch{$rejected=$true}
    if(-not $rejected){throw 'VVC accepted foreign CRF control.'}
    $bad=$tasks[0] | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $bad.outputArgs=@($bad.outputArgs | ForEach-Object {if($_ -eq 'yuv420p10le'){'yuv420p'}else{$_}})
    $rejected=$false
    try{[void](Get-MediaTaskArgs $bad)}catch{$rejected=$true}
    if(-not $rejected){throw 'VVC accepted an incompatible pixel format.'}
    Test-MediaOutput $tasks[0] ([pscustomobject]@{codec_name='vvc';pix_fmt='yuv420p10le';avg_frame_rate='24/1'})
    $rejected=$false
    try{Test-MediaOutput $tasks[0] ([pscustomobject]@{codec_name='hevc';pix_fmt='yuv420p10le';avg_frame_rate='24/1'})}catch{$rejected=$true}
    if(-not $rejected){throw 'VVC output codec substitution was accepted.'}

    $fullHelp=Invoke-NativeTool $Ffmpeg '-hide_banner -h full'
    $fullHelp.StdOut | Set-Content (Join-Path $evidence 'ffmpeg-full-help.txt') -Encoding UTF8
    $listed=Invoke-NativeTool $Ffmpeg '-hide_banner -encoders'
    if(-not (Test-EncoderListed $listed.StdOut 'libvvenc')){
        @{status='UNSUPPORTED';reason='libvvenc not included';structuredTaskTests='PASS'} | ConvertTo-Json | Set-Content (Join-Path $repo 'vvc-native-acceptance.json') -Encoding UTF8
        if($RequireRuntime){throw 'Required actual VVC runtime unavailable: libvvenc not included.'}
        Write-Host 'VVC UNSUPPORTED: libvvenc absent; argument rejection tests passed.'
        exit 0
    }
    $probe=Test-VvcRuntime $Ffmpeg $Ffprobe
    if(-not $probe.Available){throw ('Listed libvvenc runtime acceptance failed: '+$probe.Error)}
    $source=Join-Path $work 'source.mkv'
    $args='-hide_banner -v error -y -f lavfi -i testsrc2=size=128x128:rate=24 -f lavfi -i sine=sample_rate=48000 -t 1 -c:v ffv1 -c:a flac '+(Quote-NativeArg $source)
    [void](Invoke-NativeTool $Ffmpeg $args)
    $token='vvc-ci-'+[guid]::NewGuid().ToString('N')
    $port=18769
    $bridge=Start-Process powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File '+(Quote-NativeArg (Join-Path $repo 'windows/native-bridge.ps1'))+' -NoBrowser -Port '+$port+' -Token '+$token+' -InitialVideo '+(Quote-NativeArg $source)) -PassThru -RedirectStandardOutput (Join-Path $work 'bridge-out.log') -RedirectStandardError (Join-Path $work 'bridge-err.log')
    $base='http://127.0.0.1:'+ $port
    $headers=@{'X-Quick-Hardsub-Token'=$token;Origin=$base}
    $health=$null
    $deadline=(Get-Date).AddSeconds(90)
    while((Get-Date) -lt $deadline){
        try{$health=Invoke-RestMethod -Uri ($base+'/api/health') -Headers $headers -TimeoutSec 5;break}catch{Start-Sleep -Milliseconds 200}
    }
    if(-not $health){throw 'VVC bridge health timeout.'}
    $profile=@($health.encoders | Where-Object {$_.Key -eq 'libvvenc'}) | Select-Object -First 1
    if(-not $profile.Available -or $profile.RuntimeValidation -ne 'encode-mkv-decode-v1'){throw 'VVC health gate did not pass.'}
    @{globalOptions=$health.globalOptions;vvcProfile=$profile} | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $evidence 'capability-snapshot.json') -Encoding UTF8
    $results=@()
    foreach($task in $tasks){
        $request=@{request=@{task=$task;suggestedName='vvc-ci.mkv'}}
        if($task.operation -eq 'hardsub'){
            $request.assText=@'
[Script Info]
ScriptType: v4.00+
PlayResX: 128
PlayResY: 128
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Arial,12,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,4,4,4,1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,VVC actual ASS
'@
        }
        $body=$request | ConvertTo-Json -Depth 30
        $job=Invoke-RestMethod -Uri ($base+'/api/encode') -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
        if(-not $job.ok -or -not $job.jobId){throw 'VVC formal job did not start.'}
        $deadline=(Get-Date).AddSeconds(120)
        do{
            Start-Sleep -Milliseconds 200
            $state=Invoke-RestMethod -Uri ($base+'/api/jobs/'+$job.jobId) -Headers $headers
        }while($state.state -in @('encoding','validating') -and (Get-Date) -lt $deadline)
        if($state.state -ne 'completed' -or $state.encoder -ne 'libvvenc' -or $state.outputBytes -le 0){throw ('VVC formal job failed: '+($state|ConvertTo-Json))}
        $stages=@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter ('quick-media-job-'+$job.jobId+'-*'))
        if($stages.Count -ne 1){throw 'Formal VVC output staging ownership missing.'}
        $output=Join-Path $stages[0].FullName 'output.mkv'
        $independent=Invoke-NativeTool $Ffprobe ('-v error -select_streams v:0 -count_frames -show_entries stream=codec_name,pix_fmt,nb_read_frames -of json '+(Quote-NativeArg $output))
        $v=@(($independent.StdOut | ConvertFrom-Json).streams)[0]
        if($v.codec_name -ne 'vvc' -or $v.pix_fmt -ne 'yuv420p10le' -or [int]$v.nb_read_frames -ne 24){throw 'Independent VVC identity/pixel format/frame count differs.'}
        [void](Invoke-NativeTool $Ffmpeg ('-nostdin -v error -xerror -i '+(Quote-NativeArg $output)+' -map 0:v:0 -f null -') -TimeoutSeconds 60)
        $artifactName=$task.operation+'-'+$task.rateMode+'.mkv'
        Copy-Item -LiteralPath $output -Destination (Join-Path $evidence $artifactName)
        $results+=@{operation=$task.operation;artifact=$artifactName;independentVideo=$v;rateMode=$task.rateMode;status='PASS';outputBytes=$state.outputBytes;outputDuration=$state.outputDuration;encoder=$state.encoder}
    }
    @{status='PASS';scope='Windows hosted synthetic source, actual Bridge /api/encode, QP and bitrate; optional ASS hardsub; independent FFprobe and decode';runtimeProbe=$probe;tasks=$results;externalPlayer='NOT_TESTED'} | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $repo 'vvc-native-acceptance.json') -Encoding UTF8
}finally{
    if($bridge -and -not $bridge.HasExited){Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue}
    foreach($name in @('bridge-out.log','bridge-err.log')){
        $path=Join-Path $work $name
        if(Test-Path -LiteralPath $path){Copy-Item -LiteralPath $path -Destination (Join-Path $evidence $name) -ErrorAction SilentlyContinue}
    }
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
