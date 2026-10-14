# QHE B16 — Native FLAC 成品包审计与真实输出流映射合同

日期：2026-10-14
工程分支：feat/qhe-b16-final-mux-runtime-contract-20261014
PR：https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/pull/105
范围：B16 部分实现，B01–B25 / A01–A10 完整理论初版尚未签收。

## 已确认的上一批真实平台验收

提交 `0bd2381c3f0a85195410e610a3cde89ca033daac` 对应：
- `Windows B16 runtime acceptance` run `38513613921`：**SUCCESS**；PowerShell 5.1 语法、Node 收据/逐流对照、FFmpeg 实际 FLAC 双音轨和裁切复制软字幕两个独立 oracle 均 PASS。
- `Test frontend`、`UIGS Evidence Coverage`：**SUCCESS**。
- 其它 Windows 全套和 Android 等重型矩阵由于 Draft 规则仍 SKIPPED；未声称验收覆盖这些平台。

这证明之前的 PowerShell 自动参数 `$args`、真实 FFprobe 输入文件以及独立 FFmpeg 回归已修复，不意味着 Native HTTP/真实用户 UI 自动通过。

## 本轮发现并修复的执行链缺口

1. **成品 FLAC 审计触发条件错误。** 原 `Get-CompletedTrimPacketEvidence` 仅在 `hasTrimRange` 且 `sizePlan.copiedTrimReserveBytes > 0` 时读取成品包负载；FLAC 的质量/码率模式没有预测性 `sizePlan`，因此不可能取得对照所需的最终独立包收据。本次对存在任意 `audioPlan[*].action='flac'` 的 Windows Native 已完成任务启用相同 FFprobe 逐流成品后审计，沿用短成品同步、长成品独立异步的 bounded worker，不改变正式预算或用户成品。
2. **软字幕映射与真实编译器结构不匹配。** `createOutputPlan` 将 `outputPlan.subtitles` 存为 `[{sourceOrdinal, action}]` 对象，然而旧对照函数把它作为数字索引数组，从而在合法软字幕任务中误判不匹配。本次按来源轨道显式查找，拒绝缺失、未知或重复映射；原始 FFmpeg `-map` 执行顺序不变。
3. **默认「全部字幕/附件」没有具体输出轨号。** `createOutputPlan` 之前存象征性 `all`，现在按已探测的字幕/附件流数量，在*报告层*展开具体来源序号；未探测到流数量则不得凭空给出轨道身份。输出 FFmpeg 命令仍保留兼容的 `0:s?`/`0:t?`。
4. **成品对照可见性。** `media-workspace.js` 在本次成品或后台逐流 FFprobe 完成后展示 FLAC/裁切预演与实际混合成品的字节差异或不可比较原因，报告 `auxiliaryParity` 仅标记本次 `single-completed-job`，`canReplaceFormalBudget:false`、`canCertifyFutureMux:false`。来源、计量或执行字段失效的旧预演不再声称有效。

## 更高价值的真实 Windows 端到端 fixture

`scripts/check-flac-native-http-lifecycle.ps1` 在真正 Windows Native Bridge 进程中：
- 合成 FFV1/两轨 PCM 源，测量来源成本，运行 `POST/GET /api/flac-encode-preflight`，检查 FLAC 真实收据与 `measurementId`。
- 对同一文件重新全量计量，验证旧 READY 收据随新来源计量 ID 作废。
- 通过 `POST /api/encode` 运行正式版 Manual Native `transcode` 质量任务（`rateMode='quality'`，无 `sizePlan`），视频实际编码，a:0 全段 FLAC，a:1 裁切 FLAC。
- 要求成品 `outputPacketEvidence.scope='completed-artifact'` 且两轨非空，逐轨与独立 FFprobe 复扫比对，确保真实全局执行不误走“只有裁切复制时才审计”的旧分支。

`.github/workflows/windows-b16-runtime.yml` 将该 Native HTTP 完整用例加入 Draft 专项 Windows 测试，非强制 PR 合并条件仍按全量需求矩阵。

## 本地／托管验证边界

- 已经执行基于仓库实际 `compileTask`、`createOutputPlan` 和 B16 reconciliation 模块的 17 项隔离 JavaScript 行为检查，**17/17 PASS**，包括完全展开「全部字幕/附件」而不修改 FFmpeg map 的断言；UI 模块源码解析通过。
- 旧精确头部 Windows B16 实际 FFmpeg 测试 **PASS**；新批次 Native HTTP/成品 FLAC 执行和浏览器工作台互动 **Pending**，不能提前标记。
- 未启用 FLAC 严格体积预算：本次验证只提高观察与成品后审计的可信度，不能把不同 FFmpeg 执行的独立 FLAC 预演 packet bytes 当作下次正式任务的必然值。容器整体开销、重采样边界、PTS/VFR 和未来输入仍需独立证据。
