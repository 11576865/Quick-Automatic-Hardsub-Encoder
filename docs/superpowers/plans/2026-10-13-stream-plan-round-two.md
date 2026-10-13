# Round two: per-stream output plan

Goal: expose independent source audio actions and selected subtitle/attachment mapping
through the existing authoritative task form and task-v4 compiler. Preserve legacy
global controls when no explicit plan exists. No second optimizer or task store.

Implementation: `media-stream-plan.js` normalizes bounded (32) audio plans and
selected auxiliary streams; compiler emits indexed audio options and a traceable
`outputPlan`. Windows, Android and Web accept the same restricted option family.
UI uses per-track rows backed by one hidden JSON form field; changing source clears
the plan. Copy/AAC/Opus/FLAC/drop are explicit. Lossless audio/copy budgets remain
unknown and size planning refuses unsupported mixed plans until round three.

Tests: RED/GREEN compiler cases for heterogeneous audio, ordering, omission/drop,
index rejection, independent ranges and container compatibility; real FFmpeg
integration checks packet identity for copied audio and actual codec/channel counts.
PowerShell history parser and nested-array CI fix are executable Windows checks.
Browser fixtures test form ownership/source reset; hosted runtime results are Pending.

Acceptance: local suite/integration/build; independent diff review; update PR #105
and durable task state. This round does not declare physical device/player coverage.

## Execution ledger
- Initial five behavioral compiler cases observed RED then GREEN.
- Local suite: 196 passed / 6 skipped / 0 failed.
- Actual FFmpeg task and heterogeneous audio integration: 4 passed. Vite build passed.
- Independent review: Android count/range ownership, UI defaults/config refresh, known audio budget, curve audio cost and Android auxiliary counts corrected.
- Scope ruling: guided hard-sub keeps global audio policy; per-track controls are hidden there until the guided task kernel adopts them. Cost: per-track features currently use manual workspaces.
- Copy/FLAC budgets remain unknown rather than falsely precise; round three owns packet/attachment accounting.
- Windows FPS parser, structured argument checks, Android compile/runtime and Chromium UI assertions registered; Pending external validation.
- Previous Windows red traced to PS5.1 nested top-level JSON array in the VVC test, not an encoder failure. Array reader corrected without relaxing verifier.
