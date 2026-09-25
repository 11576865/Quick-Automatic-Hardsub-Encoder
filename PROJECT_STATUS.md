# Project status — v0.1.0

## Implemented
- Windows 11 local PowerShell entry point: FFmpeg detection / optional winget installation, local ASS encode with libass, codec choice, selected font files, progress and cancel (initial implementation; Windows end-to-end validation still needed)
- Browser UI and ≤1 GiB guard
- ASS style/dialogue parsing and inline `\\fn` discovery
- TTF/OTF/TTC/OTC internal name parsing
- Static font-name matching and explicit warning/continue flow
- Device/browser capability detection (WASM, SharedArrayBuffer, WebCodecs H.264/H.265/AV1)
- FFmpegKitNext adapter
- WORKERFS input mounting design (avoids duplicating the entire source into the WASM heap)
- FFprobe media analysis
- Real libass preview frame generation
- H.264/x264, H.265/x265 and AV1/SVT-AV1 sample benchmark interface
- SSIM sample comparison
- Estimated full encode size/time
- 1.6x, 2.0x and efficiency-curve policies
- Final hard-subtitle encode with audio stream copy
- MKV download
- GitHub Pages workflow
- COOP/COEP workaround through coi-serviceworker
- Manual workflow to build the custom FFmpegKitNext Web core

## Still required before end-to-end encoding works
The list below concerns the browser WebAssembly backend. The Windows local entry point uses system/bundled FFmpeg instead.
1. Run `.github/workflows/build-core.yml` on GitHub or build FFmpegKitNext locally.
2. Put the resulting package under `public/vendor/ffmpeg-kit-next-web/`.
3. Verify the exact FFmpegKitNext build flags against the current upstream revision and fix any upstream build regressions.
4. Test on the target Android tablet with 50 MB, 300 MB and near-1 GB inputs.
5. Calibrate comparable quality targets/CRF search across x264/x265/SVT-AV1; current CRFs are bootstrap defaults, not the final automatic quality model.
6. Parse libass fontselect logs and add glyph-level missing-character verification.
7. Replace the conservative bootstrap candidate selector with the final Pareto/knee-point search after real benchmark data is collected.
