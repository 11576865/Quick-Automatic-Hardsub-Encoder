# Manual Transcode: comparable candidate evidence v1

Date: 2026-10-12  
Status: **experimental, session-only, read-only data-model contract**; not shipped Manual UI, not user-facing automatic encoder choice  
Related: `src/manual-transcode-comparison.js`, `src/manual-transcode-comparison.test.mjs`

## Motivation and architecture

QHE already has two different operating chains:

- Guided ASS target-size mode supports a verified same-source, same-reference, evidence-bounded multi-codec or multi-resolution upper envelope. Draft PR #103 adds candidate-path context in the **same single chart**, retaining explicit user adoption.
- Manual pure-video transcode (`src/transcode-calibration-panel.js`) calibrates **one** codec/encoder/preset/timeline at a time, with an exact Windows Native short-sample path, a single current `points` array, a current `frontier`, and an identity check that **invalidates evidence when codec/encoder/preset changes**. This behavior protects correctness.

The next goal is a compatible, retained-per-candidate trial collection, not a second source of mutable UI settings or a direct reuse of ASS-rendered Guided evidence.

## Proposed read-only API

`createManualTranscodeComparison({trials,budget,incumbentId,hysteresisSsim})` requires two or more individual candidate trial sets. Each candidate includes:

- **protocol**: exact same source token, runtime/build token, decoded reference identity, no-filter/processing identity, source video stream, source interval, actual reference dimensions, SSIM contract `source-sdr-yuv420p-ssim-v1`, exact-source native CQ trial method `windows-native-exact-cq-v1`, paired requested windows and sample-plan version;
- **candidate**: id, codec, exact encoder/preset, output dimensions equal to the common reference, `yuv420p` pixel format;
- **points**: at least two distinct measured mean video bitrates. Each rate point contains every corresponding paired window's actual time position/duration, per-window SSIM and rate; the overall quality/rate summary must agree with those window measurements.
- **budget**: actual planned output duration, explicit nonnegative audio bitrate (measured, estimated or no-audio) and reserve percentage. *An unknown copied audio size must not silently become zero bytes*.

The module uses existing `fitRateDistortionModel` and `createMultiBranchFrontier`, intersecting measured byte-budget domains, comparing conservative sampled quality and honoring incumbent hysteresis. It never interpolates through uncovered budget gaps.

Result has `sessionOnly=true` and `adoptionRequiresNativeVbrVerification=true`. The manual application will need a **separate native bitrate-mode sample check** before applying a selected VBR rate; CQ-derived SSIM is not transferable to VBR by fiat.

## Non-goals and known limitations

**Not implemented in this stage:**
- no manual UI multibranch button or candidate history;
- no native codec-switch trial scheduler, no complete Cartesian-product optimization;
- no automatic switch of codec/preset in the formal task;
- no HDR/VFR and multi-resolution shared-reference comparison;
- no stable cryptographic source verification: the caller-provided `sourceToken` and `referenceToken` are explicit assertions, not identity proofs;
- no playback, full-length encoding, quality or final-byte-size guarantee.

The source token should become a strong scoped resource identity. A future runtime trial API must guarantee that candidate trials are actually produced with the declared exact reference pipeline and paired windows; a pure JS validator cannot infer whether a buggy or malicious back end misstated them.

## Safe integration gate

1. Audit the existing manual panel and Windows Native exact sample API for source id, decoder reference, selected trim, preset and capabilities; define **one authoritative trial/protocol builder** (do not ask UI code to guess identities).
2. Establish a per-branch, session-only immutable evidence registry keyed by protocol plus codec/encoder/preset. Changing the active encoder must not invalidate *other* branches that are demonstrably still compatible, and changing source, runtime, filter/time policy must invalidate all affected evidence.
3. Perform paired same-sample-window CQ trials under explicit cost limits; failed/partial trial must not yield an invented complete branch.
4. Build a read-only candidate inspector/upper-envelope in the existing one-chart manual pane, without changing selection and without mixing actual source SSIM with ASS-bearing references.
5. Only after candidate evidence is complete, explicitly adopt a new task configuration, then independently verify requested native VBR and exact formal output. Preserve the one-branch quick workflow as fallback.

## Regression oracle

`src/manual-transcode-comparison.test.mjs` verifies: compatible pair, single bounded envelope, duplicate branch refusal, missing/misordered samples, unequal windows/reference/run-time/source, invalid source/color protocol, injected non-number SSIM, invalid summary-vs-window statistics, invalid output duration, unknown copied audio budget, no shared bitrate domain, and representative boundary coordinates.

These are **synthetic Node tests of the pure model**, not FFmpeg or real GPU trial acceptance. Frontend CI is wired to run them. Acceptance requires *exact-head CI evidence*, then actual paired native source captures and final encoded verification.

## Separation from other QHE tasks

Video Stream Copy cutting doesn't have an encoder-rate-distortion decision; it needs proof of preserved packets, realized seek boundary, PTS/DTS, audio synchrony and output integrity. Guided ASS can share the abstract model, not its reference/evidence observations. No QHE task-v4 or clip queue semantics are changed here.


## Windows Native sample receipt: first ingress bridge (draft PR #104 follow-up)

The actual `windows/native-bridge.ps1::Invoke-Sample` now attaches `nativeEvidence` to an exact, filter-free, source-backed SSIM result. It includes:
- `schemaVersion=1`, `method` (`windows-native-exact-cq-v1` for quality samples, separate `windows-native-exact-vbr-v1` for bitrate samples), reference/filter versions, video ordinal 0 and `yuv420p`;
- actual selected encoder/preset, multipass, requested quality or bitrate, requested sample start/duration and measured encoded duration;
- `sourceToken` and `runtimeToken` produced **inside the Windows Bridge** from the full path, file length and LastWriteTimeUtc of the selected source and FFmpeg executable; runtime token also incorporates FFmpeg's version line.

Snapshots are captured before and after the sample encode; if either changes, the receipt is refused rather than silently pooled into a comparison. This guards many accidental source/runtime switches but **is not a content SHA-256 of the media or FFmpeg binary**, despite using SHA-256 as a digest of file stat fields. Such tokens must never be displayed as content-integrity proof or used as long-lived durable identity.

`src/manual-transcode-comparison.js::admitManualNativeCqSample` is a deliberately fail-closed, **not yet wired to Manual UI** gateway that checks the native receipt against one proposed measurement protocol, selected encoder/preset, paired window, actual native measured byte count/duration/SSIM, and CQ mode (not VBR). Existing single-encoder Manual samples remain functional and ignore the new optional native receipt until actual cross-encoder scheduling is implemented. The bridge-side helper lives at `windows/manual-sample-evidence.ps1`; Windows CI exercises it with a real FFmpeg-generated input, deliberately mutates the file and requires rejection.

The full system is *still* not a secure end-to-end attestation: local bridge response is trusted, caller-supplied protocol tokens must be built from actual returned receipts, and a JS-only comparison cannot detect every altered byte/decoder-build change. There is no multi-codec native experiment in QHE's current Manual UI, no VBR recommendation handoff, and no physical-GPU acceptance.

Native regression entry: `scripts/check-manual-sample-evidence.ps1` in Windows local smoke, after FFmpeg installation. Frontend model tests verify admission rejects missing/stale/wrong-mode receipts. Field acceptance still requires paired real samples across codecs on a consistent runtime, source and reference chain.


## Session-only multi-encoder evidence registry (PR #104 incremental stage)

New `src/manual-transcode-session.js` defines an **independent read-only candidate-evidence authority** for prospective Manual multibranch sampling; it is NOT yet the live Manual pane state. A session binds exactly one frozen source/time-window/decoder-reference/runtime protocol and an explicit, bounded set of encoder/preset candidates.

`addSample` first verifies the actual Native CQ receipt through `admitManualNativeCqSample`, accounts for measured encode seconds, and places the per-window result under the exact candidate + CQ setting + requested time-window slot. A CQ point does **not** become a valid R–D observation until every required paired window is complete; duplicate windows, mismatched settings, native-origin drift, exceeded sample/quality/time budgets and missing reference data fail closed. Native provenance drift invalidates **the entire session**, including previously complete evidence, rather than allowing stale curves to persist.

`discardIncomplete` removes incomplete quality settings but deliberately preserves previous completed CQ points in the same source/parameter protocol. `invalidate` clears all completed and pending candidate observations. `compare` only uses branches with two or more **complete** CQ points; it reuses the existing `createManualTranscodeComparison` quality/size constraints and never uses pending measurements in a fitted curve. `snapshot` exposes count/status, not an editable second copy of the Manual task.

`runManualPairedSweep` offers an optional *bounded, serialized* Native-call orchestration shell: validates at least two unique candidates, distinct CQ settings, an explicit maximum request count, cooperative cancellation before and after each Native call, and nonpublication of partial results after a failure. Its cancellation does **not** forcibly terminate an in-flight FFmpeg process; it refuses the late result and stops before issuing subsequent calls. The measured cost budget currently tracks reported Native **encode seconds**, not full FFmpeg setup/SSIM/network/wall-clock time; this is a *soft* resource protection only.

CI:
- `src/manual-transcode-session.test.mjs` tests per-window integrity, cancellation, partial-response disposal, stale source invalidation, duplicate and missing sample guards, bounded sample/quality/cost quotas and invalid sweep plans.
- `scripts/verify-manual-native-paired.mjs` now routes all 12 **real** Windows CI x264/x265 CQ/SSIM receipts through the session authority before constructing the common-envelope model; it cross-checks against the previous direct paired-record model, protecting existing mathematical behavior.
- `.github/workflows/test-frontend.yml` runs the new Node regressions independently.

This is intentionally NOT yet a UI compare button, guaranteed adaptive multi-encoder search, codec × resolution optimizer, automatic encoder switch, playback/size guarantee or Native task-v4 change. Safe next gate: bind session creation to one authoritative Manual source and runtime fingerprint, provide an explicit bounded candidate planner with correct task preflight/cancellation/timeout controls, then visually disclose measured candidate alternatives without replacing the existing one-branch quick curve.


## Optional Manual UI comparison prototype (PR #104 continuation, pending release decision)

`src/manual-transcode-compare-ui.js` is mounted **inside** the existing `src/transcode-calibration-panel.js` Manual pure-video-transcode workspace. It does not replace or duplicate the existing single-encoder calibration and formal VBR confirmation controls. It has a user-invoked `比较两个编码器` action, a cooperative stop, a same-budget candidate text inspector (works without SVG hover) and an explicit `返回单编码器曲线` action. Both modes **reuse the one `#taskEfficiencyChart` SVG**. The multi-codec result remains a **read-only upper-envelope with candidate inspector**, not multiple independent interactive charts or an automatic codec switch. PR #103 independently proposes subtle candidate ghost lines; this work must not claim they have been merged into Manual.

Initial supported comparison is intentionally narrow: Windows Native; primary v:0 SDR 8-bit `yuv420p`; original video dimensions and frame cadence; no crop, rotation, denoise, scaling, HDR or advanced encoder overrides; candidates `libx264` and `libx265` with `medium` preset; identical two nonoverlapping two-second windows selected by existing `calibrationSampleStarts`; CRF 18, 28 and 40, 12 requested real samples total. Each alternative undergoes `compileTask` and Native capability validation before any costly matched sampling. The first **real Native Bridge** CQ receipt supplies the authoritative source/runtime/reference protocol; it is replayed into the normal 12-slot `runManualPairedSweep` without encoding that slot twice. All results pass session admission and incomplete-sample guards.

This first interface reports **video-only size projection**: unknown copied audio, font attachments and true mux overhead are **not** included; it does not pass a fictitious zero audio-copy byte count as a whole-file guarantee. The native timeout applies to an individual encode step; reported encoding-time budget excludes decode, SSIM, data transfer and OS process handling. Stop/cancel refuses late samples but does not promise to kill an already running FFmpeg process. The measured recommendation **never invokes `hooks.applyQuality` or `hooks.applyBitrate`**, cannot change the task's codec/preset or use CQ predictions as a VBR quality pass.

The existing single-encoder mode and its formal native VBR verification remain the only route for applying a bitrate. Before using a suggested different encoder, the owner will need a separate explicit plan switch and **new same-configuration VBR verification**, guarded by task-source changes. The UI comparison is a **draft proof**, not complete future multi-codec finalization.

New browser regression in `scripts/check-curve-design.cjs` mounts the actual Manual panel in Chromium, with **synthetic Native transport replies** for controlled UI behavior. It checks one shared SVG, per-budget candidate rows, keyboard movement, absence of implicit adoption, and desktop/390-px overflow. This test must be distinguished from the separate Windows workflow's **actual FFmpeg x264/x265** paired-encode/SSIM acceptance.

**Release gates remain:** exact-head frontend CI (including browser check), Windows Native actual two-codec CI, screenshots independently visually reviewed, real Windows user video and incomplete cancellation, physical GPU and AV1/long-form HDR policy, formal VBR target-size handoff. PR #104 stays draft/unmerged; no Canonical changes.


## Distinct Windows Native VBR confirmation stage (PR #104 follow-up)

The optional Manual two-codec comparison now exposes a deliberately **non-adopting** `实测验证当前推荐编码器的 VBR` action. At the currently selected **video-only budget**, it identifies the fitted winner and its projected video bitrate, validates the corresponding compiled bitrate-mode task and Windows encoder support, then requests **real Native bitrate-mode, source-SSIM** samples over the same reference windows as the CQ comparison. `src/manual-transcode-vbr-verification.js` requires `windows-native-exact-vbr-v1` receipts, exact encoder/preset/disabled multipass, same source/runtime/filter/reference tokens, rate and requested timing, complete unique paired windows and finite actual SSIM/video bytes. A CQ receipt or one shifted, missing or stale VBR window must not pass. The minimum measured window SSIM is compared with the **current user target**; a failed threshold does not grant a pass.

Pass feedback is intentionally phrased *“VBR 短样已验证”*, explicitly notes that the formal encoding configuration **has not changed**, and is invalidated by source/task changes, an updated quality threshold or budget cursor motion. On native identity drift the CQ comparison is also invalidated. The button does not call `hooks.applyBitrate`, `hooks.applyQuality`, or a codec mutation API. It is a validation stage, **not** a verified final-file output/adoption UI.

Node tests at `src/manual-transcode-vbr-verification.test.mjs` simulate good/bad/missing/mislabeled bitrate-mode receipts and enforce no automatic adoption. Chromium UI regression exercises the real compare pane and VBR action but supplies **mocked Native transport** responses for UI behavior. The independent Windows hosted real codec integration was extended to run **two additional actual bitrate-mode samples** on the generated FFV1 source and pass their Native receipts through the same VBR verification module, separate from its 12 real CQ samples. Exact-head CI must be evaluated before claiming that end-to-end codec-paired confirmation succeeded.

Next release gate: define an explicit atomic `codec+encoder+preset+rateMode+bitrate` task handoff that invalidates incompatible CQ evidence, requires a still-current passed VBR short-sample certificate, and is independently compiled and revalidated. Do not silently copy the curve into a formal plan, or claim physical GPU/AV1/long-form/final-byte-size acceptance.


## Explicit atomic formal-task handoff (2026-10-13 draft implementation)

After CQ evidence produces one same-budget recommendation and **that same candidate/bitrate** passes independent Windows Native VBR short-window verification, the UI presents a separate user-clicked `确认写入已验证的编码方案` action. A certificate is tied to candidate id, selected video-only bytes, requested bitrate, current target SSIM, source/reference identity and the entire pre-adoption form snapshot. Changing budget, SSIM target, source or any relevant settings disables this action; failed/missing certificates never reveal an enabled commit.

Before a commit, `src/manual-transcode-compare-ui.js` recompiles the proposed complete bitrate-mode transcode task, calls the authoritative native encoder capability check, and requires the source, budget, target and form still match **after** the await. The parent `src/media-workspace.js` owns the **only mutable form** and delegates to `src/manual-transcode-adoption.js::commitVerifiedManualCandidate`, which snapshots all affected fields, synchronously sets codec+encoder+preset+multipass+rateMode+bitrate+twoPass together, rebuilds dependent select options, verifies the resulting read-back, and compiles the complete formal task. A rejection rolls the old form fields back and produces no partial settings-change event. On success, it dispatches **one** form input event only after the whole set is complete so the existing media-task invalidation and stale-output protections run against one coherent state. The old candidate comparison session is discarded.

This explicitly writes **settings only**, not an encoded video. The checked VBR windows do not prove future output bytes, playback, packet continuity, quality over the rest of a film, copied audio delivery or full device compatibility. The ordinary formal encoding/run/save and independent artifact verification are still required.

Tests: `src/manual-transcode-adoption.test.mjs` asserts transaction/rollback under failed compile, stale source/settings, rejected candidate/bitrate and unavailable codec controls. Chromium comparison UI test keeps two stages distinct: prior to explicit confirm no settings callback is invoked; after a fresh valid VBR certificate, explicit confirm invokes the adoption hook once and the pair mode exits. Cursor motion hides the action and revokes the pass. These tests must pass **at exact PR head**; they are not a physical Windows user-run demonstration.


## 2026-10-13 real formal v4 whole-file artifact acceptance (Windows hosted)

**New evidence tier, different from all prior short-window comparisons:** `scripts/check-manual-native-paired.ps1` now makes a five-second Windows-hosted FFV1 `320x180, 12fps` + **FLAC** Matroska input, executes 12 real x264/x265 CQ samples, executes two real **x265** bitrate-mode source-SSIM samples at 600000bps, and has `scripts/build-manual-adopted-native-request.mjs` check both VBR receipts and actually run `commitVerifiedManualCandidate` + the production `compileTask`. It creates a full **task-v4 bitrate-mode HEVC/libx265 with copied audio** JSON request, POSTs it to the actual `/api/encode` production job path, waits for a terminal `completed` status and then independently inspects the private Matroska output artifact with `scripts/verify-manual-adopted-native-output.mjs`.

This is **not** a second sample encoding nor a separate handwritten FFmpeg command pretending to be a QHE job. The output is created by `windows/native-bridge.ps1::Start-MediaTaskJob`, which consumes the real compiler's `task.outputArgs`. The independent verifier uses FFprobe to prove HEVC output codec and frame dimensions, exact copied FLAC audio packet payload SHA-256 across all packets in order, input/output decoded frame count, source/output duration, actual file byte count equal to the job response and FFprobe container size, and a separate **full-timeline source-referenced SSIM** decoded by FFmpeg. Whole-file size is **observed**, not promised by target bitrate, and the test does not infer physical user device or player playback compatibility.

Actual first successful end-to-end Windows run `38284134399` at head `891620f8027959f7ffdc671b710c0d2c57340211` reported:
- output codec HEVC / `libx265`, input FFV1, output Matroska
- 60 source/output video frames, 5.0 s source/output
- 235/235 FLAC packet hashes matched SHA-256
- requested video bitrate 600000 bps; video-only nominal projection 375000 bytes for 5 seconds, **not whole-file target**
- actual entire Matroska output 358516 bytes, as reported independently by the file, FFprobe and Native status
- independently measured *full 5-second* decoded video SSIM `0.999738` against the FFV1 source; this is only a CI-synthetic clip and not a real-movie quality guarantee.

**CI transport defect and fix:** The first full-job request was rejected at `/api/encode` JSON decoding, **before encoding**, because the compiled task included non-ASCII compatibility warnings and the Windows PowerShell client passed a string request body. The Bridge explicitly reads/decode UTF-8 request bytes; the CI caller now sends `[Text.Encoding]::UTF8.GetBytes($requestJson)` with `application/json; charset=utf-8`. The second run successfully reached production Native job completion. Do not mislabel the initial red job as an HEVC encoder failure. Keep this as a transport case and track any applicable production caller separately.

The dedicated Windows CI workflow now also archives the **synthetic** FFV1+FLAC source, actual HEVC+FLAC output and machine-readable independent verification JSON for short-term replay; only generated test artifacts, never users' own videos. Retention is 14 days.

### Boundaries still requiring work
- Real user-selected video Windows field E2E, physical GPU/NVENC/AV1, high bit depth, HDR and variable-frame-rate material;
- complex multitrack audio, subtitle/attachment/container interoperability and player compatibility;
- longer real-world sequences and more diverse representative quality scenes;
- bitrate and strict whole-container size/error-budget modeling with copied audio accounted for; no strict ceiling claim from these 358516 bytes;
- downstream saved/exported user artifact and visual GUI field-device confirmation.

Owner review, draft PR status and Canonical governance remain unchanged. The full-file evidence is CI-synthetic, albeit **truly executed through the formal Native task backend**.


## 2026-10-13 formal task full-range AAC priming fix + rich MKV output acceptance

This is a **new regression boundary** beyond the previous 5-second one-audio synthetic FFV1+FLAC formal artifact. The same actual Manual candidate adoption → formal task v4 → Windows Native `/api/encode` now consumes a **self-generated 5-second Matroska fixture** with FFV1 primary video, FLAC (jpn) and AAC (eng) audio, embedded ASS (jpn), one valid **self-generated** 1000-byte TrueType font attachment `QHE-Synthetic-CI.ttf` (no proprietary Windows font), two chapters and container metadata. New generator `scripts/build-manual-rich-native-fixture.mjs` uses no download or external font-generation dependency. The existing independent artifact checker now checks each copied audio/subtitle packet SHA-256 sequence, actual ASS codec-private hash, TTF attachment extradata hash/filename/MIME, language identity, chapter titles/times, container title, video format/frame count/full-reference SSIM, whole container byte count, **full decoded audio PCM identity**, and an observed byte breakdown.

**A real previously-undetected loss was found by first Windows CI run**: FFmpeg 9.0.2 Windows Bridge dropped the **first AAC packet** only in the formal output, leaving 235 of 236 encoded AAC packets. The source first AAC packet had PTS/DTS `-0.021s` with `Skip Samples: 1024`; first output packet was the source's second packet at PTS 0, with skip_samples now attached there. Independent downloaded input/output decoding observed the output AAC PCM was **1024 samples shorter**. This is not merely a harmless container hash difference. By contrast local Linux FFmpeg 7.1.5 output kept the AAC pre-roll packet despite the same original task. Version-specific handling matters.

Root: the shared `src/media-task.js` compiler unconditionally prepended output-side `-ss 0` to *all* task `outputArgs`, even when `hasTrimRange=false`. Output seeking at zero can discard legitimate negative-PTS codec priming packets while retaining the rest of an audio stream. The fix emits `-ss 0` **only for actual trimmed-range tasks**, not for untrimmed/full-range transcode or Stream Copy. This protects source packet integrity without weakening the verifier or changing the actual trim path. A new `src/media-task.test.mjs` case specifically asserts the distinction. Because this is shared task compilation, frontend, Windows Native, Stream Plan v4, Android emulator and other affected test workflows must still pass independently.

**First actual Windows green rich-MKV run** `38286715465` at QHE head `45f5538f714dcd952f03324bffa2e4bf325f73cc`, after this source-level fix:
- 60/60 video frames, FFV1 → HEVC, full decoded source-vs-output SSIM `0.999738` on the synthetic test;
- FLAC **235/235 packets** identical in order by SHA-256;
- AAC **236/236 packets**, including the previously lost pre-roll, identical in order by SHA-256;
- embedded ASS **2/2 packets** and ASS codec-private SHA-256 equal;
- font attachment actual TTF binary SHA-256 equal, same filename/MIME;
- two chapters, language tags jpn/eng, Matroska title preserved;
- observed full MKV **422802 bytes**, of which video packet payloads **268272 B**, copied audio+subtitle packet payloads **145440 B**, residual font/metadata/mux overhead **9090 B**. These are **observed output accounting**, not a strict size guarantee or predicted allocation.
- It publishes CI-generated actual source, output and `full-output-acceptance.json` in workflow artifact `11763342739` (14-day retention). The actual downloaded files were independently re-probed and their copy-stream hashes verified in the conversation. Both source and output full AAC and FLAC decoded PCM SHA-256 were also independently compared and found identical.

A subsequent amendment added those decoded PCM comparisons directly to `scripts/verify-manual-adopted-native-output.mjs`; check its new exact-head CI before claiming that particular automated assertion has passed. All evidence remains Windows hosted with an **artificial**, intentionally small two-tone fixture; this does not verify libass visual fidelity, subtitle rendering on external players, arbitrary real-world content, physical hardware, strict target size, real-user save/export or cross-device compatibility. A font attachment can be structurally preserved even when no particular player has been proven to render its glyphs.

See distinct Foundry Bug/Test (Intake) for the AAC pre-roll loss; do not automatically change Canonical or merge the Draft PR from one hosted fixture.
