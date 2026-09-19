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


### 14. Do not expose a raw FFmpeg command executor to JavaScript

The native bridge must accept a structured encode request, not an arbitrary shell/FFmpeg command string.

Native code should build an argument array with `FFmpegKit.executeWithArgumentsAsync(...)` so:
- filenames do not need shell quoting;
- ASS/font paths containing spaces or punctuation cannot break parsing;
- JavaScript cannot ask the native layer to read arbitrary app-accessible paths;
- only supported codecs, presets, rate controls and filters can be selected.

### 15. A native encode is a single owned job

Only one formal encode may own the native FFmpeg session at a time.

The service must reject or queue a second request and must clean up all of these on every terminal path:
- FFmpeg session;
- reusable SAF registrations;
- temporary ASS/font files;
- temporary output;
- wake lock;
- notification state.

On next app launch, stale temporary files from interrupted jobs should be detected and offered for cleanup/recovery.

### 16. Do not confuse WebView-selected File objects with a native persistent font pool

When an APK file picker returns font URIs, the Android shell should immediately classify them as font inputs and copy the small font files into app-private storage (or persist the URI grants if copying is not possible). This gives native libass a stable path and avoids depending on WebView IndexedDB.

The web IndexedDB library and native font pool can share UI semantics, but they are separate storage implementations.

### 17. Validate output before copying it to Downloads

A successful FFmpeg return code is necessary but not sufficient.

For formal output, native verification should compare:
- expected codec;
- width/height;
- duration tolerance;
- at least one video stream;
- copied audio stream count when audio exists;
- non-zero packet/file size.

Only after validation should the app copy the temporary MKV to the user destination and report success.


### 18. SAF input may be a stream, not a seekable local file

Android explicitly allows a document provider opened in read-only mode to return a pipe/socket rather than a seekable disk-backed descriptor. Cloud and virtual document providers may therefore behave differently from Downloads/internal storage.

Native input policy:

1. Probe the selected URI through FFprobe/FFmpegKit before the formal job.
2. If normal seek/read operations work, keep the zero-copy reusable SAF read URL.
3. If the provider is non-seekable or FFmpeg reports seek/random-access failure, offer/perform a one-time copy into app-private temporary storage, subject to free-space checks.
4. Do not assume every `content://` URI can support arbitrary FFmpeg seeking.

### 19. Treat Android app-private output as a staging file, not merely cache

A formal encode should not use an evictable browser/WASM buffer or rely on a direct SAF writer. Native output should be staged in a controlled app-private job directory long enough to survive Activity recreation and to permit post-encode validation.

Before starting:
- estimate a conservative temporary-space requirement;
- query available filesystem space;
- refuse early if the headroom is insufficient instead of failing after a long encode.

After verification and destination copy, clean the staging file. Interrupted-job staging files should be recoverable/cleanable on next launch.

### 20. GPL build configuration is part of the distributed Android artifact

The current Android core enables GPL components (x264/x265) and therefore the FFmpegKit/FFmpeg native bundle is GPL-3.0 under the project's pinned build configuration.

Release packaging must keep:
- exact upstream revision;
- exact build flags;
- applicable license texts;
- corresponding source/build instructions available alongside distributed APKs.

Do not silently switch between LGPL and GPL native bundles under the same binary/release label.


### 21. Android libass can fail silently when fontconfig is not initialized

FFmpegKit's Android guidance documents a particularly dangerous subtitle failure mode: Android does not ship a normal desktop-style fontconfig configuration, and subtitle burning can complete without an FFmpeg error while producing no visible subtitles if no font directory/configuration has been registered.

Native policy:
- initialize FFmpegKit fontconfig before any libass preview or formal encode;
- register \`/system/fonts\` plus the app-private persistent font pool;
- keep at least one bundled open fallback font available;
- do not treat a successful FFmpeg return code as proof that subtitles were rendered;
- the native startup self-test must compare a no-subtitle frame with a libass-rendered frame and require a pixel difference.

### 22. SAF operations need isolation and cleanup around FFprobe

Historical FFmpegKit Android reports show SAF operations affecting later FFprobe behavior in the same process. Even when the current fork has fixes, native code should avoid treating SAF protocol state as globally harmless.

Policy:
- create reusable SAF URLs only for the lifetime of the owning job;
- unregister them on every success/failure/cancel path;
- probe the actual selected input before formal encoding;
- after a failed SAF probe, discard that SAF registration and recreate it rather than reusing potentially stale protocol state.


### 23. Keep FFmpegKit session history bounded

Historical FFmpegKit reports note that retained sessions can retain their completion callbacks and objects captured by those callbacks. Repeated encode/probe operations can therefore keep Activity/UI state alive longer than intended.

Native policy:
- keep the session history deliberately small;
- clear startup/self-test sessions after their results are extracted;
- the long-running encode service, not an Activity, owns formal-session callbacks;
- do not capture Activity/WebView objects inside a formal encode callback.

### 24. Do not treat asynchronous dispatch or progress=100% as durable completion

\`executeAsync(...)\` intentionally returns when the job is scheduled, not when media processing is complete. Statistics reaching 100% are also not a file-integrity guarantee.

Native completion means all of the following:
1. the FFmpeg completion callback has fired;
2. the return code is successful;
3. the staging file exists and is non-zero;
4. FFprobe/packet validation passes;
5. the validated staging file has been copied and flushed to the user destination.

Do not call \`cancel()\` as a generic cleanup step after a successful session; cancellation belongs only to an explicit cancel/timeout path.

### 25. Formal native staging files must not live in Android cache storage

Android may delete files under \`cacheDir\` when storage pressure is high. A multi-hour transcode must therefore stage its output under an app-private persistent job directory such as \`filesDir/jobs/<job-id>\`, then delete it explicitly after verified delivery or user-confirmed cleanup.

Before starting an encode:
- estimate conservative output + working-space headroom;
- on API 26+, query \`StorageManager.getAllocatableBytes()\` for the volume hosting the staging directory;
- fail before encoding if the requirement cannot be met;
- never discover an out-of-space condition only after hours of encoding.


### 26. Use ACTION_CREATE_DOCUMENT for final delivery, and do not assume "w" truncates

Android's document picker deliberately does not overwrite an existing file when using \`ACTION_CREATE_DOCUMENT\`; a provider normally creates a new name such as \`file(1).mkv\`. This is useful protection for final delivery.

If an existing content URI ever has to be replaced, do not assume \`ContentResolver.openFileDescriptor(uri, "w")\` truncates it. Android explicitly documents that provider implementations differ and "w" may or may not truncate. Use a truncate mode such as \`"rwt"\`/\`"wt"\` only when the provider supports it.

For this project, prefer:
- user chooses a fresh destination through ACTION_CREATE_DOCUMENT;
- validated staging file is streamed once into that destination;
- partial delivery is reported explicitly if the copy fails.

### 27. Odd dimensions can fail 4:2:0 software encoders

A common x264 failure is \`width not divisible by 2\` when a 4:2:0 path receives odd dimensions.

Policy:
- detect odd width/height during preflight;
- render ASS at the original source geometry first;
- then pad only the right/bottom edge by at most one pixel to the next even dimension;
- never silently scale the picture just to satisfy the encoder.

The web backend now uses this order for benchmark and formal encoding.

### 28. Treat thermal throttling as normal mobile behavior, not an encoder bug

Android documents that long CPU-heavy workloads can change performance dramatically as the SoC reaches thermal limits. The Thermal API can report overall throttling state on API 29+.

Native policy:
- keep ETA based on rolling observed throughput;
- surface thermal status when available;
- do not promise the initial FPS will be sustained;
- do not automatically increase codec parallelism just because many logical CPU cores are visible.

For x265 specifically, upstream documentation warns that over-allocating frame threads increases memory use and can reduce performance. Mobile defaults should therefore be bounded and measured rather than "use every core".

### 29. mediaProcessing foreground service has a finite background budget on Android 15+

For apps targeting Android 15+, \`mediaProcessing\` foreground services have a shared six-hour background allowance per 24 hours. When exhausted, Android calls \`Service.onTimeout(int,int)\`; failing to stop promptly can crash the app.

Policy:
- start formal encoding only from explicit foreground user action;
- stop the service on success/failure/cancel;
- implement \`onTimeout()\`;
- warn before starting a job whose estimated background runtime could approach the six-hour limit;
- persist staging/job state so a timeout or process death leaves a recoverable/cleanable artifact rather than a mysterious partial success.

### 30. FFmpegKit log redirection can retain logs for the entire active session

With Android redirection enabled, FFmpegKit adds redirected log entries to the active session before deciding whether to print them. Long noisy sessions can therefore retain more log data than expected.

Formal native encode policy:
- keep redirection enabled because statistics callbacks are required for progress;
- lower FFmpeg's active log level for the long-running encode to warnings/errors while retaining statistics;
- keep full verbose logs for short self-tests and explicit diagnostics only;
- clear completed sessions after the needed failure summary has been extracted.
