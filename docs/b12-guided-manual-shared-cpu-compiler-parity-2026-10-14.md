# QHE B04/B12 — Guided-to-Manual authoritative CPU task compiler contract

Date: 2026-10-14
State: written on draft PR #105 work branch; exact-head Node/browser/Native acceptance pending
Scope: **intent-preserving CPU handoff**, NOT claim of GPU or web/Android bitwise parity.

## Observed defect and trust boundary
Prior `guidedTaskSettings` built an editable Manual form from a Guided plan, but did not compile it *before* mutating UI and did not compare final executable task fields. It preserved stale Manual defaults implicitly, including a potentially different reserve percent, crop/fps/advanced encoder knobs, and `lanczos` resizing versus Guided Native's bicubic resizing. More importantly, the existing Manual hardsub filter scales **before** ASS, while Guided Native hardsub paints ASS **before** scaling. A codec/bitrate-only comparison cannot establish a common SSIM/reference rendering contract.

## Implementation
- `src/media-task.js`: introduces `subtitleRenderOrder` values `after-scale` (legacy Manual default) and `before-scale` (explicit source-render-first Guided CPU handoff). The hardsub filter generator inserts ASS and trim PTS fixup at the specified location. The original Manual default is unchanged.
- `src/media-workspace.js`: stores `subtitleRenderOrder` as part of the actual shared task form, so serializing/importing the same CPU plan cannot silently drop it.
- `src/guided-task-handoff.js`: explicitly freezes Guided transfer to bicubic, ASS before scaling, reservePercent 4%, full source window, chosen audio/container and CPU software encoder. Native measurements, ASS SSIM and Native VBR certificate do **not** transfer.
- `src/guided-cpu-compiler-contract.js::compileGuidedCpuHandoff`: builds Guided CPU settings, invokes the **authoritative `compileTask`** against current media and source-scoped packet-cost evidence. Independently checks codec, encoder, source range, audio track count, output container, width/height, exact video bitrate and byte budget, reserve percent and independent copied audio/encoded audio cost, two-pass and strict ceiling. It requires the exact source ASS-before-bicubic-scale `-vf` filter and rejects inherited crop, fps conversion or advanced bitrate/geometry parameters instead of pretending those were Guided choices.
- `commitGuidedCpuHandoff`: requires same live source before application, applies form once, re-reads and re-compiles actual UI state, compares all executable FFmpeg arguments and per-stream budget accounting, attempts to restore previous form settings on any divergence and surfaces rollback failure separately.
- The handoff UI changes from Guided to Manual only *after* the transaction has passed. The returned task is a new CPU task that requires fresh validation and must not inherit previous Guided Native CQ/ASS VBR certificate.

## Confirmed bounded evidence
- `src/guided-cpu-compiler-contract.test.mjs`: 11 actual-module isolation tests through the real `compileTask`/sizeBudget/stream/container/time helpers, including copied audio under the same source measurement, software H264 strict/two-pass parity, scaled source-render-first ASS, stale source, compiled budget drift, inherited manual filters, invalid preset, successful transaction, rejected stale source, recompiled form mutation rollback, and explicit rollback failure.
- `src/guided-task-handoff.test.mjs` continues checking quality and strict target settings.
- Draft-fast and full frontend CI include new regression.
- These 11 tests passed in a fresh V8 environment by evaluating retrieved repository implementation modules with their actual dependencies. They are not hosted Node ESM, UI/browser, PowerShell or real FFmpeg acceptance.

## Remaining and limitations
- This contract only covers a freshly compiled **software CPU** task. Native Guided NVENC p7/tune/VBR/maxrate policy is deliberately not called equivalent to Manual CPU x264; Native GPU and Android/Web must have separate evidence and capability adaptation.
- An exact byte target/bitrate match is a **plan** match; it is not a final file size guarantee nor proof of identical codec output or ASS font rendering on different backends.
- Actual UI handoff on Windows, browser persisted configuration, high-density ASS scaling and independent FFmpeg rendered image parity remain Pending. True cross-platform single compiler and output attestation, B16 exact trim/FLAC costs and full B01–B25/A01–A10 exit gates remain open.


## Reference reconstitution check
The new pre-scale ASS task is independently consumed by the already existing `src/media-verification.js::hardsubReferenceFilter`, which reconstructs the filter steps in their encoded `outputArgs` order. The new regression also requires a 2.5 s output-reference frame to apply ASS at the source's timeline **before** bicubic scaling. This preserves the separation of rendered-content intent from codec compression quality (related UIGS Candidate `2026-10-12-intended-reference-and-subtitle-render-order-for-media-qa`). The fixture is a filter-chain oracle, not a real FFmpeg frame or a typography/pixel-identity acceptance.
