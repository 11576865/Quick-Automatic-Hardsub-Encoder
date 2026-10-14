# QHE B11 — genuine Windows Guided ASS VBR short-window verification

Date: 2026-10-14
State: implementation committed on draft PR #105; exact-head Node and Windows FFmpeg CI pending.
Original report requirements: B04/B11/B12/B13/B15; B16 still open.

## What changed

Before this work unit, Windows Native `sampleExact` admitted only Manual source-only SDR comparison receipts, and paired ASS `sampleExact` would route SSIM through the source-reference path or fail to produce an admissible receipt. It was not valid Guided ASS evidence.

A separate exact Native Guided path now requires `sampleExact`, `guidedRenderedReference`, `withSubtitles`, SSIM measurement and a positive target video bitrate simultaneously. The reference is an actual FFV1 clip generated using `ass=subtitle.ass:fontsdir=fonts`; output applies the same ASS filter and optional bicubic scaling before encoding. The comparison uses `Get-Ssim` against the **rendered reference**, never `Get-SsimAgainstSource`. Mixed Manual/Guided flags fail closed.

`Get-BridgeEncoderArgs` uses the **current production Guided** single-pass VBR flags on this new path. This distinction matters: hardware Guided uses p7/tune/vbr/maxrate/bufsize, whereas Manual exact VBR has different flag semantics. Both Guided profile selection and formal Native Guided encoding use the Native preferred-encoder selector. No two-pass equivalence is implied.

`windows/guided-rendered-sample-evidence.ps1` records source/FFmpeg stat tokens (same scheme as Manual), SHA-256 of staged UTF-8 ASS, SHA-256 of the sorted staged font-name/content hashes, encoder, preset request, target bitrate, sample windows, reference metric and explicit non-final quality/byte flags. It compares staged assets before and after sampling and checks Native source/runtime snapshot again. It does not certify system font fallback behavior, installed fonts, adversarial same-stat source substitution or final artifact bytes.

`src/guided-native-vbr-verification.js` independently validates both paired Windows Native VBR receipts, required renderer domain, exact bitrate/encoder/preset/dimensions, source/runtime consistency, the actual ASS text digest computed by the frontend, staged font digest agreement, nonoverlapping positions and valid measured SSIM/video packet bytes. It rejects candidate anomalies rather than silently downgrading the domain to Manual SSIM.

The Guided size-plan UI now exposes:
- **实测当前 ASS VBR** — on Windows Native only, two separate risk-stratified source positions (the same planning engine as other Guided calibration), exact rendered reference, user SSIM threshold.
- **确认采用当前已验证参数** — an explicit acknowledgment tied to the current Guided reference, target SSIM, selected codec, preset, budget, subtitle, font bindings, source, audio/container and source packet-cost observation.

This confirmation does **not** overwrite the selected bitrate or codec; it certifies the existing choice's paired short-window evidence only. Ordinary Guided quick encode remains available without certification. A confirmed short sample is **not** a Native-backed long-term credential, final output SSIM, byte-ceiling admission or a proof of exact two-pass behavior. Source or settings changes revoke eligibility immediately via the current plan identity; restarting Bridge requires new verification.

## Tests / pending evidence

- `src/guided-native-vbr-verification.test.mjs` — 8 pure cases (valid two windows; failed quality threshold; Manual domain refused; wrong ASS/font digests; origin/runtime drift; encoder/geometry mismatch; window/rate/NaN; strict/two-pass refused) plus actual source wiring.
- `scripts/check-guided-vbr-evidence.ps1` — offline Windows PowerShell v5 receipt SHA/font/source mutation refusals.
- Existing `scripts/check-guided-budget-native.ps1` now submits two real FFmpeg ASS VBR Native samples through localhost `/api/sample`, validates SHA independently and verifies origin/runtime/font agreement. It runs with `Windows local smoke` when full gates are enabled.
- Draft-fast/full frontend CI includes new Node tests. PowerShell parse and receipt fixture run in Windows local smoke.
- Isolated retrieved-source V8 execution: 8/8 pure assertions PASS; JS main syntax parsed. Windows exact-head execution, browser interaction, supported NVENC device, resized real frames, high-density ASS and actual users' files still **Pending**.

## Remaining B11 / theoretical initial-version work
This is a concrete Guided ASS VBR verification path, but the theoretical unified codec×resolution×preset decision/adoption transaction is **not closed**: the current UI confirms already-selected settings rather than applying a new branch transaction; there is no attested final-film target SSIM or actual target-size guarantee for best-effort. B16 FLAC, trim range exact pre-cost and cross-platform metering, physical long-form media, full A01–A10 acceptance and main/release integration remain open. Do not promote this small success to complete B11 or initial-version acceptance.
