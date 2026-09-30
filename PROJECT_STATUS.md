# Project status — v0.1.1

## Implemented
- Desktop visual language now follows the mobile task shell: compact glass header, two-stage segmented workflow, sky/grass/violet task accents, colored source cards, quieter surfaces, larger preview emphasis and matching analyze/encode CTA hierarchy while keeping the desktop all-at-once workflow.
- Windows 11 local PowerShell entry point: FFmpeg detection / optional winget installation, local ASS encode with libass, codec choice, selected font files, progress and cancel (initial implementation; Windows end-to-end validation still needed)
- Browser UI and ≤1 GiB guard
- ASS style/dialogue parsing and inline `\\fn` discovery
- TTF/OTF/TTC/OTC internal name parsing
- TrueType/OpenType cmap glyph coverage parsing and ASS actual-character tracking
- Static font-name matching and explicit warning/continue flow
- Device/browser capability detection (WASM, SharedArrayBuffer, WebCodecs H.264/H.265/AV1)
- FFmpegKitNext adapter
- WORKERFS input mounting design (avoids duplicating the entire source into the WASM heap)
- FFprobe media analysis
- Real libass preview frame generation
- H.264/x264, H.265/x265 and AV1/SVT-AV1 sample benchmark interface
- SSIM sample comparison
- Estimated full encode size/time
- Slider-driven quick preset, target-quality calibration/auto-codec selection, and continuous target-size planning
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
6. Static glyph verification is implemented; continue improving runtime libass fontselect/fallback cross-checking on native backends.
7. Replace the conservative bootstrap candidate selector with the final Pareto/knee-point search after real benchmark data is collected.
