# QHE B16 — 已完成成品的视频/音频/字幕包负载和未归属字节账本

日期：2026-10-14
PR：#105（Draft）
范围：Windows Native 已完成任务中的 B16 实测成本归因；不是严格体积预算的预测模型或 B16 结项。

## 已确认的先行运行证据

上一个提交 `7c0ddf0c53283220bcaf875cc1b0d55fdde6fab3` 的 Windows B16 专项 CI run `38518876660` **SUCCESS**，包括 Windows PowerShell 5.1、实际 FFmpeg/FFprobe 双轨 FLAC、裁切复制、Native HTTP 来源失效、182 秒真实成品异步逐流审计与篡改失效。其 Test frontend 和 UIGS Evidence Coverage 均 SUCCESS；Android、全套 Windows/VVC 仍按 Draft 跳过。

## 新增真实成本归因

先前 `outputPacketEvidence` 只有音频与字幕包字节，但缺少视频包字节。即使知道容器总大小，仍无法判断其余字节有多少属于视频，多少属于音频/字幕之外的数据。新增：

- `windows/trim-packet-audit.ps1` 对 180 秒以上或大于 512 MiB 的成品异步扫描 `v`、`a`、`s` 三组 packet size，而非只扫描辅助流；所有扫描有各自 120 秒／200 万行上限。成品总字节与 Windows NTFS stat 必须在扫描前后相等。
- `windows/native-bridge.ps1` 对短成品同步执行独立视频包扫描，并验证视频／音频／字幕输出流数量。长成品回执除了现有 `artifactJobId`、`artifactBytes`、`artifactWriteTicks` 身份外，新增按输出视频轨排序的 `videoPacketBytes`。
- `src/completed-mux-byte-ledger.js` 对实际成品当前作业和文件 ID、大小、NTFS ticks、`outputPlan` 源→输出轨数，验证三个包字节数组非负、安全整数、总和不超过成品真实长度。计算：
  - `videoPacketBytes`
  - `audioPacketBytes`
  - `subtitlePacketBytes`
  - `otherAndMuxBytes = artifactBytes − 三类 packet payload 总和`
- **重要：`otherAndMuxBytes` 不等于“纯封装开销”。** 它还可能包括附件内容、chapter、stream codec extradata、索引、标签、metadata、对齐填充和其他类型的 payload。不得将该单次数值外推为新的容器预留比例。
- `src/media-planning.js::outputReport` 新增 `completedMuxByteLedger`，`src/media-workspace.js` 在短片完成状态及长片后台 FFprobe 审计完成后展示按视频/音频/字幕/其他及封装分组的实际成品字节数，并提示不可外推。当前没有视频包回执的旧结果明确为 `unavailable`，不能填写零或伪造数据。
- **正式大小预算 `sizeBudget` 未改变。** 未认证的 FLAC 预编码独立预测仍禁止进入严格目标体积；原先严格上限的最终容器大小/内容指纹验证保持不变。即使该次 Packet ledger 完全闭合，`canPredictFutureBytes:false`、`canAuthorizeStrictBudget:false` 始终成立。

## 测试与验收

- `src/completed-mux-byte-ledger.test.mjs`：8 个隔离纯 JavaScript 行为测试 PASS。覆盖成品任务 ID/大小/ticks 绑定、流数量、包字节安全整数、包总和溢出、缺视频流拒绝、少音轨、超预算时负 headroom 以及报告接线。增补一个 Node 文件/Native/工作台接线检查。
- Draft-fast/完整前端 `Test frontend` 和 `Windows B16 runtime acceptance` 都接入新单测；专用 Windows B16 工作流复用两个已经真实运行的 Native 短 FLAC、182 秒异步 FFprobe 实际源，新增**独立逐视频轨 FFprobe 复扫对照**。
- `scripts/check-flac-encode-preflight.ps1` 进一步通过独立 FFprobe worker 对实际 1 视频+2 FLAC 音频+1 软字幕 Matroska 的 `videoPacketBytes`、`audioPacketBytes`、`subtitlePacketBytes` 做全流验证，并确认 codec packet totals 不超过输出容器 bytes。

新 head 的实际 Windows 运行和浏览器完整交互验收为 **Pending**，不把语法/隔离测试当作真实平台 PASS。

## 仍然开放的理论模型缺口

隔离 FLAC 编码与**正式混合成品中实际编码复用**的同一 packet bitstream 来源、PTS/seek/源身份和可重复性，尚不足以授权下次严格体积决策。要使估算升级为确定成本，需要在最终执行事务中确保复用同一已编码音轨或采用更强的构造性证明，且仍需封装余量与实际字节失败回滚。Android/Web 和真实长时 VFR、高密度字幕仍未签收。
