# Round three: whole-file budget and delivery gate

Implement a source-scoped cost ledger: encoded audio rates, measured copied audio
packet bytes, attachment payload bytes, subtitle payload bytes, and an explicit
container reserve. Unknown costs remain unknown. Windows Native provides a bounded
full-source auxiliary scan; trimmed copied streams remain unsupported until measured
under a trim-specific contract. No source measurements are saved in user configs.

Add explicit best-effort / strict-ceiling manual delivery policy. Strict mode checks
actual whole-container bytes in Windows completion and export, Android completion
and export, and browser save; it never truncates media to meet a limit. Expose budget
components and actionable recovery without automatic re-encoding.

Fix previous CI: nullable Android audio properties and narrow-screen auxiliary controls.
Verify pure-budget arithmetic/rejections and real FFmpeg artifacts; independent review;
persist branch/PR/task record. Native/mobile/browser checks remain separate evidence.

## Execution ledger
- Recovery base: f916c5a, PR #105 head, independent feature branch retained.
- Budget/compiler/report tests observed RED, then GREEN; new source-snapshot test rejects imported measurements.
- Source payload ledger separates copied audio, copied subtitles, attachment extradata, duration-specific encoded audio and explicit container reserve.
- Source cost scan is Windows-only, streaming scalar aggregation with 30 seconds and two million packets per media class. Evidence is tied to selected path/length/write stamp and measurement ID; unknown/trimmed copied streams and FLAC re-encode remain refused in size mode.
- Ruling: source costs are transient snapshot state rather than user configuration. Strict limits are actual container acceptance gates, not convergence promises or automatic retries.
- Windows manual tasks use the existing guided fingerprint/export byte guard; Android checks completion, persisted contract, streamed copy bytes/hash and destination readback; browser workspace/report/save refuses unproven or oversized strict artifacts.
- Previous Android nullable properties and narrow-screen intrinsic label/input widths repaired; their platform execution remains Pending.
- Local Node suite: 204 passed, 7 conditional integration skips, 0 failed. Actual FFmpeg: 5 passed including full-container ledger with FLAC copy, subtitle and 4000-byte attachment, exact/oversized byte-boundary acceptance. Vite build and diff checks pass.
- Added Windows localhost cost/strict artifact tests and real-DOM simulated-backend browser budget/save/config/source lifecycle checks. Local Chromium, PowerShell and Android toolchains are unavailable; hosted execution remains Pending.
- Independent whole-unit review found three Important issues: navigation strict-policy leakage, oversized-artifact cleanup and Android write-before-fingerprint acceptance. One bounded repair pass clears both operation switch paths, preserves private oversized manual artifacts, and freezes/verifies the Android export source before destination writes; failed newly created strict documents are removed or cleanup failure is reported. Double BOM found and RED/GREEN file-format regression added.
- Hosted Android instrumentation now covers strict contract parsing and exact/over-limit/missing byte cases. SAF mutation/provider failure behavior and real platform execution remain Pending.
- Ruling: ACTION_CREATE_DOCUMENT owns a new export document; failure cleanup applies only to this export destination, never to input or existing source media. Providers that refuse deletion receive explicit cleanup-failed output rather than success.

- Publication checkpoint: implementation commit 2c8aef3, validation checkpoint ac42de8. Automatic approval review rejected the public GitHub push both before and after owner/public-visibility verification. PR #105 remains at f916c5a; round-three CI has not started. No connector workaround attempted. Await explicit user authorization for this exact public feature-branch push.
