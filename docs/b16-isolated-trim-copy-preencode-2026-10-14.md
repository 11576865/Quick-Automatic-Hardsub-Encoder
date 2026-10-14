# QHE B16 — bounded pre-encode isolated trim-copy observation

Date: 2026-10-14
Status: source code submitted in Draft PR #105; exact-head Windows/Node/Browser acceptance Pending
Requirement: B16 partial; does not close theoretical V1 B01–B25/A01–A10

## Why this exists

Current `src/media-planning.js::sizeBudget` correctly reserves **complete full-source stream packet bytes** for any trimmed copied-audio or soft-subtitle stream. That is a safe (usually overconservative) upper bound, not a precise prediction of the packets that FFmpeg will retain after seeking/remuxing. The existing `windows/trim-packet-audit.ps1` can independently count **completed output** packets after encoding, but is too late for an actual encoding-time preflight decision.

This work introduces a separate, source-owned **isolated copy remux observation before video encoding**. It uses the same FFmpeg executable with a requested absolute seek, trim duration, copy-mode auxiliary stream mappings and the requested output muxer. An independent FFprobe packet worker then measures the observed copied-audio and soft-subtitle packet bytes, with constant-memory streaming bounded by its existing packet/time cap.

## Implementation

- `windows/trim-copy-preflight.ps1`: bounded PowerShell 5.1 worker. Inputs: explicit JSON request, selected source, source-relative trim interval, selected audio/subtitle source ordinals and target Matroska/MP4 muxer. FFmpeg creates a **private isolated auxiliary-only remux**, not the final video. Existing `trim-packet-audit.ps1` independently probes its packet costs. Source stat size+ticks are checked after execution, worker receipts are atomic JSON and private intermediate media is deleted.
- `windows/trim-copy-preflight-bridge.ps1`: exposes **single-flight asynchronous Native Bridge** endpoints `POST /api/trim-copy-preflight` and `GET /api/trim-copy-preflight`. POST accepts only the **selected** Windows source, requires a current existing full-source measurement, checks source ownership and bounds, and launches the isolated PowerShell worker. GET immediately reports `running`, `ready` or `unavailable` and returns a receipt only when origin/source stat and measurement ID still match. Changing the selected file cancels the old preflight.
- `src/trim-copy-preflight.js`: validates receipt versus the exact selected trim range, stream ordinals, source stat (FILETIME ticks serialized as **strings** to avoid JavaScript numeric precision loss), output muxer and authoritative full-source packet ledger. Reports the isolated observed bytes and delta separately. It cannot grant a smaller formal full-source budget, a final file size certificate or actual mux output equivalence.
- `src/trim-copy-preflight.test.mjs`: eight pure behavior tests including forged/mismatched receipt and over-reserve observations, plus source wiring. Fast and full Node frontend jobs include this test.
- `scripts/check-trim-copy-preflight.ps1`: actual Windows FFmpeg synthetic two-audio + soft-subtitle MKV, actual remux worker, independent FFmpeg+FFprobe per-stream packet-byte oracle and duplicate-ordinal refusal; wired after FFmpeg setup in `.github/workflows/windows-local-smoke.yml`. Existing Windows Guided localhost test now starts/polls this Native endpoint against the currently selected source and measurement ID.

## Explicit trust and performance limits

- **Observation, not a budget substitution**: an isolated mux lacking video/other streams may choose packets differently from the actual mixed media task, especially around boundaries, timestamp rebasing, subtitle events, nonzero PTS, VFR, muxer behavior and A/V interleaving. The receipt always declares `observationOnly:true`, `canReplaceFullSourceBudget:false`.
- Source identity is selected-file path, byte length, FILETIME modification ticks and current Native measurement ID. This is **not a cryptographic content hash** and is not tamper-proof if bytes change but stat remains identical.
- The worker accepts at most 32 selected auxiliary streams, at most 1-hour clip per preflight, 75-second isolated FFmpeg process, bounded independent FFprobe pass and one active job per Native Bridge. An unavailable result does not block the existing conservative budget path.
- The Native API is ready for later UI presentation, but this commit does **not** yet add a dedicated workbench button or change `sizeBudget`. It cannot claim the complete theoretical B16 solution until exact final mixed-task stream selection can be verified before video encoding.
- FLAC re-encode size is still **unknown**, not silently estimated. Android/Web transport and real large/VFR/subtitle-heavy material are still Pending.

## Evidence / next gate

Isolated source-equivalent JavaScript receipt tests 8/8 PASS; 12 static Native/CI/source-accounting wiring checks PASS. Full hosted Node and real Windows PowerShell/FFmpeg tests await exact-head execution, as do browser/physical-user files. Do not mark B16 complete or infer final-file SSIM, exact size guarantee, or device acceptance.
