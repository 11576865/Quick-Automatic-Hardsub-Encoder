# Isolated hosted-runner toolchain only. Never installs into the product or a user machine.
$ErrorActionPreference='Stop'
if(-not $env:RUNNER_TEMP -or -not $env:GITHUB_PATH){throw 'This installer is restricted to GitHub hosted CI.'}
$headers=@{Accept='application/vnd.github+json';'User-Agent'='QHE-VVC-acceptance'}
if($env:GH_TOKEN){$headers.Authorization='Bearer '+$env:GH_TOKEN}
$release=Invoke-RestMethod -Uri 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest' -Headers $headers
$assets=@($release.assets | Where-Object {$_.name -eq 'ffmpeg-master-latest-win64-gpl.zip'})
if($assets.Count -ne 1){throw 'Expected upstream Windows x64 GPL toolchain asset is absent or ambiguous.'}
$asset=$assets[0]
if([string]$asset.digest -notmatch '^sha256:([0-9a-fA-F]{64})$'){throw 'Upstream asset does not provide a SHA-256 digest; refusing unverified toolchain.'}
$expected=$Matches[1].ToLowerInvariant()
if($env:QHE_VVC_EXPECTED_SHA256 -and $env:QHE_VVC_EXPECTED_SHA256 -ne $expected){throw 'VVC asset digest changed after the cache key was resolved; refusing mismatched archive.'}
if([string]$asset.browser_download_url -notlike 'https://github.com/BtbN/FFmpeg-Builds/releases/download/*'){throw 'Unexpected upstream download host/path.'}
$cache=Join-Path $env:RUNNER_TEMP 'qhe-vvc-cache'
[void](New-Item -ItemType Directory -Path $cache -Force)
$zip=Join-Path $cache 'ffmpeg.zip'
if(Test-Path -LiteralPath $zip -PathType Leaf){
    $cachedDigest=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if($cachedDigest -ne $expected){throw 'Cached VVC archive digest does not match current upstream metadata; refusing unsafe reuse.'}
    Write-Host ('Verified cached VVC archive '+$cachedDigest)
}else{
    $download=Join-Path $cache 'ffmpeg.download'
    # Public asset request deliberately does not carry API credentials across redirects.
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $download -UseBasicParsing
    $downloadDigest=(Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if($downloadDigest -ne $expected){
        Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
        throw 'Downloaded VVC archive SHA-256 differs from upstream release metadata.'
    }
    Move-Item -LiteralPath $download -Destination $zip -Force
}
$actual=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if($actual -ne $expected){throw 'VVC toolchain archive verification failed.'}
$root=Join-Path $env:RUNNER_TEMP ('qhe-vvc-toolchain-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $root)
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $root 'expanded')
$executables=@(Get-ChildItem -LiteralPath (Join-Path $root 'expanded') -Filter ffmpeg.exe -Recurse -File)
if($executables.Count -ne 1){throw 'Toolchain contains an ambiguous FFmpeg executable.'}
$bin=$executables[0].Directory.FullName
$probe=Join-Path $bin 'ffprobe.exe'
if(-not(Test-Path -LiteralPath $probe -PathType Leaf)){throw 'Matching FFprobe executable is missing.'}
$env:PATH=$bin+';'+$env:PATH
$bin | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
$version=(& $executables[0].FullName -version) -join "`n"
if($LASTEXITCODE -ne 0){throw 'Verified toolchain cannot execute.'}
$encoders=(& $executables[0].FullName -hide_banner -encoders 2>&1) -join "`n"
if($LASTEXITCODE -ne 0 -or $encoders -notmatch '\blibvvenc\b'){throw 'Required libvvenc is absent from the verified CI toolchain.'}
$evidence=Join-Path (Split-Path $PSScriptRoot -Parent) 'vvc-runtime-evidence'
[void](New-Item -ItemType Directory -Path $evidence -Force)
@{repository='BtbN/FFmpeg-Builds';releaseId=$release.id;releaseTag=$release.tag_name;releasePublishedAt=$release.published_at;assetId=$asset.id;assetName=$asset.name;archiveSha256=$actual;ffmpegPath=$executables[0].FullName;ffprobePath=$probe;ffmpegVersion=$version;scope='isolated hosted CI, not product distribution'} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'toolchain-provenance.json') -Encoding UTF8
Write-Host ('Verified upstream asset '+$asset.id+' SHA256 '+$actual+'; libvvenc listed. Actual chain still requires runtime acceptance.')
