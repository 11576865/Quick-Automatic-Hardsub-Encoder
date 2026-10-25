# WU17: real Windows-file identity and target-replacement fault oracle.
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){
    throw 'WU17 publication oracle requires hosted Windows RUNNER_TEMP.'
}
. (Join-Path $PSScriptRoot '../windows/output-safety.ps1')
$work=Join-Path $env:RUNNER_TEMP ('wu17-publish-lease-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work|Out-Null
try{
    $source=Join-Path $work 'original-input.mkv'
    $dest=Join-Path $work 'selected-output.mkv'
    $staged=Join-Path $work 'verified-output.tmp'
    [IO.File]::WriteAllText($source,'UNTOUCHED_SOURCE_123456789',[Text.Encoding]::UTF8)
    [IO.File]::WriteAllText($staged,'NEW_VERIFIED_OUTPUT_ABCDEFG',[Text.Encoding]::UTF8)
    [IO.File]::WriteAllText($dest,'ORIGINAL_USER_TARGET_1234',[Text.Encoding]::UTF8)
    $sourceSha=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $stagedSha=(Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash
    $snapshot=Get-NativePublishDestinationSnapshot $dest
    if(-not $snapshot.StartsWith('existing:')){throw 'Expected initial user target file identity'}

    # A separate actor swaps the user destination during the long staged copy.
    [IO.File]::Delete($dest)
    [IO.File]::WriteAllText($dest,'NEW_EXTERNAL_FILE_MUST_SURVIVE',[Text.Encoding]::UTF8)
    $externalSha=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    $denied=$false
    try{Publish-NativeProtectedOutput $staged $dest @($source) $snapshot}
    catch{if($_.Exception.Message -match 'destination changed since Save selection'){$denied=$true}else{throw}}
    if(-not $denied){throw 'Changed destination identity was accepted.'}
    if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $externalSha){
        throw 'Unexpectedly published over external replacement.'
    }
    if(-not(Test-Path -LiteralPath $staged -PathType Leaf)){
        throw 'Denied export consumed the verified staged output.'
    }
    # Locked target must fail closed and leave the source, destination and
    # verified staged copy untouched; after unlock the SAME staged output
    # succeeds without repeating an encode.
    $snapshot=Get-NativePublishDestinationSnapshot $dest
    $share=[IO.FileShare]::None
    $held=[IO.File]::Open($dest,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,$share)
    try{
        $denied=$false
        try{Publish-NativeProtectedOutput $staged $dest @($source) $snapshot}
        catch{$denied=$true}
        if(-not $denied){throw 'Exclusive target lock did not block publishing.'}
    }finally{$held.Dispose()}
    if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $externalSha){
        throw 'Locked destination was changed by failed publish.'
    }
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $sourceSha){
        throw 'Original source changed after denied publish.'
    }
    Publish-NativeProtectedOutput $staged $dest @($source) $snapshot
    if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $stagedSha){
        throw 'Same staged output was not published after unlocking destination.'
    }
    # An originally absent target is not permission to replace a new file
    # created by another process during verification.
    $new=Join-Path $work 'previously-absent.mkv'
    $absentSnapshot=Get-NativePublishDestinationSnapshot $new
    if($absentSnapshot -ne 'absent'){throw 'Absent snapshot invalid.'}
    $staged2=Join-Path $work 'second-verified.tmp'
    [IO.File]::WriteAllText($staged2,'SECOND_VERIFIED_OUTPUT',[Text.Encoding]::UTF8)
    [IO.File]::WriteAllText($new,'EXTERNAL_NEW_FILE',[Text.Encoding]::UTF8)
    $createdSha=(Get-FileHash -LiteralPath $new -Algorithm SHA256).Hash
    $denied=$false
    try{Publish-NativeProtectedOutput $staged2 $new @($source) $absentSnapshot}
    catch{if($_.Exception.Message -match 'destination changed since Save selection'){$denied=$true}else{throw}}
    if(-not $denied -or
       (Get-FileHash -LiteralPath $new -Algorithm SHA256).Hash -ne $createdSha){
        throw 'Absent-to-created destination was overwritten.'
    }
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $sourceSha){
        throw 'Original source identity/bytes changed.'
    }
    Write-Host 'WU17 WINDOWS PUBLICATION LEASE PASS: replaced existing target denied; locked destination denied; unchanged staged output then published; absent-to-created race denied; source unchanged.'
}finally{
    if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Force -Recurse -ErrorAction Stop}
}
