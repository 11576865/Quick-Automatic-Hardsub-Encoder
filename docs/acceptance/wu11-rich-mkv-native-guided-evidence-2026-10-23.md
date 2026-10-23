# WU11 / WU02 同一复杂 MKV Native Guided ASS VBR 实测接入 — 2026-10-23

**授权**：R19/R24 初版 B02/B04/B07/B11/B12/B24、A01/A05；见 issue #107 WU11。主干基线 `da4833a78f188c2bbd1e9628158c874b3f749530`。保留设计方案于 [PR #126](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/pull/126)，其 CI 未核销，且本代码分支独立基于 main。

## 为什么不能拼接原有成功
`scripts/check-guided-budget-native.ps1` 的两窗 Guided 实测使用单独 2s testsrc2/PCM/手写 ASS，`scripts/check-wu02-embedded-native.ps1` 正式硬压则使用另一份 5s FFV1+FLAC+AAC+内封 ASS+附件字体的 MKV。旧后者的 `build-wu02-native-task.mjs` 从 CRF23 的 Guided snapshot 起步。两者独立成功不等于一个来源的 VBR 推荐到 Native 成品闭环。

## 本有界实现
1. 在 WU02 真实 Windows Native 单个桥进程完成 `/api/probe`、`/api/embedded-ass` 导入后，立即用相同 `source.mkv` 与真实导入 ASS/字体，触发两个 `/api/sample`：ASS-rendered/reference SSIM、`libx264`、650000 bit/s、medium、0.8s @ 0s 和 1s。
2. 保存同一 Session 内的 Native `sourceToken`、`runtimeToken`、原生 `assTextSha256`、`fontContentSha256` 与导入数据；源 `source.mkv` 独立计算前后 SHA256。原生 token 只是运行时 stat/FFmpeg stamp，不能解释为 SHA256 内容校验。
3. 同一 `scripts/check-wu11-guided-vbr-explicit-adoption.mjs` 使用真实样本调用生产 `verifyGuidedNativeVbr` 及显示明确采用的原有事务夹具；当带入 WU02 import 时，另外从导入 ASS UTF8、TTF bytes 重算 staged `font1.ttf:SHA256` 聚合 hash，逐个核对 native 证书的字体个数及 ASS/font 精确 hash。
4. 然后保留 WU02 原有独立 Native v4 CRF23 hard-sub、双轨 FLAC copy/AAC transcode、FFprobe hashes/烧录帧验收及来源突变拒绝，不修改 codec/renderer/compiler 产品路径。

## 断言与真实边界
- 字体附件对应真实 `source.mkv`；若 Native stage 未采用附件字体，staged font hash 与导入 font bytes 不一致，测试 FAIL。
- 两窗来源或 Native runtime 漂移时，生产 `verifyGuidedNativeVbr` 必须拒绝；篡改样本已有负例。
- `commitVerifiedGuidedBranch` 的 `approvedByUser=true` 仍是测试显式模拟，**不是**实际用户点击、真实 Manual 交接或整片证明。
- WU02 最终 task 仍然是 **CRF23**，不可把已验 Guided VBR 字节目标偷换成最终产物。当前 WU11 真实同源资产环节尚待 Windows CI，整条 WU11 **未验收完成**。
- Windows/Android 物理设备、播放器、VFR/B-frame、真实长片和 Web WASM 仍各自 Field/Pending；不得为绿色检查自动扩大已验收范围。

## 验证
`.github/workflows/windows-wu02-embedded-ass.yml` 路径门禁已包含新增真实 Guided 测试脚本。新 PR 的 exact-head Windows 实测、frontend 和 UIGS 结果独立记录为 PASS/FAIL/PENDING。若发现 FFmpeg staged font/ASS 与来源证据不等价，只做一次针对性修复并保留失败证据，不借系统字体替代。
