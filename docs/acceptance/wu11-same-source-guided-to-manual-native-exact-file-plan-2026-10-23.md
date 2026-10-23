# QHE WU11 — 同一来源 Guided → Manual → Windows Native 成品验收：精确文件计划
日期：2026-10-23；性质：**授权的 Design / Exact-file plan，不是执行结果或产品代码变更**。
依据：R19 P1/P2/P3、R24 §05/§11/§13–18；`docs/qhe-initial-version-route-reanchor-2026-10-14.md`；初版验收 [#107](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/issues/107)。
基线：`main@da4833a78f188c2bbd1e9628158c874b3f749530`（PR #124、#125 已集成）。相关 B02/B04/B05/B07/B11/B12/B13/B24、A01/A05/A06 均**不因本计划而关闭**。

## 1. 审查结论：已有片段，不是同一完整任务的证书
- `scripts/check-guided-budget-native.ps1` 自建 `testsrc2` + 两个 PCM 音轨的 2s MKV，以及手写 `Budget fixture` ASS。Windows Bridge 实际运行同参考 ASS 的两段 Native VBR/SSIM；`scripts/check-wu11-guided-vbr-explicit-adoption.mjs` 用真实收据驱动 `verifyGuidedNativeVbr` 和 `commitVerifiedGuidedBranch`，但是 `approvedByUser=true` 是 CLI 中模拟的显式确认，`opts.preview/compile` 也是简化测试映射。其输出明确 `manualTaskExecuted:false`、`uiClickSimulated:false`、`fullMovieVerified:false`。
- `scripts/check-wu02-embedded-native.ps1` 另建复杂 MKV：视频、FLAC、AAC、内封 ASS 与字体附件；`scripts/build-wu02-native-task.mjs` 调用生产 `compileGuidedCpuHandoff` → `commitGuidedCpuHandoff`，但输入的是 **CRF quality 23** 的独立 Guided snapshot，不是上述 **650000 bit/s VBR** 的用户已采用提案。随后用户在 Manual 端另外显式选择 FLAC mustCopy + AAC 重编码并经正式 `compileTask` 编译。最终真正执行 Native `/api/encode`，`scripts/verify-wu02-native-output.mjs` 检查烧录、轨道与 FLAC packet data SHA256。
- 因此两个已有绿色验收是**不同输入素材、不同 ASS/字体来源、不同编码决策模式**的有界证明。把它们合计为“WU11 VBR 决策已贯通实际最终成品”将错误跨越证据作用域。两者虽都真实运行过 Windows FFmpeg，但并非相同 `SourceAsset / EvidenceScope / ImmutableJobPlan / ArtifactRecord`。

## 2. 授权后续执行必须冻结的唯一测试身份
建立 **一个** 可复现 MKV fixture，优先复用 WU02 源生成器而不是另起一套媒体：
`scripts/build-manual-rich-native-fixture.mjs` → `source.mkv`（源视频编码为 FFV1，另有 FLAC a:0、源 AAC a:1、内封 ASS、字体附件及两章；最终视频需由正式任务输出 H.264）。由 Windows 同一 `native-bridge.ps1` 进程完成所有步骤。开始和成品检查前分别独立记录：
1. **Input**：源码 SHA256、字节数/mtime 与 `/api/probe` 全部轨道序号；Native evidence 的 sourceToken 作为该 Session 内取证键，**不能把 file-stat token 冒充 SHA256**。
2. **Subtitle & font**：`/api/embedded-ass` 选择的精确 ASS 轨序号、UTF-8 字节 SHA256；真实字体 attachment 字节 SHA256，核对 Native 样本的 staged `assTextSha256` / `fontContentSha256` 与正式任务引用的素材一致。字体内容散列定义须复用 `windows/guided-rendered-sample-evidence.ps1`，不可仅对文件名求 hash。
3. **Decision**：固定 `guided-ass-rendered` 参考标识、同一 Bridge runtimeToken、同一 outputWidth/Height、codec/preset、两窗起止、bitrate、音频/容器和 `budgetEvidence.measurementId`。**不移植** Manual SDR SSIM；短样不宣称全片大小或画质。
4. **Manual job**：记录 Guided 正式确认后实际选定的方案与 `compileGuidedCpuHandoff` → `commitGuidedCpuHandoff` → **重新** `compileTask` 的一致性/差异；Manual 逐轨 mustCopy、另一轨 AAC 必须作为新用户意图明确记录，不可伪称它们由 Guided 默认推荐继承。保存最终 schema-v4 JSON 与 `outputArgs` hash，不经第二编译器。
5. **Artifact**：绑定 Native `jobId`、工作区临时成品 SHA256/实际字节数与 `/api/jobs/<id>` 返回值；独立 FFprobe 各轨 codec、disposition、timebase/首包与末包、章节/附件政策、a:0 全序列 packet SHA256、a:1 AAC 确实重编码，以及 ASS 烧录的非字幕/有字幕参考差异。原生 Native 结果不能由伪造的浏览器 run hook 代替。

## 3. 文件级最小执行增量（下一工作单元，尚未实施）
| 文件 | 准确的实施职责与限制 |
| --- | --- |
| `scripts/check-wu02-embedded-native.ps1` | 将同一 WU02 fixture、相同桥 Session 的 ASS/font import 与 Native VBR 两窗、正式任务、输出核验串在一起；不要复用 `check-guided-budget-native.ps1` 的独立 testsrc 证书。开始与结束 SHA、实际 Bridge runtime 和失败路径一并落盘。 |
| `scripts/check-wu11-guided-vbr-explicit-adoption.mjs` | 从同一 WU02 Session 实测收据派生生产验证/提案，输出明确的已验提案字段；**不得**用硬编码 `approvedByUser=true` 证明真实点击。保留现有单元负例。 |
| `src/guided-branch-adoption.js`、`src/guided-native-vbr-verification.js`、`src/shared-evidence-decision.js` | **首选只复用**；若同源 evidence/proposal 实际合同不兼容，优先报告最小断点，不放宽 source/reference/预算域门禁。 |
| `scripts/build-wu02-native-task.mjs` | 改为可接受经过验证的生产 Guided snapshot 和独立明确的 Manual audio lock 意图；**不得**从 VBR 收据偷偷退回目前固定 `mode:'crf'` 的测试任务，也不得自动继承 ASS/音轨预算证书；使用既有 CPU handoff 和正式 schema-v4 编译器。 |
| `src/guided-cpu-compiler-contract.js`、`src/guided-task-handoff.js`、`src/media-task.js` | 原权威路径，先审查而不复制或替换编译器。交接后强制重新编译、比对包含 ASS-before-scale、逐音轨策略与正式滤镜的全执行字段；不兼容时回滚。 |
| `scripts/verify-wu02-native-output.mjs` | 保留现有 FLAC 包 SHA256、AAC 重编、libass 烧录检查；新增单次证据链的 source SHA/ASS/font hash/Native job/output task 对照，要求缺少任一字段 FAIL 或 PENDING，不能仅输出通用 PASS。 |
| `.github/workflows/windows-wu02-embedded-ass.yml` | 下一执行单元才按精确改动文件触发有界 Windows Native 全链回归；不再新增第二套不可比 fixture 或长 CI 周期。 |
| `scripts/check-wu01-browser.cjs` | 证明真实用户显式采用/交接 DOM 的独立环节；如果不能同一 Session 跟随后端真实 VBR 收据，应明确留为受控浏览器合同，不将其拼装成单次全链用户场景。 |

## 4. 成功/失败门禁与可交付证据
- PASS 只允许在**同一个** SourceAsset SHA/Bridge Session 下，已有 Native rendered sample 收据被产品校验器接受，经明确用户采用/CPU handoff 后用当前正式任务编译器输出且同一来源实际编码；独立 FFprobe 证明成品资产、轨道、字幕/字体、FLAC packet payload 与字段一致。
- FAIL：源 SHA/Native token 任一漂移、ASS/font 实际哈希不同、Guided VBR 候选未经明确采用、CRF/VBR 或 filter/preset/size/stream 悄然切换、a:0 Copy 失守或输出未完成。负例必须可重放。
- FIELD-PENDING：GPU、目标播放器、用户长片、Android SAF/Web WASM、B-frame/VFR 完整时间审计。它们不阻止有界 Windows 实测，但仍计入独立初版 A01–A10 验收。
- 若 Native sample 不能从已导入的字体附件使用一致 `fontsdir` 生成真实 staged hash，应以 **BLOCKED: staged-font-provenance** 标注并只修复此最小连接；不可把系统 Arial 静默视为附件字体。

## 5. 本单元边界
这里完成的是源报告授权的 WU11 **文件级计划与缺口复核**，不是新生产实现。现存脚本片段不构成同一次 VBR→Manual→Native 成品验收，旧 CI 也不能被倒灌为本计划的 PASS。下一轮是否编码以项目正式任务授权与源报告为准；不触及 B16 严格预算方案或跨端 Web 核心供应商分发许可。
