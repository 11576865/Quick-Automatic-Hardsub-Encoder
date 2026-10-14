# QHE WU-02 · Windows Native MKV embedded ASS / font source import

Authority: B05/B06/B07/B24; A01–A03. Date: 2026-10-14. Status: IMPLEMENTED IN DRAFT; HOSTED WINDOWS EVIDENCE PENDING.

## Product functionality

- The Windows Native input probe exposes embedded subtitle streams. The input shelf now displays a selector for **ASS** streams (not arbitrary subtitles) and an explicit action to import the chosen ASS plus embedded font attachments.
- The localhost Native Bridge extracts the selected ASS via the real FFmpeg ASS muxer and all recognized ttf/otf/ttc/otc attachments using ordinal-based `-dump_attachment:t:N` to generated safe filenames; no attacker-controlled attachment filename becomes a filesystem path.
- The extracted files are handed into the **existing** source analysis, font diagnostics, Guided and Manual preview/encoding pipeline. No second encoding engine or automatic stream choice.
- Extraction is bounded by a hard 8 MB ASS limit, 24 fonts, 16 MB per font and 32 MB total attachment limit; all required discovered font attachments must succeed or the operation fails. The private source stamp binds the staged font set to the original file length and modification ticks. Input replacement clears the source-owned staging.
- A chosen source, subtitle ordinal or font import does not grant a compression VBR quality certificate or final playback acceptance.

## Evidence boundary

Import functionality is newly added but **not yet declared PASS**. Exact-head Windows Native hosted smoke must prove real subtitle/font bytes, source-mutation rejection and an actual libass burned output. Browser-only UI wiring is not proof of a Windows installation or native encoding. Complex subtitles and playback remain open.

## Windows Hosted PASS — 2026-10-14

Source code exact verified SHA: `1148bcda33bc74f66275eaad73d125e29930b8fb`.
CI: https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38554433547 — SUCCESS.

Actual Windows localhost Native Bridge + FFmpeg 9.0.2 generated a 5.021 s synthetic rich MKV comprising FFV1 video, two audio tracks (FLAC / AAC), an embedded ASS stream and a generated valid TTF attachment. The explicit ASS importer rejected a wrong track ordinal and wrong source, extracted the ASS and the attachment bytes, and compiled a formal schema-v4 hard-sub job. The job executed with libx264 and libass, producing a 251,257-byte finished MKV. Independent acceptance asserted:

- Original FLAC stream: all **235 source and output packet payload SHA-256 hashes are identical and in order**.
- Second audio: actual AAC re-encoding, distinct source and output packet hashes.
- Original attached font: SHA-256 of imported bytes equals original generated TTF (`d086d10bf01dea2e44fb14bf8b152b911b280a93bbd411da2965341ff3f67a90`).
- Final output video H.264 with two audio tracks, **zero residual soft-subtitle/attachment streams**, and successful full decode.
- Comparing the actual output against a separately encoded, otherwise equivalent no-dialogue ASS output produced a **different decoded frame** during the subtitle event.
- Mutating the source after extraction prevented reuse of source-bound staged subtitle/font assets.

Earlier run 38554057407 passed bridge extraction, formal Native encode and stream checks but failed solely when the independent verifier built a Windows absolute filename inside the FFmpeg ASS filter expression. That verifier was corrected to use relative names in a private working directory and this exact-head rerun passed. The failure did not establish a product encode defect.

**Boundary**: This is a bounded Windows hosted acceptance, not a user-film, installed-device, real browser button, unusual attachment/glyph, multi-platform or entire A01–A03 sign-off. The two authorised work units WU-01/WU-02 have now been attempted; root-goal re-anchoring is required before authorizing another work unit. No merge or release.
