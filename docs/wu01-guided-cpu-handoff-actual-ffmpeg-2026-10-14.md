# QHE WU-01 — Source-bound CPU handoff and actual FFmpeg acceptance

Date: 2026-10-14. State: submitted / exact-head hosted CI pending. WU-01 remains INCOMPLETE.
Authority: B02/B04/B11/B12 and A05/A06; route snapshot: docs/qhe-initial-version-route-reanchor-2026-10-14.md.

## Implemented
- Reject a precompiled Guided CPU contract whose own sourceKey differs from the currently selected expectedSourceIdentity, even when the caller and current source agree.
- Recheck live source identity after the authoritative post-apply compileTask before returning success; failed transactions still take the existing explicit rollback/error path.
- Add two regression cases for previous-source contracts and source changes during recompile.
- Add a real FFmpeg fixture: 3-second FFV1 source plus ASS, source-bound Guided budget, Manual form adoption, authoritative schema-v4 outputArgs, H.264 x264 output, FFprobe codec/geometry/pixel format, full decode and independent subtitle/ASS-filter-order contrasts.
- Run the focused fixture in Draft pull requests via a new Ubuntu FFmpeg/libass workflow.

## Not proven
The completed hosted CI status has not yet been read. This does not verify actual Chromium button interactions, production Windows Native HTTP execution from the same imported form, GPU parity, long-form SSIM, strict arbitrary-byte target, fonts on a user's machine, playback compatibility or release. WU-01 stays open until separately verified.

This bounded work does not expand the initial-version specification and does not resume B16.


## Next bounded slice — real browser UI transaction, 2026-10-14

- Prior exact-head dcecd685: Test frontend, WU01 FFmpeg/libass x264, Windows B16 and UIGS Coverage workflow SUCCESS.
- New scripts/check-wu01-browser.cjs uses actual Playwright Chromium and production mountMediaWorkspace with a controlled 3-second source/media probe and Guided snapshot. It tests a real click with no source (rejects/no form change), a subsequent valid click (Manual form codec, preset, size reserve, renderer order, geometry, audio and container), and the actual taskRun event reaching an executable compileTask outputArgs; fake legacy VBR certificate must not be borrowed.
- Backend run/save of the browser fixture is deliberately controlled, **not** Windows Native FFmpeg or actual file validation. Windows Native same-task end-to-end remains a separate WU01 exit condition.
- The workflow's browser job runs on Draft and remains exact-head external validation pending until a successful Actions result is observed.
