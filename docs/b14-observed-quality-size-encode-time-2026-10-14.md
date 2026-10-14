# QHE B14 — Native measured CQ quality/size/encoding-time tradeoff (Draft)

Date: 2026-10-14
Product baseline: R19 §10/§15; R24 §13/§17; B14 is not fully accepted.

## New implementation
- `src/manual-time-tradeoff.js` consumes only completed candidate CQ settings from the existing source-paired `createManualTranscodeSession` evidence. Each setting requires all source-paired windows and their independently admitted Native FFmpeg encode-stopwatch elapsed seconds, SSIM and video packet bitrates.
- The observed compute time is the sum of the actual FFmpeg encoding command's elapsed times in `windows/native-bridge.ps1::Invoke-Sample`. It does **not** include whole-source probing, UI wait time, subsequent SSIM evaluation or final movie encode time.
- Each candidate exposes sample-video duration, observed FFmpeg encoding seconds, ratio of sample media seconds to encoding seconds, and minimum/maximum measured window speed factors, alongside SSIM and video bitrate. Missing, zero, nonfinite, mismatched or incomplete measurements are not silently treated as fast outcomes.
- Only a same-source, same-reference, same-paired-windows protocol can be compared. Cross-candidate time/bitrate ratios appear only when both the minimum SSIM and average SSIM of actually measured candidate CQ settings are within 0.003 of each other. These are **near-quality comparisons**, not equal-quality certificates.
- The Manual candidate details show the nearest **actually measured** CQ quality setting to the selected video target bitrate. The numerical rate difference is explicit. The estimated optimum from the fitted RD frontier **does not inherit** that time measurement; unmeasured budgets cannot be time-ranked.
- A user-initiated JSON evidence export includes the measurement protocol, current budget coordinate, measured observations and evidence limitations. It does not grant publishing authority or change encoder choice.
- Native VBR verification and explicit transaction adoption remain unchanged; the time dimension cannot automatically switch codecs.

## Tests and limitations
- `src/manual-time-tradeoff.test.mjs`: aligned complete windows, near-quality evidence, timing/size ratios, missing/malformed/nonfinite timing, mismatched source/protocol, truncated windows, no full-movie estimate, UI diagnostics and export contract.
- `src/manual-transcode-session.test.mjs`: integration through the established complete native session register.
- `.github/workflows/test-frontend.yml`: adds tests to both Draft fast and full frontend jobs.

Still open under B14: full-job elapsed/energy/resource measurement, real long-form cross-device benchmarks, user-driven time/quality target policy, GPU time/quality comparisons, variable-rate and ASS rendering workloads, systematic uncertainty/variance across repetitions and release acceptance. No user time budget is treated as a guaranteed finish time.

Acceptance state: code submitted, exact-head fast CI Pending. Historical Windows x264/x265 short-sample acceptance is not proof of this new UI or metric presentation.
