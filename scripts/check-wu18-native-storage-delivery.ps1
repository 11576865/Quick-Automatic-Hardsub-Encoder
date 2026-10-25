# WU18: actual Windows output-volume capacity check, read-only/ACL refusal,
# original-file preservation and stage-only retry. Hosted runner fixture only.
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){
    throw 'WU18 Windows delivery oracle requires hosted RUNNER_TEMP.'
}
. (Join-Path $PSScriptRoot '../windows/output-safety.ps1')
$work=Join-Path $env:RUNNER_TEMP ('wu18-delivery-'+[guid]::NewGuid().ToString('N'))
New-Item -Path $work -ItemType Directory -Force|Out-Null
$denyRule=$null
$aclTarget=$null
try {
    $source=Join-Path $work 'original-source.mkv'
    $target=Join-Path $work 'user-destination.mkv'
    $stage=Join-Path $work 'verified-output.tmp'
    [IO.File]::WriteAllText($source,'ORIGINAL_SOURCE_MUST_STAY',[Text.Encoding]::UTF8)
    [IO.File]::WriteAllText($target,'OLD_USER_DESTINATION_BYTES',[Text.Encoding]::UTF8)
    [IO.File]::WriteAllText($stage,'VERIFIED_NEW_DELIVERY_BYTES',[Text.Encoding]::UTF8)
    $sourceSha=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $oldSha=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    $stageSha=(Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash
    $selected=Get-NativePublishDestinationSnapshot $target

    # The real target volume must be queried using Win32 path-aware free-space
    # evidence; test separately a deterministic no-space report without
    # filling the actual runner's shared system volume.
    $avail=[ulong]0;$total=[ulong]0;$free=[ulong]0
    if(-not [QheWinFileIdentity]::GetDiskFreeSpaceEx($work,
            [ref]$avail,[ref]$total,[ref]$free)){
        throw 'WU18 GetDiskFreeSpaceEx returned an error for the real target volume.'
    }
    if($avail -le [ulong]0 -or $total -lt $avail){
        throw 'WU18 real free-space data is invalid.'
    }
    Assert-NativeOutputVolumeSpace $target ([long](Get-Item -LiteralPath $stage).Length)
    $refused=$false
    try{Assert-NativeAvailableOutputSpace ([long]1048576) ([ulong]0)}
    catch{if($_.Exception.Message -match 'Insufficient output volume space'){$refused=$true}else{throw}}
    if(-not $refused){throw 'WU18 deterministic low-space preflight did not refuse.'}
    # This is a byte-count test, not a request to allocate 6 GB on the runner.
    $large=[long]6000000000
    Assert-NativeAvailableOutputSpace $large ([ulong]6010000000)
    $refused=$false
    try{Assert-NativeAvailableOutputSpace $large ([ulong]6000000000)}
    catch{if($_.Exception.Message -match 'Insufficient output volume space'){$refused=$true}else{throw}}
    if(-not $refused){throw 'WU18 64-bit capacity calculation truncated.'}

    # Windows read-only attribute is a deterministic production refusal
    # without touching the old user's bytes.
    [IO.File]::SetAttributes($target,[IO.FileAttributes]::ReadOnly)
    $refused=$false
    try{Publish-NativeProtectedOutput $stage $target @($source) $selected}
    catch{if($_.Exception.Message -match 'destination is read-only'){$refused=$true}else{throw}}
    if(-not $refused){throw 'WU18 read-only destination was overwritten.'}
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $oldSha -or
       (Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -ne $stageSha){
        throw 'WU18 read-only refusal changed original destination or staged bytes.'
    }
    [IO.File]::SetAttributes($target,[IO.FileAttributes]::Normal)

    # Genuine Windows NTFS ACL denial on DELETE for the target (File.Replace
    # needs DELETE permission). Revoked in finally even if assertion fails.
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $denyRule=[Security.AccessControl.FileSystemAccessRule]::new(
        $sid,[Security.AccessControl.FileSystemRights]::Delete,
        [Security.AccessControl.AccessControlType]::Deny)
    $aclTarget=$target
    $acl=Get-Acl -LiteralPath $target
    $acl.AddAccessRule($denyRule)
    Set-Acl -LiteralPath $target -AclObject $acl
    $refused=$false
    try{Publish-NativeProtectedOutput $stage $target @($source) $selected}
    catch{if($_.Exception -is [UnauthorizedAccessException] -or
             $_.Exception.Message -match 'access|denied|permission'){$refused=$true}else{throw}}
    if(-not $refused){throw 'WU18 real NTFS ACL Delete denial did not prevent overwrite.'}
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $oldSha -or
       (Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -ne $stageSha){
        throw 'WU18 ACL refusal changed previous output or verified stage.'
    }
    $revert=Get-Acl -LiteralPath $target
    [void]$revert.RemoveAccessRuleSpecific($denyRule)
    Set-Acl -LiteralPath $target -AclObject $revert
    $denyRule=$null

    # The exact same original snapshot/stage must publish once the permission
    # returns, preserving the original source file.
    Publish-NativeProtectedOutput $stage $target @($source) $selected
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $stageSha -or
       (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $sourceSha){
        throw 'WU18 same-stage retry failed or source bytes changed.'
    }
    Write-Host 'WU18 REAL WINDOWS STORAGE DELIVERY PASS: volume-aware space preflight, 64-bit low-space refusal, read-only rejection, genuine NTFS ACL denied, same verified stage retried and source preserved.'
}finally{
    if($denyRule -and $aclTarget -and (Test-Path -LiteralPath $aclTarget)){
        try{
            $acl=Get-Acl -LiteralPath $aclTarget
            [void]$acl.RemoveAccessRuleSpecific($denyRule)
            Set-Acl -LiteralPath $aclTarget -AclObject $acl
        }catch{Write-Warning ('WU18 NTFS ACL cleanup failed: '+$_.Exception.Message)}
    }
    if($target -and (Test-Path -LiteralPath $target)){
        try{[IO.File]::SetAttributes($target,[IO.FileAttributes]::Normal)}catch{}
    }
    if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force}
}
