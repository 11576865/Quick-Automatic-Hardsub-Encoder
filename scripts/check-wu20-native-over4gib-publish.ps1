# WU20 independent >4 GiB real Windows delivery oracle.
# The SOURCE is an NTFS sparse binary with physically written boundary markers;
# the OUTPUT is a regular new FileStream file and receives ALL >4 GiB bytes.
# This proves >32-bit-length streaming transport, not 4 GiB of encoded video.
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){
    throw 'WU20 resource-intensive >4GiB oracle is restricted to hosted Windows CI.'
}
. (Join-Path $PSScriptRoot '../windows/output-safety.ps1')
$work=Join-Path $env:RUNNER_TEMP ('wu20-over4gib-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force|Out-Null
try{
    $length=[long]4295032832 # 4 GiB + 64 KiB, strictly over UInt32.MaxValue
    $threshold=[long]2147484672 # >2GiB, tests signed 32-bit failure arithmetic
    $source=Join-Path $work 'over4gib-staged.bin'
    $dest=Join-Path $work 'user-existing-output.bin'
    $temp=Join-Path $work '.output.quick-hardsub-wu20.tmp'
    $available=[UInt64]0;$total=[UInt64]0;$free=[UInt64]0
    if(-not [QheWinFileIdentity]::GetDiskFreeSpaceEx($work,
            [ref]$available,[ref]$total,[ref]$free)){
        throw 'WU20 cannot measure real Windows destination volume capacity.'
    }
    $required=[UInt64]$length+[UInt64]1073741824
    if($available -lt $required){
        throw ('WU20 INSUFFICIENT REAL DISK: '+$available+' free bytes, at least '+
            $required+' required for >4GiB output and 1GiB runner headroom. No fake pass.')
    }
    # Stage is sparse ONLY to avoid consuming another 4 GiB merely to create
    # fixture. Full-copy output below is never marked sparse, and the 1 MiB
    # production buffer actually traverses the complete logical byte stream.
    $init=[IO.File]::Open($source,[IO.FileMode]::CreateNew,
        [IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $init.Dispose()
    & fsutil.exe sparse setflag $source | Out-Null
    if($LASTEXITCODE -ne 0){throw 'WU20 cannot mark the input fixture NTFS sparse.'}
    $markers=@(
        [pscustomobject]@{At=[long]0;Value='WU20-START-PROOF'},
        [pscustomobject]@{At=[long]2147483600;Value='WU20-BEFORE-2GIB'},
        [pscustomobject]@{At=[long]2147483664;Value='WU20-AFTER-2GIB'},
        [pscustomobject]@{At=[long]4294967248;Value='WU20-BEFORE-4GIB'},
        [pscustomobject]@{At=[long]4294967312;Value='WU20-AFTER-4GIB'},
        [pscustomobject]@{At=[long]4295032700;Value='WU20-FINAL-BOUNDARY'}
    )
    $stream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None)
    try{
        $stream.SetLength($length)
        foreach($m in $markers){
            $stream.Position=$m.At
            $bytes=[Text.Encoding]::ASCII.GetBytes($m.Value)
            $stream.Write($bytes,0,$bytes.Length)
        }
        $stream.Flush($true)
    }finally{$stream.Dispose()}
    if([long](Get-Item -LiteralPath $source).Length -ne $length){
        throw 'WU20 did not create a source beyond UInt32.MaxValue.'
    }
    [IO.File]::WriteAllText($dest,'WU20 ORIGINAL DESTINATION MUST NOT CHANGE BEFORE VERIFIED PUBLISH',
        [Text.Encoding]::UTF8)
    $oldSha=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    $snapshot=Get-NativePublishDestinationSnapshot $dest
    $sourceSha=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    Assert-NativeOutputVolumeSpace $dest $length

    # First copy writes actual >2GiB into a real output-volume temporary file,
    # then fails. The actual temporary file is large, not a mocked counter.
    $refused=$false
    try{
        [void](Copy-NativeStageToOutputTemporary $source $temp $length $threshold)
    }catch{
        if($_.Exception.Message -match 'partial destination write failed after actual bytes'){
            $refused=$true
        }else{throw}
    }
    if(-not $refused){throw 'WU20 32-bit-boundary partial copy did not fail.'}
    $partial=[long](Get-Item -LiteralPath $temp).Length
    if($partial -lt $threshold -or $partial -ge $length){
        throw ('WU20 incomplete target count is invalid: '+$partial)
    }
    if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $oldSha){
        throw 'WU20 user destination was changed during failed >2GiB temporary copy.'
    }
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $sourceSha){
        throw 'WU20 original verified stage mutated during long partial copy.'
    }
    Remove-Item -LiteralPath $temp -Force
    if(Test-Path -LiteralPath $temp){throw 'WU20 partial temporary file leaked after cleanup.'}
    $currentFree=[UInt64]0;$dummyTotal=[UInt64]0;$dummyFree=[UInt64]0
    if(-not [QheWinFileIdentity]::GetDiskFreeSpaceEx($work,[ref]$currentFree,
            [ref]$dummyTotal,[ref]$dummyFree)){
        throw 'WU20 could not verify post-failure output-volume capacity.'
    }
    Assert-NativeAvailableOutputSpace $length $currentFree

    # Same already-generated stage is transferred in full, compared to an
    # independent whole-file SHA256, then committed by the shipping Native
    # destination identity/lease/atomic replacement authority.
    $copied=Copy-NativeStageToOutputTemporary $source $temp $length
    if([long]$copied -ne $length -or
       [long](Get-Item -LiteralPath $temp).Length -ne $length){
        throw 'WU20 full >4GiB copy did not preserve byte length.'
    }
    $copiedSha=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash
    if($copiedSha -ne $sourceSha){
        throw 'WU20 >4GiB whole-file SHA-256 mismatch before publish.'
    }
    # Verify markers on BOTH source and copied temp, particularly around
    # the two integer boundaries; independent from the full SHA check.
    foreach($item in @($source,$temp)){
        $r=[IO.File]::Open($item,[IO.FileMode]::Open,[IO.FileAccess]::Read,
            [IO.FileShare]::Read)
        try{
            foreach($m in $markers){
                $r.Position=$m.At
                $expected=[Text.Encoding]::ASCII.GetBytes($m.Value)
                $actual=New-Object byte[] $expected.Length
                if($r.Read($actual,0,$actual.Length) -ne $expected.Length -or
                   -not [string]::Equals(
                       [Text.Encoding]::ASCII.GetString($actual),
                       $m.Value,[StringComparison]::Ordinal)){
                    throw ('WU20 boundary marker mismatch for '+$item+' at '+$m.At)
                }
            }
        }finally{$r.Dispose()}
    }
    if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $oldSha){
        throw 'WU20 old destination changed BEFORE verified atomic publish.'
    }
    Publish-NativeProtectedOutput $temp $dest @($source) $snapshot
    $destLength=[long](Get-Item -LiteralPath $dest).Length
    $destSha=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    if($destLength -ne $length -or $destSha -ne $sourceSha){
        throw 'WU20 published >4GiB output length/SHA is not the original stage.'
    }
    $peak=[long][Diagnostics.Process]::GetCurrentProcess().PeakWorkingSet64
    # 1MiB buffer must not require multi-GiB RAM. Allow PowerShell overhead.
    if($peak -gt [long]805306368){
        throw ('WU20 >4GiB transfer used unexpectedly high process memory: '+$peak)
    }
    Write-Host ('WU20 REAL OVER-4GIB WINDOWS NATIVE PUBLISH PASS: sourceBytes='+$length+
        '; realPartialBytes='+$partial+
        '; fullCopyBytes='+$copied+
        '; finalSha256='+$destSha+
        '; processPeakBytes='+$peak+
        '; sourceFixture=NTFS_SPARSE_BOUNDARY_MARKERS'+
        '; output=FULL_REAL_NONSPARSE_FILESTREAM_WRITES'+
        '; encodedMovie=false')
}finally{
    if(Test-Path -LiteralPath $work){
        Remove-Item -LiteralPath $work -Force -Recurse -ErrorAction Stop
    }
}
