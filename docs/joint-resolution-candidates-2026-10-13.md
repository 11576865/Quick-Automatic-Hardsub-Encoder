# Joint codec, preset and resolution comparison

Intent: close the source-resolution-only decision gap inside the shared task workbench. The experiment compares x264/x265 × medium/fast × original/1080p/720p when those dimensions are smaller than the source. No upscaling candidate is generated. Maximum 12 branches and 72 CQ window calls; the existing reported encode-time quota remains unchanged. An incomplete sweep never publishes a recommendation.

The Windows exact-source sample path now supports `source-sdr-bicubic-upscale-ssim-v1`. It applies bicubic candidate scaling and re-upscales the encoded sample to the original reference canvas for source-backed SSIM. The bridge probes source/output geometry before emitting a receipt. All candidate branches share source/runtime/reference/filter/window identity; CQ and VBR admission bind the output and reference dimensions. Legacy unscaled evidence remains under its existing metric and cannot mix with the common-reference metric.

Explicit adoption writes codec, preset, bitrate, width, height and bicubic scaling in one transaction; compiler rejection restores prior fields. A new formal task check remains mandatory. The comparison chart is a video-only budget estimate, not a complete container budget or whole-file quality guarantee.

Local verification: 234 tests pass, nine conditional integration skips; seven separately enabled real FFmpeg integrations pass, including four scaled x264/x265 medium/fast outputs, full decode and original-canvas SSIM. Build passes. Browser scenario covers 12 candidates, common-reference VBR and explicit geometry adoption. Windows harness adds eight real codec/preset/geometry branches (320×180/160×90), 32 CQ windows and two scaled VBR windows. Hosted outcomes are Pending; no local Windows or Chromium execution claimed.

Limitations: Windows Native SDR 8-bit yuv420p pure transcode only. No AV1/VVC/GPU or ASS joint comparison. If all measured byte domains do not overlap, the system refuses extrapolation. SSIM (including the resolution loss) is an objective signal, not a perceptual preference study. Physical devices, long videos and integration into main remain separate work.
