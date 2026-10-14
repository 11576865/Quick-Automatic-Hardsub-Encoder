# QHE B15 — shared Native scene-risk windows for Manual and Guided

Date: 2026-10-14
Status: implementation submitted in draft PR #105, external frontend/Windows CI Pending.
Theory: R19 §10, R24 §17; B15 is still incomplete.

## Actual shared interface
Guided ASS already selects time-stratified risk windows using `scene-risk-selection.js::selectPairedSceneWindows` and the existing Native `sceneRiskOnly` signal probe. Manual multi-encoder comparison previously used fixed `calibrationSampleStarts(from,to,2,2)` for its two windows.

This work adds `src/manual-paired-risk-plan.js`, which uses the **same** bounded source-scene risk scorer and the **same** Windows Native scene-risk request. `src/main.js` exposes a narrowly scoped `sceneRiskProbe` hook. Manual's existing `manual-transcode-compare-ui.js` builds its shared windows **before** the first CQ sample, then embeds its plan fingerprint in `samplePlanVersion` of the existing source/runtime/reference Native comparison protocol. The same absolute source timestamps are used by every codec × preset × resolution candidate and in its subsequent actual VBR confirmation.

## Boundaries
- Pure Manual target uses `pure-source-sdr-no-ass`; Guided ASS uses a subtitle-rendered reference and may depend on ASS content/fonts/renderer. Windows source-only Native risk signals can guide positions in both, but **Manual SSIM values/curves cannot be rebranded as Guided ASS SSIM evidence**. This patch does not merge CQ samples, quality thresholds, VBR certificates, or automatic codec choices.
- For longer, seekable sources Manual attempts at most three risk-signal Native probes, within a bounded 9 second planning budget; a failure is **unknown** risk, not zero-risk evidence.
- The shared three-stratum scene selector can yield three candidates. For exactly two Manual CQ windows, the adapter chooses the highest observed-risk representative and a distant second stratum when available. If there are no probes or if either window is unusable/overlapping, it falls back to two non-overlapping `calibrationSampleStarts` windows, explicitly labelling missing risk evidence.
- For trim tasks, all selected timestamps are converted to *absolute* input source times. Unseekable sources and clips with fewer than two distinct windows fail closed rather than silently duplicating one sample.
- Each asynchronous probe is guarded by the current source/settings identity before and after the Native await. Stale evidence cannot be included in a new protocol.
- `riskAware` means the original bounded risk selector obtained sufficient signals, not a statistical confidence claim or proof that rare scenes were encountered.
- The finalized sampling protocol is session-local and deterministic given the same source/probe inputs. No cross-session evidence reuse is added.

## Implementation and test
- `src/manual-paired-risk-plan.js` + `src/manual-paired-risk-plan.test.mjs`
- `src/main.js` Native sceneRiskProbe (uses existing `requestNativeSample({sceneRiskOnly:true})`)
- `src/manual-transcode-compare-ui.js`: bounded asynchronous plan preflight, shared windows, explicit status and protocol fingerprint
- `.github/workflows/test-frontend.yml`: new test in draft-fast and full frontend suites.
- Six isolated source-equivalent JavaScript logic tests executed successfully before commit, with source changing during awaiting, 4-second limit, failures and trim offsets checked. UI module parsed. These are **not** hosted Node/Windows Native, browser, or real FFmpeg source acceptance.

## Still open
B15: Guided high-density ASS / font-render risk coverage and actual scene-hardening field evidence; adaptive added paired windows and uncertainty-driven refinements; real Windows Native probe and UI acceptance, source changes during actual command execution; representative dark/noisy/VFR inputs; separate rendered reference identity for unified B11 compare.

B04/B11/B12: shared UI/task compiler, Manual frontier and Guided ASS frontier are not equivalent to a single fully accepted codec decision contract. No B04/B11/B12 closeout or full initial version claim.
