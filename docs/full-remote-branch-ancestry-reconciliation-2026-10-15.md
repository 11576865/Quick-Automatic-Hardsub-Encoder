# QHE full remote-branch ancestry convergence receipt — 2026-10-15

## Purpose and exact meaning

Owner authorized reconciliation of **all 51 non-`main` remote branch HEADs** after QHE's product PR convergence. Base `main` is `e3ba785d72784497cce24b9154f8d2cd0124466c`. This integration **preserves the latest main worktree/tree**, incorporates the 51 exact historical branch HEADs **as Git merge ancestry only** through an ordered series of multi-parent `ours-style` merge commits, and adds only this receipt file.

**CRITICAL:** `ours-style` is not a replay of stale branch files or a certification of their contents. The presence of a branch SHA in the resulting Git ancestry means its **history** is incorporated, not that every obsolete change is adopted as current product behavior. Previously merged product capabilities stay as implemented by their actual PRs; replaced variations remain superseded. There is **no change to app source, UI, Native bridge, test code, task compiler, build configurations, or user data**. The two non-product refs `uigs-outbox` (packets/evidence transport) and `feat/qhe-theory-v1-10round-20261015` (non-authoritative design checkpoint) contribute historical ancestry **only**, with **none of their source/packets/spec files copied to `main`**. Those refs remain independently usable and are not deleted.

This is historical **branch reconciliation**, not complete R19/R24/B01–B25/A01–A10 product acceptance. Any later active edits to individual remote branches would need separate integration. Branch deletion is NOT performed.

## Exact source snapshot

- Base main SHA: `e3ba785d72784497cce24b9154f8d2cd0124466c`
- Remote branch refs: 52, including `main`
- Non-main heads: 51, all unique
- 42 heads associated with successfully merged product PRs; one merged PR branch `ui/decision-first-media-plan` has extra commits past its PR merge and its source-video-independent probe/UI/test markers have been independently verified present on main; likewise the Android-font fix extra head has no additional file-level patch relative to its merged PR head.
- 7 obsolete unmerged PR branches: Bink variants #44/#52/#53/#54/#59 superseded by merged #60; state stabilization #35 superseded by merged #41; Android emulator acceptance #58 superseded by merged #61.
- 2 non-product refs: isolated `uigs-outbox` and non-authoritative theory-v1 checkpoint. Neither's files should be copied to main.
- Just before this operation, 0 open PR; last product convergence PR #110 merged at base `e3ba785d72784497cce24b9154f8d2cd0124466c`; main push Windows smoke and Android build/deploy were successful.
- Integration mechanism: 7 sequential multi-parent commits, first-parent chain from original `main`, up to 8 historical branch SHA parents per commit. GitHub PR merge into `main` keeps the final ancestry without losing the current tree.

## Branch HEAD accounting

| Branch | Pinned remote HEAD | Classification | Historical PR | Superseded by |
|---|---|---|---|---|
| `audit/qhe-initial-v1-post-convergence-20261015` | `7aac123f6718cff741c39473a4765114211e0e61` | previously-merged-product-PR | #108 | — |
| `design/unified-favicon` | `cdbed2d030cd77443d4b8263c3282623b9debe99` | previously-merged-product-PR | #5 | — |
| `feat/budgeted-paired-refinement` | `d2ad8c0acfe4018fff01bcbcc1524bb6122394a9` | previously-merged-product-PR | #79 | — |
| `feat/codec-aware-audio-playback-guidance` | `8427aa8563056130e950fd964e509e0427ef292b` | previously-merged-product-PR | #39 | — |
| `feat/common-reference-multires-calibration` | `ddae02b868efaa920390c41c5919d96ed71a562f` | previously-merged-product-PR | #75 | — |
| `feat/compression-decision-next-stage` | `28c0e64bd789dbca53057de06c707acfeafb26db` | previously-merged-product-PR | #74 | — |
| `feat/fullscreen-frame-compare` | `49d6ff973b9f57f2fbce705dbddd64e27bbd1689` | previously-merged-product-PR | #45 | — |
| `feat/guided-budget-policy-verified-output` | `291c8de4ec23544e73e7f1534f82e57b357216b3` | previously-merged-product-PR | #86 | — |
| `feat/hardsub-output-reference-verification` | `179254e19dee731a200a39d7966bab310d566184` | previously-merged-product-PR | #50 | — |
| `feat/output-quality-verification` | `4764fe86e5c6c02a6e04f3768df4485a0ee3a478` | previously-merged-product-PR | #48 | — |
| `feat/output-verification-zoom-pan` | `eebc047d820616b3f00fb8ee40314c8e58a735d5` | previously-merged-product-PR | #63 | — |
| `feat/qhe-theory-v1-10round-20261015` | `05150371daa5959539de02b594d2a0db5e3eadd4` | non-authoritative-design-checkpoint | — | — |
| `feat/qhe-wu11-guided-manual-native-source-contract-20261015` | `081403465314e9a13ccc11cf7c73ee265782419b` | previously-merged-product-PR | #109 | — |
| `feat/scene-stratified-calibration` | `96cdd1add409756d9622d112722ac27ddf937072` | previously-merged-product-PR | #78 | — |
| `feat/size-frontier-slider-v1` | `2fdfcc8c68ffe730d180f1f98fb5ab540049d225` | previously-merged-product-PR | #51 | — |
| `feat/stream-plan-v4` | `04c46e0aab77be9dac954024bafc19f352e5c0f4` | previously-merged-product-PR | #55 | — |
| `feat/waveform-timecode-input` | `6558584caad56fb924ebfccd99e516a6d1417f53` | previously-merged-product-PR | #34 | — |
| `feat/windows-bink2-import-adapter` | `b8a666feab60cdfe81c22013f586c366320fa56d` | historical-PR-superseded | #44 | #60 |
| `feat/windows-bink2-import-adapter-rebase` | `5fa726c2f0dbf50822974ec898f0f26e8e871a01` | historical-PR-superseded | #54 | #60 |
| `feat/windows-bink2-import-adapter-v2` | `433a9c6063663d0853ce4fd5da63e6230c07e05c` | historical-PR-superseded | #53 | #60 |
| `feat/windows-bink2-import-adapter-v3` | `c8ccc075138bc7f62aa4699a3cfc673c29314068` | historical-PR-superseded | #59 | #60 |
| `feature/windows-native-web-bridge` | `a5b448ebe2741ea0b07b810cf5acdf6f98b00a9d` | previously-merged-product-PR | #9 | — |
| `fix/android-stream-plan-v4-artifact-handoff` | `c6180c34d3f7b61db252cf8aff042905ecf1a74b` | previously-merged-product-PR | #64 | — |
| `fix/audio-copy-playback-warning` | `9c30d9db00bcafccf2a56a493cb4a18802d6f5a3` | previously-merged-product-PR | #38 | — |
| `fix/qhe-copy-queue-phone-near-trim-input-20261012` | `942ac1660472fc7f2a2d1971af9fa97a1883289b` | previously-merged-product-PR | #102 | — |
| `fix/scene-noise-risk-and-codec-evidence` | `fa3b156897d4b7bdae19e21ac85b4930fe8d9b48` | previously-merged-product-PR | #82 | — |
| `fix/single-measured-compression-curve` | `a98d291ad53e12e9dad557595214bead555d17b7` | previously-merged-product-PR | #73 | — |
| `fix/strict-budget-export-reverification` | `4499256221cf0c2bae45b1280158e5e0154cc24f` | previously-merged-product-PR | #87 | — |
| `fix/timeline-without-audio` | `0190306e318df5fe930caa731ad7787f6912d6b3` | previously-merged-product-PR | #46 | — |
| `fix/windows-ass-nvenc-diagnostics` | `0505b1d2fbf9ea599889a9c3d2820aa4e0871796` | previously-merged-product-PR | #8 | — |
| `fix/windows-bink2-adapter-current-main` | `83520963ace541fe1778d690f2a7a140c26beea3` | historical-PR-superseded | #52 | #60 |
| `fix/windows-native-tool-return` | `c42d2f68c1fbece56aa11da8338df4d34d2d42b8` | previously-merged-product-PR | #28 | — |
| `fix/windows-native-ui-density` | `77046eb2974521394e5b5c6320485ee94961c43b` | previously-merged-product-PR | #10 | — |
| `fix/windows-repeat-export-dialog-20261003` | `98b09c7705a43aaf914655637e2405811fd4f35a` | previously-merged-product-PR | #37 | — |
| `fix-android-font-selection-8263644890046895656` | `05f208e7d01075fddcac39f81281122cb3941932` | previously-merged-product-PR | #1 | — |
| `refactor/release-backed-build-assets` | `703cb5d46fca01f2d7c4bbaf4a8fbcb434b30c76` | previously-merged-product-PR | #16 | — |
| `stabilize/state-matrix-pass1` | `2962e58daa5df540e027610780244fefadab1d53` | historical-PR-superseded | #35 | #41 |
| `test/android-stream-plan-v4-emulator-acceptance` | `9a74e61e1afaad87c990e508eb2d0cb84dd13727` | historical-PR-superseded | #58 | #61 |
| `test/guided-size-vbr-full-output-contract` | `778868bc9a26398686612f6917483e61d5ea5c1b` | previously-merged-product-PR | #84 | — |
| `test/qhe-wu11-real-vbr-explicit-adoption-20261015` | `d6dbd7ce0add4de30e2db0477fd466d3c16ac072` | previously-merged-product-PR | #110 | — |
| `test/real-codec-frontier-risk-reversal` | `67100bd93a85f8ba1831100ce22c162dac169ffd` | previously-merged-product-PR | #83 | — |
| `test/real-ffmpeg-scene-risk-matrix` | `a12d3ed52dfb42bd7451a37f7c6e97b0704b9dd4` | previously-merged-product-PR | #81 | — |
| `test/real-ffmpeg-scene-risk-regimes` | `d16e17084a35d6afa418f5e8828440979bacaa32` | previously-merged-product-PR | #80 | — |
| `test/stream-plan-v4-device-acceptance` | `24b391ddf2079498dd91fa5ed945bb5988ab9765` | previously-merged-product-PR | #56 | — |
| `test/windows-stream-plan-v4-runtime-acceptance` | `a4bc60263e1eb2c030d32ae37e9fb7cbd0a63fae` | previously-merged-product-PR | #57 | — |
| `ui/decision-first-media-plan` | `1ecc4c5f46d412c5982b70d76ff749314ced6e57` | previously-merged-product-PR | #31 | — |
| `ui/modern-encoder-workbench` | `9284d98795887c32940cd20a14fd72bb73e1015f` | previously-merged-product-PR | #3 | — |
| `ui/semantic-colors-adaptive-themes` | `8bcb5797e7ac1410478ba1b08dfae226cbfa120b` | previously-merged-product-PR | #4 | — |
| `ui/windows-native-entry` | `67b7ef022877aef74461bb091e7a6620bf7dc24d` | previously-merged-product-PR | #7 | — |
| `uigs-outbox` | `8ea7b86ec1a1c5f2d3218c063f68a1f19fd06b8f` | isolated-evidence-transport | — | — |
| `windows/native-nvenc-backend` | `7393e530bc5674d0f96987d5d8c710efa6e1d6d3` | previously-merged-product-PR | #6 | — |

## Acceptance gates and exact scope

1. The final integration PR must show **only this document file** as a delta from the original `main`; reject any accidental code, `packets/`, UI, or binary changes.
2. Each of the 51 source SHAs must occur as a direct additional parent of one of the ancestry commits, with the first-parent chain anchored at the exact base main SHA. GitHub `compare branch..main` must report each historical HEAD is contained after final merge (ancestry reachability).
3. No force pushes, source branch deletion, or overwrite of working implementations. Mainline CI validation may be paths-skipped on doc-only merges; skipped is not a pass. The last product main SHA already passed its Windows and Android push checks.
4. R19/R24 V1 acceptance and WU11 task continue under #107. This history operation changes no V1 requirement status.

## Sources

- Current source-of-truth branch refs and historical merged/superseded PR API metadata were fetched immediately before construction.
- Product handoff: #106, #107 and merged #102/#103/#104/#105/#108/#109/#110.
