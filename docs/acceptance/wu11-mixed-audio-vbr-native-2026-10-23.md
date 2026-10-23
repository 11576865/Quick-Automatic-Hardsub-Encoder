# WU11 同一 VBR 正式任务：FLAC Copy＋AAC 重编码（2026-10-23）

**范围**：R19/R24 B02/B04/B05/B06/B07/B11/B12/B13/B24，A01/A02/A03/A05/A06；依据 issue #107、已合并 PR #126–#128。本阶段仅 Windows Native 复现式有界实测，不关停任何初版全项。

## 与上一轮相比改变了什么
- [PR #128](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/pull/128) 同一片源的 Guided→正式 VBR 成品已获真实 Windows CI，但音轨为 **FLAC Copy ＋ AAC Copy**。另一个 WU02 用 **CRF23** 实证 FLAC Copy＋AAC 编码，两者不能拼成相同 VBR 策略的成品证据。
- 本单元以同一个既有 WU02 rich Matroska 文件、内封 ASS、附件 TTF 和 Native Bridge Session，在 **第一次决定 VBR 视频码率前**明确固定逐轨意图：`[{sourceOrdinal:0,action:'copy'},{sourceOrdinal:1,action:'aac',bitrate:96000}]`。来源 SHA 作为锁定身份，a:0 `mustCopyAudioOrdinals=[0]`。
- `src/guided-task-handoff.js` 仅接受 `intent:'explicit-per-stream-v1'` 提供的逐轨输入；原 Guided 默认单一 `audio` 策略不自动继承 Manual 表单历史值。`src/guided-cpu-compiler-contract.js` 强制来源 identity、复制音轨锁、至少一 Copy 和一 Encode、真实 `full-source` 成本域；同一正式 `compileTask` 必须核对每条音轨动作、锁、成本、码率、字幕渲染顺序与执行参数，失败回滚。
- `scripts/build-wu11-native-vbr-task.mjs` 用唯一正式 `compileTask` 的 `sizeBudget` 算出目标视频码率：固定 FLAC 源包成本加上全片 96 kbps AAC 预留；相同码率供两个 Native ASS-rendered VBR 短样使用；正式 v4 job 从共同 CPU 任务编译器输出。**绝不沿用先前 Copy/Copy 的预算、已验 VBR 证书或旧来源 identity**。
- `scripts/verify-wu11-native-vbr-output.mjs` 独立 FFprobe：正式成品 H.264、a:0 FLAC 所有包 sha256 与源一致，a:1 AAC 包与源不相同（确认真的重新编码），无多余软字幕/附件，源、font、ASS、目标码率、预算测量身份一致，并检查独立无字幕版本在 0.9s 画面像素不同。

## 严格的证据边界
- 当前是源码已提交待 CI：不声称此 PR 已 Windows PASS。
- `explicit-per-stream-v1` 在此为**受控测试的明确意图记录**，不是当前真实 Guided 用户 UI 操作；`check-wu11-guided-vbr-explicit-adoption.mjs` 仍标明 `automated-fixture-only`。
- 单遍 best-effort VBR 不保证 1MB 体积上限或全片主观质量，SSIM 两窗证据不能转移到正式成品作为自动采纳许可。
- GPU/Android/Web/真实用户视频与目标播放器，VFR/B帧时间审计和严格保存失败矩阵都未关闭。

## 执行与合并门槛
`.github/workflows/windows-wu02-embedded-ass.yml` 的真实 Windows FFmpeg 与 Node+Chromium 完整前端回归、UIGS Evidence Coverage 必须绑定本 PR **同一最新 head** 全部 PASS，才能合并主干。出现失败先读取具体作业日志，只做 bounded 修复，不能删除 packet/hash/SSIM/来源 identity 严格断言换绿色。
