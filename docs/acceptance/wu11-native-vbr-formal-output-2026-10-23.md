# WU11 实际 VBR→Manual→Windows Native 完成成品（双 Copy 音轨有界切片）

日期：2026-10-23；主干基线 `f9178961765d6c6387db7c72b21fdfae70b61f25`。对应 R19/R24 B02/B04/B05/B07/B11/B12/B13/B24 和 A01/A05/A06；继续此前 [WU11 文件级方案](../acceptance/wu11-same-source-guided-to-manual-native-exact-file-plan-2026-10-23.md) 与 issue #107。

## 实现与可观测边界
- Windows Native `/api/source-budget` 实际扫描单一 WU02 复杂 MKV 的两个音频轨道，提供 `full-source` 预算测量及 measurementId。
- 新 `scripts/build-wu11-native-vbr-task.mjs` 使用**正式** `compileTask` 的体积成本预算选择 1,000,000 bytes best-effort 目标，取其实际算出的 videoRate，冻结 Guided `budget-rate` snapshot；再经**正式** `compileGuidedCpuHandoff` 与 `commitGuidedCpuHandoff` 重编译并比对正式 outputArgs。任何来源/预算/码率偏离均拒绝。不存在第二套媒体编译器。
- 同一来源+内封 ASS/附件字体的两个实际 FFmpeg/libass Native ASS-rendered 窗口以这个精确 videoRate 测试。原来的生产 `verifyGuidedNativeVbr` 和 `commitVerifiedGuidedBranch` 检查完毕，写出明确为 `automated-fixture-only` 的正式方案对应收据；**这不是浏览器用户点击证据，也不能把 Native SSIM 证书当执行准入授权**。
- 同一进程与来源，Native `/api/encode` 正式执行已编译 v4 VBR 任务。独立 `scripts/verify-wu11-native-vbr-output.mjs` 核对源和成品哈希/codec、两个原音轨各自完整 packet SHA256 一致、ASS 字体内容身份、实际字幕像素差异，记录真实文件体积。按 best-effort 语义，即使超过 1,000,000 bytes 也不宣称严格体积达标。
- WU02 原有的 **CRF23 + a:0 FLAC Copy / a:1 AAC 重编码** 运行与独立验收继续保留。新的 VBR 正式任务以 **a:0 FLAC Copy / a:1 AAC Copy** 运行，正是为了避免改变复制流成本而悄悄继承不再有效的 VBR/预算证明；**不能把这两个正式任务合写成一个混合音轨 VBR 端到端结果**。

## 尚缺
- 从真实用户浏览器交互到 Guided 显式确认的同次会话独立核对（现为自动化审批模拟）；当前收据保留 `explicitUserClickObserved:false`。
- Guided 模式对逐轨 `mustCopy+AAC` 意图的独立来源冻结、预算重投影及正式 VBR 重新验证，才能在**同一个** VBR 作业里兼顾 P2 混合轨合同。不允许擅自继承 copy-all 的视频/音频预算证明。
- 用户 Windows/Android 实机、真实高复杂字幕、VFR/B 帧、长期视频、目标播放器与真正 strict byte ceiling 均为独立 Field 或验收待办。

## 验证规则
源码已提交并等待非 Draft PR 的精确头部 **Windows WU02 real Native + Test frontend + UIGS Evidence Coverage**。未全部成功前不合并。任一测试失败均保留已验证事实并做单次有界修复，不删除真实音轨 SHA、预算相等和 ASS 像素检查来获得 CI 绿色结果。
