# Third-party license notes

This repository's MIT license applies only to original project code.

The planned WebAssembly runtime is based on FFmpegKitNext and FFmpeg with optional external libraries including libass, x264, x265 and SVT-AV1. Their licensing terms remain independent. The final distributable Web core must be reviewed against the exact build configuration before release.

Upstream projects:
- FFmpegKitNext: https://github.com/arthenica/ffmpeg-kit-next
- FFmpeg: https://ffmpeg.org/
- libass: https://github.com/libass/libass
- dav1d (AV1 software decoder): https://code.videolan.org/videolan/dav1d
- x264: https://www.videolan.org/developers/x264.html
- x265: https://bitbucket.org/multicoreware/x265_git/
- SVT-AV1: https://gitlab.com/AOMediaCodec/SVT-AV1

## coi-serviceworker

The app uses `coi-serviceworker` 0.1.7 (MIT) on static hosts such as GitHub Pages to obtain cross-origin isolation required by `SharedArrayBuffer` / WebAssembly pthreads.
Upstream: https://github.com/gzuidhof/coi-serviceworker


## Noto Sans SC fallback font

The web frontend bundles the unmodified Noto Sans SC Regular font as a libass/fontconfig fallback when an ASS-requested font is not supplied by the user.

- Upstream: https://github.com/notofonts/noto-cjk
- Font: Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
- License: SIL Open Font License 1.1


## Android GPL build

The Android native core is built with `--enable-gpl` and includes x264 and x265. FFmpegKit/FFmpeg documentation states that bundles built this way are subject to GPL-3.0 rather than the default LGPL-3.0.

Consequences for distributed APK artifacts:

- the repository's MIT license still applies to the project's original source files;
- the combined Android binary must also comply with the GPL-3.0 obligations of the bundled FFmpegKit/FFmpeg components;
- the exact source revision and build configuration are pinned in the repository so recipients can reproduce the native core;
- release packaging must include the applicable third-party license texts and source/build information.

This note is about the project's current build configuration and is not legal advice.
