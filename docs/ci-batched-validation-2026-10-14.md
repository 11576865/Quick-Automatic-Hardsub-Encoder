# QHE: batched development and CI validation

Status: proposed implementation on PR #105, pending exact-head external validation.
Date: 2026-10-14

## Motivation and confirmed bottleneck

PR #105 is a large stacked draft against #104. GitHub `pull_request.paths` evaluates the whole PR diff, so repeated small commits to the same PR can keep triggering full Windows, Android and VVC suites even when the latest commit changes only a task record.

Observed Windows VVC run [38440266547](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38440266547) completed successfully but spent about 4m49s resolving/downloading/verifying the FFmpeg/libvvenc toolchain; the real QP/bitrate/ASS acceptance step took about 16s. These are exact-log observations, not promises for other runs.

## Implemented validation cadence

1. **Draft PR / iterative implementation:** `Test frontend / draft-fast` runs selected pure model/task regressions and `npm ci && npm run build`. `UIGS Evidence Coverage` remains enabled. Heavy FFmpeg integrations, Chromium screenshots, Android emulator, Native paired tests and mandatory VVC runtime do **not** run automatically on each draft synchronization.
2. **Checkpoint or explicit validation:** full workflow definitions retain `workflow_dispatch`. Their job-level guard permits dispatch even on drafts. Note that GitHub may require a workflow file to exist on the default branch before its manual dispatch is available; use Ready for Review when dispatch is unavailable (including newly introduced workflows).
3. **Ready for Review:** `ready_for_review` is an explicit `pull_request` trigger, and full jobs run on each relevant PR event. A returned draft followed by more commits goes back to draft-fast. Branch protection, reviewers and release must use actual full checks, not skipped jobs.
4. **main:** main-push full workflows remain enabled per existing path filters; Windows local smoke `push` is now restricted to `main` to avoid duplicate runs for ordinary feature branches.
5. **Cancellation:** workflow-scoped concurrency cancels superseded runs for the same PR/ref. This does not convert a cancelled job into a passing test; required final exact-head checks still must succeed.

Current heavy gate scope: `Test frontend / frontend`, `Windows local smoke`, `Windows Manual paired codec acceptance`, `Windows Stream Plan v4 runtime acceptance`, `Android Stream Plan v4 emulator runtime acceptance`, `Stream Plan v4 device fixture`, `Compile Android media tasks`, `Windows required VVC runtime acceptance`. `UIGS Evidence Coverage` remains its own short validator.

## VVC supply-chain/cache boundary

The VVC job resolves the upstream `BtbN/FFmpeg-Builds` release asset SHA-256 before cache restore. `actions/cache@v4` keys the Windows FFmpeg archive by that digest, never by mutable `latest` alone. The installer verifies the current digest, optional pre-resolved digest and cached/downloaded archive before extraction; an invalid cache **fails closed**. Toolchain cache is runner-only; it never packages FFmpeg in the product. Successful real QP/bitrate/ASS execution and decoder validation remain mandatory at checkpoint.

## Explicit evidence and operational limits

- This changes how CI is scheduled; it does not close any B01–B25 product requirement or A01–A10 field acceptance gate.
- Automatic checks skipped in draft mode are **Pending**, never PASS. `draft-fast` success is not full CI.
- No merger, release, physical device test, full-length film acceptance or speedup percentage is claimed by editing YAML.
- Before merging PR #105: mark Ready for Review, run all relevant full workflows at the exact review head, review required-check configuration and current code, and resolve all failures.
- Work-unit checkpoints remain mandatory; batching tests is not permission to keep unpublished code only in a disposable session.

## Verification required after push

- Draft PR synchronize: `draft-fast` is actually scheduled and passes, heavy jobs are skipped.
- Ready for Review: relevant full jobs schedule and run; no missing required gate.
- Manual dispatch: existing eligible workflows run on the chosen branch, even while draft.
- VVC cold miss / warm cache: both run real codec tests, emitted provenance carries correct digest; corrupted archive is rejected.
- Success and cancellation states must be attached to exact commit IDs; no blanket completed claim.
