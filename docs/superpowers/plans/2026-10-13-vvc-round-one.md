# VVC Round One Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; tests precede implementation.

**Goal:** Add an executable, capability-gated Windows VVC workflow and user-facing controls.
**Architecture:** Extend task v4 and structured Windows argument validation; keep the
current task form authoritative. Probe encode, MKV writer, metadata and decoder before
exposing availability. Other backends retain their existing capability boundaries.
**Tech Stack:** JavaScript, Node test runner, PowerShell 5.1, FFmpeg, Vite, Chromium.
**Spec:** `docs/superpowers/specs/2026-10-13-five-round-delivery-design.md`

## Global Constraints
- No main merge or deployment; branch depends on PR #104.
- SDR input only; VVC output uses yuv420p10le and MKV.
- VVC QP is integer 0..63, default 32; no CRF or NVENC substitution.
- Local tests and hosted Windows/physical validation have separate statuses.

## Review Focus
- A saved x264 preset or advanced parameter must not leak into VVC.
- A listed encoder with unusable muxer/decoder must remain unavailable.
- Importing a VVC configuration on Android/Web must fail without codec substitution.
- A completed VVC output must be identified as VVC before export.
- Input HDR blocking must remain effective despite 10-bit output.

### Task 1: Compiler and validation
Files: `src/media-task.js`, `src/task-argument-schema.json`,
`src/media-capabilities.js`, `src/vvc-task.test.mjs`, `windows/media-task.ps1`.
- [ ] Write failing tests for QP/bitrate, unsupported fields, preset/pixel/container constraints.
- [ ] Run `node --test src/vvc-task.test.mjs` and inspect the expected failures.
- [ ] Implement VVC compilation and validate `-qp` capability without weakening existing contracts.
- [ ] Run focused tests and full `node --test src/*.test.mjs`.

### Task 2: Runtime and UI
Files: `windows/native-backend.ps1`, `windows/native-bridge.ps1`,
`src/media-workspace.js`, `src/main.js`, `src/transcode-calibration-panel.js`,
`scripts/check-vvc-native.ps1`, browser acceptance script and workflows.
- [ ] Add executable Windows assertions and browser tests before production changes.
- [ ] Implement bounded VVC runtime probe and explicit unavailable/experimental UI state.
- [ ] Verify formal output codec identity, register CI and run browser checks/build.

### Task 3: Durable delivery
- [ ] Update `.uigs/tasks/qhe-five-round-delivery.json` with test results and next unit.
- [ ] Review diff, commit and push this independent branch; create draft PR.
- [ ] Deduplicate and record one reusable VVC capability case in UIGS-Foundry.
- [ ] Report exact implemented scope, validation gaps and next round.
