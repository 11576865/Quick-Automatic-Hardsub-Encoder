# QHE B16 — asynchronous completed-output trim packet audit

State: submitted implementation, hosted Windows Native acceptance pending (2026-10-14).
Scope: completed-artifact observability only; NOT pre-encode trimmed copy payload prediction.

## Before
The Windows Bridge synchronously scans copied audio/subtitle packet bytes on completed trim tasks only when the staged file is <= 512 MiB and expected video duration <= 180 seconds. Longer output intentionally reports no completed packet audit. This does not affect the authoritative conservative full-source preflight cost.

## New bounded worker
- `windows/trim-packet-audit.ps1` invokes FFprobe on the **completed staging file**, scanning only audio and subtitle packet sizes with constant-memory per-stream accumulation, bounded time and packet count.
- Writes a private, atomic JSON receipt with ordered actual payload totals and output stat identity (`sourceLength`, `sourceWriteTicks`). The stat identity is NOT a cryptographic attestation.
- Windows Bridge starts the worker only when the existing short-output synchronous path would be skipped. Completed status returns immediately with `outputPacketAuditState=running`, later `ready` or `unavailable`.
- The Bridge compares the result with both its original worker-launch stat and a fresh artifact stat, re-probes stream ordinals, rejects missing or invalid packet totals, and never exposes partial data as `completed-artifact` evidence.
- The worker is a separate Windows PowerShell process with each FFprobe packet scan capped at 120 seconds and 2,000,000 packet lines, stream inventory capped separately, and memory bounded by stream count. Failure becomes `unavailable`; it never changes encoding completion or the strict file-byte publication gate.
- The UI keeps the original verified output; the user can click **任务报告** to refresh the job-owned packet-audit receipt without triggering another encode. This is an on-demand read, not an infinite poll.

## Validation and evidence limits
- `src/trim-copy-audit.test.mjs` tests report fail-closed semantics for `running` and `unavailable`, plus static ownership, deadline, provenance and status contracts.
- `scripts/check-guided-budget-native.ps1` now runs the separate worker on an actual short Windows Native trim fixture and compares its source stamp and packet totals against FFprobe and the existing synchronous completed-output audit.
- Windows local-smoke PowerShell syntax gate includes the new worker file. No actual Windows long movie was run in this work unit; all above Windows acceptance remains Pending until a matching workflow run completes.
- Exact B16 pre-encode trimmed copy bound, FLAC re-encode sizing, Android/Web stream metering, real user long-form material and physical playback remain open.
- Source-identity proof is based on path/length/mtime and the job-owned private staged file, not collision/tamper-resistant media hashing. File metadata can be adversarially preserved.
- The worker may continue on its own while an interactive client disconnects. Its startup/finish status can be queried only while the current Bridge process retains job ownership. Bridge-process restart recovery remains an independent open requirement.

## Exit gate
Before closing this B16 subunit, observe exact-head fast frontend CI, actual Windows Native smoke with worker, prove large-output nonblocking state transition, capture a real >180 s or >512 MiB completed trim artifact and independent packet/strict-output oracle. Skipped draft full checks are NOT acceptance.
