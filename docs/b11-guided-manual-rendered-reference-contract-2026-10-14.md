# QHE B04/B11 — decision reference identity for Guided ASS and Manual transcode

Date: 2026-10-14
State: drafted and source-tested; exact-head frontend build/Node/Windows/Browser acceptance pending.
Requirements: B04, B11, B12, B15; initial-version reporting denominator remains the full accepted theoretical report.

## Defect boundary

The existing Guided ASS size-quality model lookup used a source video and Native runtime-derived `sourceScope` but did not independently require the *current subtitle rendering state*. After changing the active ASS text or font substitution, a stored curve could still be reached by a source/runtime-only key or an earlier quality calibration could be used for a formal CRF plan. This is a stale-evidence risk; no field reproduction is claimed.

The Manual candidate comparison already checks native source/runtime/reference/filter/window tokens and requires separate VBR short-window verification before formal adoption. Its pure-source SDR SSIM is not interchangeable with subtitle-rendered Guided ASS SSIM even when candidates sample the same video timestamps.

## Implementation

- `src/decision-reference-scope.js`: exports `guidedAssDecisionScope`, `manualSourceDecisionScope`, `sameDecisionReference`. The Guided scope includes source/runtime, active ASS text, selected/effective font file metadata, forced font mappings, fallback mappings and renderer context. Manual scope is separately tagged pure-source and binds the native protocol reference/window identity. The Guided scope has a fast noncryptographic 64-bit hash **for stale UI cache invalidation only**, not content authentication.
- `src/main.js::currentGuidedDecisionScope`: computes and memoizes the current render identity; source/runtime/ASS text/font manifest/mappings modifications invalidate cached results.
- Guided single-codec and multi-codec CQ/RD and resolution frontiers only admit models carrying the *matching current render scope*; the verified CRF plan and displayed calibration must also have current scope.
- Guided sampled CQ records are tagged with the original plan scope. Risk probes capture the scope **before** asynchronously invoking Native, and recheck it after each response and before accepting observed windows. The output codec/quality evaluation likewise rejects ASS/font changes before and after Native awaits. Paired refinement checks the same scope before admitting any additional points. An invalid scope makes old observations **ineligible**, not automatically migrated or retargeted.
- Manual comparison now publishes its independent `referenceScope` and `referenceDomain:'pure-source-sdr-no-ass'` alongside the existing stronger Native `evidenceScope`. The user-initiated Manual diagnostic JSON receipt includes the explicit reference domain. Existing VBR source/bitrate verification, explicit form commit and rollback are unchanged.
- A shared tag/eligibility vocabulary is infrastructure toward one decision contract, **not proof of equivalent reference metrics, sample methods or codec switching**.

## Test and scope

- `src/decision-reference-scope.test.mjs`: source/runtime changes, same-length ASS edits, font substitution/file metadata, canonical font map ordering, Manual paired-window/metric changes, Guided-vs-Manual noncomparable references, fail-closed missing evidence, and source-level wiring.
- New test included in Draft-fast and full Test frontend workflows.
- Seven extracted pure JS logic tests against the retrieved code passed in an isolated V8 evaluation. This is not a complete Node import/browser/Native test.
- Pending exact-head CI, Native/real-browser source change during sample, Guided ASS reference rendering, manual independent reference after switching settings, and real-world font file replacement.
- Stat-derived source metadata and a noncryptographic fingerprint cannot attest content if an adversary substitutes bytes while preserving metadata; a stronger source/content hash remains a future trust-boundary enhancement.

## Acceptance still open
Full shared Guided ASS–Manual decision *and adoption* contract, actual Guided ASS VBR windows and output size validation, high-density ASS scene risk samples, physical longform/codec/equipment validation, and Native Bridge restart recovery. This patch must not close B04/B11/B12/B15 or declare initial version complete.
