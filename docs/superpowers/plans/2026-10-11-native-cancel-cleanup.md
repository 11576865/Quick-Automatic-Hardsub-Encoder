# Windows Native cancellation cleanup implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline.

**Goal:** Cancelling an incomplete encode finalizes and removes private staging without requiring another UI status request.

**Architecture:** Keep the existing synchronous Bridge/job state machine. Cancellation marks the job before stopping FFmpeg, waits at most three seconds for exit, then reuses finalization. Only confirmed exited failed/cancelled jobs lose their private staging; completed outputs remain exportable.

**Tech Stack:** Windows PowerShell 5.1, FFmpeg, localhost HTTP Bridge, GitHub Actions.

**Spec:** This document defines the bounded correction to the cancellation/cleanup gaps identified in #85; real hardware/long-form acceptance remains #77.

## Global constraints

- Preserve user-exported files and completed staging.
- Never launch the second pass after cancellation is requested.
- Do not dispose or delete staging while FFmpeg is still running.
- No automatic encoding retry or change in codec/quality policy.
- Forced termination, power loss and restart recovery remain outside this correction.

## Review focus

- Cancellation during either pass must remove output, ASS/font copies and pass logs.
- Cancellation after pass one exits but before status starts pass two must suppress the transition.
- Repeated cancellation/status must avoid disposed handles.
- Cancelling an already finalized completed job must preserve exportability.
- Stop failure must remain nonterminal until process exit; an existing output path must not be touched.

### Task 1: reproduce and correct cancellation finalization

**Files:** `windows/native-bridge.ps1`, `scripts/check-guided-budget-native.ps1`, `.github/workflows/windows-local-smoke.yml`.

**Interfaces:** `Cancel-EncodeJob([string]$JobId)` returns a job status; `Clear-IncompleteJobStaging($Job)` removes only failed/cancelled private work. The HTTP cancel route delegates to the former.

- [x] Add a real Bridge/FFmpeg regression that cancels without a subsequent status poll and checks staging removal, both phases, repeated requests and export rejection.
- [x] Observe the baseline Windows failure at the no-poll cleanup assertion.
- [x] Add bounded stop/wait/finalize cancellation and cleanup after incomplete terminal finalization.
- [x] Add completed-state preservation and pass-boundary cancellation checks.
- [x] Run Node tests, FFmpeg integration, build and Windows CI. Record exact evidence and limits in the PR.

Evidence: baseline commit `878b0fa`, Windows job `114400708188` failed at `Pass 1 cancellation left staging behind without status polling`. Local baseline: 142 passed/5 skipped Node tests, all 5 FFmpeg integration tests passed, Vite build passed.

Review follow-up: initial implementation `adb1643` passed Windows smoke/runtime and UIGS. Independent review found the natural-exit/Kill exception race. Regression commit `3a4d1fa` failed at `exit-during-kill did not finalize at cancel ingress` in Windows job `114401443259`. The correction confirms process exit independently of Kill success, with a complementary still-running stop-failure case. Final verification is recorded in PR #88.

Deferred review minors: the tiny HTTP fixture requires observing pass two and can be timing-sensitive on faster runners; the direct-process fixtures use dummy staged assets, complemented by actual Bridge encoding; a missing/empty already-completed output defers full private-directory cleanup until a further status/cancel request. Forced termination/restart recovery remains outside this correction.
