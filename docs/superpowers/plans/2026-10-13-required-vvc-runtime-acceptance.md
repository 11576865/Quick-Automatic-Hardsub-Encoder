# Required VVC runtime acceptance

Follow-up to scoped five-round handoff: actual VVC remained UNSUPPORTED because
existing CI FFmpeg lacks libvvenc. Keep generic smoke tolerant of unsupported
capability, but add a separate required-runtime workflow that cannot pass without
real Windows QP/bitrate/ASS jobs through the existing localhost Bridge.

BtbN upstream scripts.d/50-vvenc.sh (blob 850b1339578b37ef280771e62e0ef814e65806ca)
enables libvvenc for current x64 builds. Resolve its official release metadata,
verify downloaded ZIP SHA-256 against the supplied digest before execution, isolate
under RUNNER_TEMP, and retain release/asset IDs and FFmpeg version. Floating latest
is a discovery mechanism, not a reproducible version promise; each result binds to
its captured release asset/digest. Missing digest or required library fails closed.
No product-side download or user-toolchain replacement.

## Completed implementation and local evidence

- RequiredRuntime switch records UNSUPPORTED then fails rather than exiting zero.
- Optional hard-sub fixture extends the existing two transcode tasks; generic smoke
  defaults stay two tasks. Node regression observed 2 failures then 2 passes.
- Actual Bridge completion is followed by independent FFprobe VVC/10-bit/24-frame
  checks and full FFmpeg decode; retain three generated MKVs and toolchain provenance.
- Local suite 213 passed, 7 conditional skips, build passed, YAML syntax passed.
- Hosted PowerShell syntax, toolchain download and actual runtime remain Pending.
- No claim of physical device, full-film, player or visual subtitle fidelity acceptance.

## First hosted runtime result and bounded repair

Workflow 38344020498 downloaded and hash-verified asset 633881560
(SHA-256 4480b1abcae8bb46146e271fe603efaa90f29671ff9013bb0aed2d64d12951c8).
It progressed beyond the real short VVC runtime/health gate, then the first formal
Bridge request failed: `FFmpeg encoder does not support -fps_mode`.
The global help-option regex could not normalize optional selector suffixes such
as `-fps_mode[:<stream_spec>]`; toolchain scoring and global capability parsing now
share Get-FfmpegOptionNames. Strict task validators remain unchanged.
Two Node cases exercise the actual production regex (modern suffix/legacy names
and malformed help) RED->GREEN. Dedicated CI also runs the actual .NET helper.
Full help, capability snapshot and bridge stdout/stderr are captured for subsequent
evidence. Local total 215 passed/7 conditional skips, Vite and YAML syntax passed;
PowerShell and formal QP/bitrate/ASS execution remain Pending after this repair.
