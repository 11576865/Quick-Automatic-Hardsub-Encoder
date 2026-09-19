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
