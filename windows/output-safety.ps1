function Publish-VerifiedOutput([string]$Temporary, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Temporary -PathType Leaf) -or
        (Get-Item -LiteralPath $Temporary).Length -le 0) {
        throw 'Temporary output is missing or empty; existing output is unchanged.'
    }
    if (Test-Path -LiteralPath $Destination) {
        $backupName = '.' + [IO.Path]::GetFileName($Destination) + '.backup-' + [guid]::NewGuid().ToString('N')
        $backup = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination))) $backupName
        [IO.File]::Replace($Temporary, $Destination, $backup)
        try { [IO.File]::Delete($backup) } catch {}
    } else {
        [IO.File]::Move($Temporary, $Destination)
    }
}

# WU15: the user's file chooser authorizes a destination, not the destruction
# of an already authorized INPUT or a private staged result. This is an
# independent safeguard before atomic publishing (which alone cannot prevent
# a successful-but-destructive overwrite of the source).

# WU16: Windows file identity by open handle, not by spelling. NTFS hardlinks
# share the same volume/file index despite different canonical pathname.
# The C# type is loaded only once so this module remains safe to dot-source.
if(-not ('QheWinFileIdentity' -as [type])){
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class QheWinFileIdentity {
    [StructLayout(LayoutKind.Sequential)]
    public struct NATIVE_FILETIME {
        public UInt32 Low;
        public UInt32 High;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct BY_HANDLE_FILE_INFORMATION {
        public UInt32 Attributes;
        public NATIVE_FILETIME Created;
        public NATIVE_FILETIME Accessed;
        public NATIVE_FILETIME Written;
        public UInt32 Volume;
        public UInt32 SizeHigh;
        public UInt32 SizeLow;
        public UInt32 LinkCount;
        public UInt32 IndexHigh;
        public UInt32 IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool GetFileInformationByHandle(
        SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool GetDiskFreeSpaceEx(
        string path, out UInt64 available, out UInt64 total, out UInt64 free);
}
'@ -ErrorAction Stop
}
function Get-NativeExistingFileIdentity([string]$Path) {
    # Failure is a refusal, not permission to overwrite an unverified target.
    $share=[IO.FileShare]([int][IO.FileShare]::ReadWrite -bor [int][IO.FileShare]::Delete)
    $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,$share)
    try {
        $info=New-Object 'QheWinFileIdentity+BY_HANDLE_FILE_INFORMATION'
        if(-not [QheWinFileIdentity]::GetFileInformationByHandle(
            $stream.SafeFileHandle,[ref]$info)){
            $winError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw ('Windows file identity could not be read (Win32 '+$winError+').')
        }
        return ('{0:X8}/{1:X8}/{2:X8}' -f
            [uint32]$info.Volume,[uint32]$info.IndexHigh,[uint32]$info.IndexLow)
    }finally{$stream.Dispose()}
}
function Assert-NativePublishParentDirectories([string]$AbsoluteDestination) {
    $parent=[IO.Path]::GetDirectoryName($AbsoluteDestination)
    while($parent){
        # Folder junctions/symlinks also redirect paths, even when the file
        # does not yet exist at the path the user sees in SaveFileDialog.
        $attrs=[IO.File]::GetAttributes($parent)
        if(($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0){
            throw 'Native output parent directory is a junction/reparse point.'
        }
        $next=[IO.Path]::GetDirectoryName($parent.TrimEnd([char]92,[char]47))
        if(-not $next -or [string]::Equals($next,$parent,
                [StringComparison]::OrdinalIgnoreCase)){break}
        $parent=$next
    }
}
function Assert-NativePublishDestinationSafe([string]$Destination,[string[]]$ProtectedPaths) {
    if([string]::IsNullOrWhiteSpace($Destination) -or
       -not [IO.Path]::IsPathRooted($Destination)){
        throw 'Native output destination must be an absolute file path.'
    }
    $full=[IO.Path]::GetFullPath($Destination)
    Assert-NativePublishParentDirectories $full
    # Explicit pathname match protects even deleted/replaced inputs; file
    # identity comparison below closes distinct-path NTFS hardlink aliases.
    $protectedExisting=New-Object 'System.Collections.Generic.List[string]'
    foreach($protected in @($ProtectedPaths)){
        if([string]::IsNullOrWhiteSpace($protected)){continue}
        $other=[IO.Path]::GetFullPath($protected)
        if([string]::Equals($full,$other,[StringComparison]::OrdinalIgnoreCase)){
            throw 'Refusing to overwrite an authorized source or verified staged output.'
        }
        if(Test-Path -LiteralPath $other -PathType Leaf){
            $protectedExisting.Add($other)
        }
    }
    # Reject existing link aliases that could redirect even a non-equal
    # destination to an input elsewhere. File.Replace must not follow them.
    if(Test-Path -LiteralPath $full){
        $existing=Get-Item -LiteralPath $full -Force -ErrorAction Stop
        if($existing.PSIsContainer){throw 'Output destination is a directory.'}
        if(([IO.FileAttributes]$existing.Attributes -band
            [IO.FileAttributes]::ReadOnly) -ne 0){
            throw 'Output destination is read-only; original file is unchanged. Remove read-only or choose another name, then retry Save.'
        }
        if(([IO.FileAttributes]$existing.Attributes -band
            [IO.FileAttributes]::ReparsePoint) -ne 0){
            throw 'Output destination is a symbolic link/reparse point; choose a regular file.'
        }
        $destinationKey=Get-NativeExistingFileIdentity $full
        foreach($protected in $protectedExisting){
            if([string]::Equals($destinationKey,(Get-NativeExistingFileIdentity $protected),
                    [StringComparison]::Ordinal)){
                throw 'Refusing to overwrite an authorized source via an NTFS hardlink/file identity alias.'
            }
        }
    }
    return $full
}


# WU17: an ordinary destination must still be the SAME file observed when
# the user authorized Save. Protected input read handles stay open across the
# last check and Replace/Move with Delete sharing denied.
# This is a bounded Windows defense; Windows filename replacement is not an
# atomic compare-and-swap and it does not stop all hostile rename races.

# WU18: check the volume containing the user-selected output folder, NOT the
# (possibly other-volume) Bridge staging folder. Free-space preflight is an
# early refusal only: it cannot reserve disk, eliminate later disk-full, or
# guarantee writes under external contention. Copy/publish errors stay fatal.
function Assert-NativeAvailableOutputSpace([long]$BytesToStage,[ulong]$AvailableBytes) {
    if($BytesToStage -le 0){throw 'Verified staged output size must be positive.'}
    # Same-volume output must temporarily coexist with any old destination.
    # Atomic replacement renames the old file; do not subtract old bytes.
    $minimumReserve=[ulong]8388608
    $need=[ulong]$BytesToStage+$minimumReserve
    if($AvailableBytes -lt $need){
        throw ('Insufficient output volume space: need at least '+$need+
            ' free bytes for verified delivery, available '+$AvailableBytes+
            '. Original output remains unchanged; choose another volume or free space, then retry Save without encoding.')
    }
}
function Assert-NativeOutputVolumeSpace([string]$Destination,[long]$VerifiedStageBytes) {
    if($VerifiedStageBytes -le 0){throw 'No verified encoded bytes available for export.'}
    $folder=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination))
    $available=[ulong]0
    $total=[ulong]0
    $free=[ulong]0
    if(-not [QheWinFileIdentity]::GetDiskFreeSpaceEx(
        $folder,[ref]$available,[ref]$total,[ref]$free)){
        $code=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw ('Unable to measure selected output volume free space (Win32 '+$code+
            '); cannot safely preflight verified delivery.')
    }
    Assert-NativeAvailableOutputSpace $VerifiedStageBytes $available
}

function Get-NativePublishDestinationSnapshot([string]$Destination) {
    if(Test-Path -LiteralPath $Destination){
        return 'existing:'+(Get-NativeExistingFileIdentity $Destination)
    }
    return 'absent'
}
function Publish-NativeProtectedOutput(
    [string]$Temporary,[string]$Destination,[string[]]$ProtectedPaths,
    [string]$ExpectedDestinationSnapshot) {
    $full=Assert-NativePublishDestinationSafe $Destination $ProtectedPaths
    if([string]::IsNullOrWhiteSpace($ExpectedDestinationSnapshot)){
        throw 'Native publish requires the destination snapshot from Save selection.'
    }
    if((Get-NativePublishDestinationSnapshot $full) -cne $ExpectedDestinationSnapshot){
        throw 'Native output destination changed since Save selection; new file remains untouched.'
    }
    $leases=New-Object 'System.Collections.Generic.List[System.IO.FileStream]'
    try{
        $share=[IO.FileShare]([int][IO.FileShare]::Read -bor [int][IO.FileShare]::Write)
        foreach($path in @($ProtectedPaths)){
            if(-not $path){continue}
            if(-not(Test-Path -LiteralPath $path -PathType Leaf)){continue}
            # An unavailable input lease is fail-closed. Denying Delete sharing
            # prevents the protected file from being renamed/replaced during
            # our publication even if another hardlink names it.
            $handle=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,$share)
            $leases.Add($handle)
        }
        [void](Assert-NativePublishDestinationSafe $full $ProtectedPaths)
        if((Get-NativePublishDestinationSnapshot $full) -cne $ExpectedDestinationSnapshot){
            throw 'Native output destination changed while acquiring protected input leases.'
        }
        Publish-VerifiedOutput $Temporary $full
    }finally{
        foreach($lease in $leases){$lease.Dispose()}
    }
}
