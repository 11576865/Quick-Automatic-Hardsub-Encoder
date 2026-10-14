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
