# WU16 actual Windows filesystem identity boundaries without a browser mock.
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){
    throw 'WU16 native identity fixture requires GitHub Actions RUNNER_TEMP.'
}
. (Join-Path $PSScriptRoot '../windows/output-safety.ps1')
$work=Join-Path $env:RUNNER_TEMP ('wu16-native-path-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force|Out-Null
try{
    $source=Join-Path $work 'source.mkv'
    $ordinary=Join-Path $work 'ordinary-output.mkv'
    $alias=Join-Path $work 'other-name.mkv'
    [IO.File]::WriteAllBytes($source,[byte[]](1..64))
    $originalSha=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    # A normal non-aliased publish target must remain allowed.
    $allowed=Assert-NativePublishDestinationSafe $ordinary @($source)
    if($allowed -ne [IO.Path]::GetFullPath($ordinary)){
        throw 'Safe output path changed during validation.'
    }
    # Real NTFS hard link (no fake file id) must be refused as the same file.
    New-Item -ItemType HardLink -Path $alias -Target $source|Out-Null
    $key1=Get-NativeExistingFileIdentity $source
    $key2=Get-NativeExistingFileIdentity $alias
    if(-not $key1 -or $key1 -ne $key2){
        throw 'WU16 NTFS hardlink fixture did not share one Windows file identity.'
    }
    $denied=$false
    try{[void](Assert-NativePublishDestinationSafe $alias @($source))}
    catch{if($_.Exception.Message -match 'hardlink/file identity alias'){$denied=$true}else{throw}}
    if(-not $denied){throw 'WU16 hardlink alias was accepted as safe output.'}

    # Junction parent path is a separate redirection vector, even for new
    # names that have no existing file key. Windows runner can make a junction
    # in RUNNER_TEMP without elevated symlink privileges.
    $junction=Join-Path $work 'junction-parent'
    New-Item -ItemType Junction -Path $junction -Target $work|Out-Null
    $denied=$false
    try{[void](Assert-NativePublishDestinationSafe (Join-Path $junction 'new-file.mkv') @($source))}
    catch{if($_.Exception.Message -match 'junction/reparse point'){$denied=$true}else{throw}}
    if(-not $denied){throw 'WU16 parent junction was accepted as safe output.'}
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $originalSha){
        throw 'Protected input bytes changed during path identity checks.'
    }
    Write-Host 'WU16 WINDOWS FILE IDENTITY PASS: NTFS hardlink same handle identity, new-file parent junction denied, normal output allowed, original bytes intact.'
}finally{
    # Remove only the junction entry before recursive cleanup; never recurse
    # into a linked directory that may point back to the work tree.
    if($junction -and (Test-Path -LiteralPath $junction)){
        [IO.Directory]::Delete($junction)
    }
    if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Force -Recurse -ErrorAction Stop}
}
