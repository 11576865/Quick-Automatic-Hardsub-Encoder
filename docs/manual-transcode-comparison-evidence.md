# Manual Transcode: comparable candidate evidence v1

Date: 2026-10-12  
Status: **experimental, session-only, read-only data-model contract**; not shipped Manual UI, not user-facing automatic encoder choice  
Related: `src/manual-transcode-comparison.js`, `src/manual-transcode-comparison.test.mjs`

## Motivation and architecture

QHE already has two different operating chains:

- Guided ASS target-size mode supports a verified same-source, same-reference, evidence-bounded multi-codec or multi-resolution upper envelope. Draft PR #103 adds candidate-path context in the **same single chart**, retaining explicit user adoption.
- Manual pure-video transcode (`src/transcode-calibration-panel.js`) calibrates **one** codec/encoder/preset/timeline at a time, with an exact Windows Native short-sample path, a single current `points` array, a current `frontier`, and an identity check that **invalidates evidence when codec/encoder/preset changes**. This behavior protects correctness.

The next goal is a compatible, retained-per-candidate trial collection, not a second source of mutable UI settings or a direct reuse of ASS-rendered Guided evidence.

## Proposed read-only API

`createManualTranscodeComparison({trials,budget,incumbentId,hysteresisSsim})` requires two or more individual candidate trial sets. Each candidate includes:

- **protocol**: exact same source token, runtime/build token, decoded reference identity, no-filter/processing identity, source video stream, source interval, actual reference dimensions, SSIM contract `source-sdr-yuv420p-ssim-v1`, exact-source native CQ trial method `windows-native-exact-cq-v1`, paired requested windows and sample-plan version;
- **candidate**: id, codec, exact encoder/preset, output dimensions equal to the common reference, `yuv420p` pixel format;
- **points**: at least two distinct measured mean video bitrates. Each rate point contains every corresponding paired window's actual time position/duration, per-window SSIM and rate; the overall quality/rate summary must agree with those window measurements.
- **budget**: actual planned output duration, explicit nonnegative audio bitrate (measured, estimated or no-audio) and reserve percentage. *An unknown copied audio size must not silently become zero bytes*.

The module uses existing `fitRateDistortionModel` and `createMultiBranchFrontier`, intersecting measured byte-budget domains, comparing conservative sampled quality and honoring incumbent hysteresis. It never interpolates through uncovered budget gaps.

Result has `sessionOnly=true` and `adoptionRequiresNativeVbrVerification=true`. The manual application will need a **separate native bitrate-mode sample check** before applying a selected VBR rate; CQ-derived SSIM is not transferable to VBR by fiat.

## Non-goals and known limitations

**Not implemented in this stage:**
- no manual UI multibranch button or candidate history;
- no native codec-switch trial scheduler, no complete Cartesian-product optimization;
- no automatic switch of codec/preset in the formal task;
- no HDR/VFR and multi-resolution shared-reference comparison;
- no stable cryptographic source verification: the caller-provided `sourceToken` and `referenceToken` are explicit assertions, not identity proofs;
- no playback, full-length encoding, quality or final-byte-size guarantee.

The source token should become a strong scoped resource identity. A future runtime trial API must guarantee that candidate trials are actually produced with the declared exact reference pipeline and paired windows; a pure JS validator cannot infer whether a buggy or malicious back end misstated them.

## Safe integration gate

1. Audit the existing manual panel and Windows Native exact sample API for source id, decoder reference, selected trim, preset and capabilities; define **one authoritative trial/protocol builder** (do not ask UI code to guess identities).
2. Establish a per-branch, session-only immutable evidence registry keyed by protocol plus codec/encoder/preset. Changing the active encoder must not invalidate *other* branches that are demonstrably still compatible, and changing source, runtime, filter/time policy must invalidate all affected evidence.
3. Perform paired same-sample-window CQ trials under explicit cost limits; failed/partial trial must not yield an invented complete branch.
4. Build a read-only candidate inspector/upper-envelope in the existing one-chart manual pane, without changing selection and without mixing actual source SSIM with ASS-bearing references.
5. Only after candidate evidence is complete, explicitly adopt a new task configuration, then independently verify requested native VBR and exact formal output. Preserve the one-branch quick workflow as fallback.

## Regression oracle

`src/manual-transcode-comparison.test.mjs` verifies: compatible pair, single bounded envelope, duplicate branch refusal, missing/misordered samples, unequal windows/reference/run-time/source, invalid source/color protocol, injected non-number SSIM, invalid summary-vs-window statistics, invalid output duration, unknown copied audio budget, no shared bitrate domain, and representative boundary coordinates.

These are **synthetic Node tests of the pure model**, not FFmpeg or real GPU trial acceptance. Frontend CI is wired to run them. Acceptance requires *exact-head CI evidence*, then actual paired native source captures and final encoded verification.

## Separation from other QHE tasks

Video Stream Copy cutting doesn't have an encoder-rate-distortion decision; it needs proof of preserved packets, realized seek boundary, PTS/DTS, audio synchrony and output integrity. Guided ASS can share the abstract model, not its reference/evidence observations. No QHE task-v4 or clip queue semantics are changed here.
