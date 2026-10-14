# QHE five-round delivery

The user requests immediate implementation of most of the researched QHE product,
including H.266/VVC and UI, within five conversational work units. Existing ASS,
transcode and copy workflows remain independent, sharing the current task compiler.
This branch starts at PR #104 head `0feed738042745ace6c031f726a3ad93561e56e8`;
it does not merge either proposal or deploy main.

## Observable deliverables

1. Windows H.266/VVC: real `libvvenc` quality (QP) and bitrate task compilation,
   an encode/container/decode runtime gate, UI capability status, constrained presets,
   explicit 10-bit encoder input, and refusal of unsupported combinations.
2. Per-stream output: source track inspection, independent audio copy/AAC/Opus/FLAC/drop,
   selected subtitle/attachment preservation, a shared traceable output plan.
3. Whole-file budgeting: known copied payload and attachments, explicit unknown costs,
   video remainder, completed artifact byte gate and bounded recovery choices.
4. Task-centered UI: source/plan/artifact views, shared parameter ownership, compact
   desktop/tablet layout, focused mobile flow and truthful evidence states.
5. Integration: preserve current single-chart decisions, independent output acceptance,
   failure/cancel/save regressions, browser evidence and a resumable delivery record.

Majority is assessed against this list, with implementation and runtime validation
tracked separately. Physical devices, arbitrary media and universal playback are not
silently counted as passed. Research proposals are interpreted as implementation
direction, not as a reason to demand another approval round: the user explicitly
instructed immediate execution.

## Round 1 boundary

Add an experimental, manually selected Windows-only VVC path using FFmpeg's existing
libvvenc adapter. Quality mode uses integer `-qp 0..63`, presets faster/fast/medium/
slow/slower, `yuv420p10le`, MKV. Input HDR/high-bit-depth remains blocked. Old FFmpeg
builds must remain usable for existing codecs. VVC is enabled only after a tiny real
MKV encode, FFprobe identification and full FFmpeg decode. No automatic download,
cross-codec recommendation or device compatibility claim.

Unsupported VVC advanced options are rejected, never quietly applied as x264 flags.
The current rate-distortion calibration stays limited to its validated codecs;
manual short trials use compiled formal tasks and remain available for VVC.

## Verification

Node compiler/capability tests, existing frontend suite and Vite build; Chromium
tests cover unavailable/available Windows VVC and desktop/mobile bounds. Windows CI
executes argument validation, rejection paths and actual libvvenc acceptance when
present, reporting UNSUPPORTED otherwise. Required physical Windows evidence remains
Pending until actually run.
