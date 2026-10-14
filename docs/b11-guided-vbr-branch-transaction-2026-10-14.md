# QHE B04/B11/B12 — Guided recommendation becomes an explicit VBR-verified transaction

Date: 2026-10-14
Product: PR #105, Draft. No merged release and no full theoretical initial version claim.

## Before / fixed contract
Previously `adoptSizeFrontierBranchBtn` directly changed `state.selectedCodec` (and sometimes `guidedOutputSize`) on a CQ interpolated multi-branch recommendation. The actual ASS-rendered VBR short-window validator introduced in B11 only checked the already-selected codec. These operations were disconnected: a recommended codec/resolution could be switched into the formal Guided plan without verifying it in rendered-reference VBR mode.

## Current state machine
- Recommendation from a same-reference, in-range Guided multi-branch frontier becomes an immutable **pending proposal**. Stage does not alter codec, resolution, bitrate or any formal Native request.
- `src/guided-branch-adoption.js` records candidate branch, codec, preset, output geometry, observed target bitrate and byte budget, current rendered reference and original selected branch. A proposal that equals the incumbent is refused.
- Each subsequent UI view re-evaluates the **live current frontier**: the same source/render reference, candidate branch and video bitrate, current target bytes, unchanged original codec/geometry and candidate preset must still match. Stale candidates cannot receive or reuse a completed short-window VBR certificate.
- `runGuidedVbrVerification` tests the pending **hypothetical** candidate plan without mutating form/state. It uses the B11 actual Native two-window ASS-rendered SSIM and source/runtime/staged ASS SHA-256 plus font digest contract. The approval key includes the candidate identity, current quality target, audio/container/budget/source/render state.
- After real VBR pass, and **only after explicit user confirmation**, `commitVerifiedGuidedBranch` rechecks the source/proposal/evidence and compiles the hypothetical plan, applies codec and geometry once, compiles the actual plan, compares executable fields including target bitrate/bytes/audio reserve, and rolls codec/size back on divergence. It does not force an output, auto-run encodes or claim whole-file quality. Any rollback failure is explicit, not misreported as adoption.
- This is a Guided **selected-state** transaction. Manual's verified commit remains a distinct form transaction; shared behavior is explicit verified certificate, source/settings freshness gate, no automatic branch switch, executable plan comparison and rollback. A fully shared product-wide compiler/serializer is still an unclosed initial version obligation.
- The applied candidate becomes the current Guided selection; the old staged approval is consumed and is not recycled as a generic proof of its future VBR runs. Formal Native job still needs independent output/full budget validation.

## Native preset truth correction
The earlier B11 Native Guided receipt recorded `Options.preset` even for NVENC, although production Guided NVENC uses **p7**. `windows/native-bridge.ps1` now passes the actually executed preset to `New-GuidedExactVbrReceipt`, and `src/guided-native-vbr-verification.js` validates `expectedPreset='p7'` for NVENC or the configured software preset for CPU. Frontend request and output container also now use the *pending candidate codec*, not the prior selected codec. This avoids both false confidence and false rejection.

## Evidence
- `src/guided-branch-adoption.js` and `src/guided-branch-adoption.test.mjs`: proposal staging, stale source/frontier/settings protection, successful atomic commit, source-resolution vs resized identity, preview refusal without mutation, post-commit rollback, explicit rollback failure, diagnostic prediction change not changing executable task contract.
- `src/guided-native-vbr-verification.test.mjs`: additional actual p7 NVENC preset test.
- `.github/workflows/test-frontend.yml`: Draft-fast/full suite wired.
- 18 pure tests on retrieved actual JavaScript module implementations passed in an isolated V8 interpreter; main frontend entrypoint parsed. These are **not** full Node import tests, browser tests, PowerShell tests or real FFmpeg tests.

## Remaining acceptance
- Exact-head Node frontend, Native staged Windows FFmpeg VBR and browser UI interaction; actual NVENC hardware acceptance and different codec+geometry candidate on real ASS/high-density sources. These remain Pending.
- Some actual Guided codec/preset combinations are not supported by the existing Native formal encoding profile; candidate whose compiled preset disagrees fails closed instead of silently adopting.
- Real final-output SSIM and size/stream validation, two-pass/strict-ceiling source and output parity, full shared Manual/Guided adoption compiler, long forms and device coverage B01–B25/A01–A10 remain incomplete.
