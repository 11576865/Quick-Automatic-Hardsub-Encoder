# Android native backend

This directory is reserved for the native Android backend of Quick-Automatic-Hardsub-Encoder.

## Goal

Keep the browser-style workflow and automatic decisions, but move full video processing out of WebAssembly when the Android app is available.

Preferred backend order:

1. Android native FFmpegKitNext / MediaCodec
2. Browser WebCodecs where a codec is exposed and the pipeline supports it
3. FFmpeg WebAssembly fallback
4. Command-generation mode for Termux / desktop FFmpeg

## Native core

The repository workflow `Build Android Native Core` builds an ARM64 FFmpegKitNext AAR with:

- Android MediaCodec
- dav1d
- libass
- fontconfig / FreeType / FriBidi / HarfBuzz
- x264
- x265
- SVT-AV1

The Android app will use Storage Access Framework (SAF) URIs rather than requiring users to type filesystem paths.

## Planned app shell

The app will reuse the existing interaction model:

- choose video
- choose ASS
- choose one or more fonts
- media / subtitle preflight
- real subtitle preview
- codec capability and speed comparison
- automatic plan selection
- native encode
- save with Android's document/download picker

The WebAssembly backend remains available as an installation-free fallback.


## MediaCodec policy

MediaCodec support is compiled into the native core for capability probing and future acceleration, but hardware encoding is **not enabled by default**.

Reason: FFmpegKitNext and upstream FFmpeg have documented device/vendor-specific MediaCodec encoder failures, including streams that FFmpeg can read but common players render as black video or otherwise fail. The default native path will therefore start with the ARM64 software encoders (x264, x265, SVT-AV1) and use MediaCodec only after codec-specific validation on the actual device.

Native rollout order:

1. ARM64 software FFmpeg + libass smoke tests
2. SAF read/write tests
3. subtitle/font regression test against the known sample
4. H.264 / H.265 / AV1 software encode tests
5. MediaCodec decode tests
6. MediaCodec encode as an explicit experimental option only after output compatibility checks
