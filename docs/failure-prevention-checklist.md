# Failure-prevention checklist

This document records failure modes already seen in upstream projects or in this project. New native features should not be enabled by default until the corresponding checks pass.

## Android native backend

### 1. Do not write final media directly through SAF by default

Older FFmpegKit reports include incomplete/corrupt output when FFmpeg writes directly to a SAF URL. Preferred path:

1. Read the input through a reusable SAF read URL.
2. Encode the final MKV to app-private temporary storage.
3. FFprobe the temporary output.
4. Verify at least: video stream exists, duration is sane, file size is non-zero.
5. Copy the verified file to the user-selected SAF destination with Android ContentResolver I/O.
6. Only after the copy succeeds, delete the temporary file.

Before encode, check that app-private storage has enough free space for the planned output plus headroom.

### 2. Never assume MediaCodec works because the encoder name exists

Hardware encoder availability is device/vendor dependent. Known failures include unsupported color formats, encoder initialization failures, and output compatibility problems.

Default:
- x264
- x265
- SVT-AV1

MediaCodec remains opt-in until a device-specific smoke test produces a decodable output and FFprobe validates it.

### 3. Long encodes must not live in the Activity/WebView lifecycle

Formal native encoding belongs in an Android foreground service of type `mediaProcessing`.

The service must:
- start only from explicit user action;
- own the FFmpeg session;
- publish progress through a notification and observable job state;
- stop itself on success/failure/cancel;
- handle Android 15 `onTimeout()`;
- never rely on the WebView remaining alive.

A partial wake lock may be used only while CPU encoding is actually running and must be released in every completion/failure/cancel path.

### 4. SAF URI lifecycle

Input documents selected by the user should request persistable read grants where the provider supports them.

FFmpegKit reusable SAF URLs must be explicitly unregistered after the operation.

Do not place SAF URLs inside concat/HLS child manifests until that path has been separately validated.

### 5. 16 KiB Android page sizes

The app contains native libraries, so every packaged `.so` must be compatible with 16 KiB pages.

CI must check:
- APK 16 KiB ZIP alignment;
- ELF LOAD segment alignment for all arm64-v8a libraries.

The pinned FFmpegKitNext build already adds 16 KiB max-page-size flags for arm64, but CI validation remains mandatory.

### 6. Stable debug signing

GitHub-hosted runners are ephemeral. A newly generated debug keystore can change between builds, making Android reject an update over an already installed test APK.

The fast APK workflow therefore preserves the debug keystore through the Actions cache. Production/release signing must use a separate private release key and must never use the debug certificate.

### 7. WebView/native bridge trust boundary

Only bundled application content may access the native bridge.

Rules:
- load the UI through `WebViewAssetLoader` on `appassets.androidplatform.net`;
- block navigation outside the app asset origin;
- keep file access disabled;
- expose only minimal native methods;
- do not load remote pages into the bridge-enabled WebView.

Before release, prefer an origin-scoped WebMessage bridge over expanding `addJavascriptInterface`.

### 8. Native file selection and WebView File objects are not the same thing

The WebView can read a user-selected `File`, but the native encoder needs the original Android `content://` URI.

The Android shell must retain selected URIs (video / ASS / font roles) instead of trying to reconstruct a filesystem path from JavaScript.

### 9. Native font persistence is separate from browser IndexedDB

The browser's persistent font library is useful for WASM/libass, but native FFmpeg cannot directly read IndexedDB.

For APK mode, remembered fonts must also exist in an Android-native font pool (app-private copies or persistable URI grants). Native libass/fontconfig should receive:
- app font pool;
- user-selected fonts for this job;
- Android system fonts as final fallback.

### 10. Do not trust “successful encode” alone

Before exposing a native output as completed:
- return code must be success;
- output must exist and be non-zero;
- FFprobe must detect the expected video stream;
- duration must be within tolerance of the input;
- for a subtitle smoke test, rendered output must differ from the no-subtitle control frame.

## Browser backend

### 11. Short samples are not whole-file predictions

A short keyframe-heavy sample must not be linearly extrapolated into a precise output size or encode time.

Short samples are only for:
- visual inspection;
- subtitle/font verification;
- approximate current-device throughput.

### 12. Saved browser fonts are best-effort unless storage is persistent

IndexedDB data can be evicted under storage pressure. After the user explicitly chooses to remember fonts, request persistent origin storage and report whether persistence was granted.

### 13. Formal browser output is still memory-sensitive

WASM/browser encoding remains a fallback. Large output should eventually move from accumulated JS Blob chunks to OPFS/File System streaming where supported.
