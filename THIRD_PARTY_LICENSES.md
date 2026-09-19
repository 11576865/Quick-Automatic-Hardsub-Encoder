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
