# QHE B16 — FLAC 多音轨真实预编码观测、共享诊断入口与 Draft 专项 Windows 验收

日期：2026-10-14
状态：PR #105 Draft 工作分支已完成工程实现；托管 Windows / 浏览器验收等待本提交的精准结果。
需求：B16 部分实现，不得缩减 B01–B25 和 A01–A10 理论初版验收分母。

## 本工作包横跨的工程边界

之前 Native B16 支持裁切复制音轨与软字幕的隔离复制包字节预演，但 Manual 体积预算中的 FLAC 重编码直接拒绝，因为 FLAC 不是按指定 bit/s 可精确预测的编码方式。用户缺乏可复核的预编码成本观测；此外全部 Windows smoke 在 Draft PR 上可能被跳过，使大量新增 PowerShell 工作缺少真实运行证据。

本次将三个相关层面同步推进：

1. **真实 FFmpeg FLAC 音轨观测。** `windows/flac-encode-preflight.ps1` 对最多 16 条显式选中的源音轨，按各轨 `full` / `trim` 策略创建源完整输入和裁切输入；保留所指定的声道数 / 采样率；在独立 Matroska 音频中实际执行 FLAC，然后用已有 `trim-packet-audit.ps1` 的独立 FFprobe worker 统计每条音频流的包负载。来源长度和无损文本化 FILETIME tick 前后核对。单次预演限制请求跨度 4 小时、FLAC 编码最长 360 秒、输出 1 GiB 临时文件阈值（编码时检查）、独立 FFprobe 有界 270 秒扫描；超界返回不可用而不是估算值。原源可能长于请求跨度，若全轨编码超过有界时间同样不可用。
2. **Native 单飞异步证据生命周期。** `windows/flac-encode-preflight-bridge.ps1` 加入 `POST/GET /api/flac-encode-preflight`，固定 Bridge 选中原文件和完整源流 `measurementId`；来源或重新测量发生变化，旧记录包括已经 `ready` 的记录立即失效。收据必须与来源 stat、精确选流次序、范围、声道、采样率、真实编码方法和非负整数包字节吻合。与另一套隔离复制预演以及正式 Native 编码的工作所有权互斥。没有跨进程恢复承诺。
3. **共用工作台只读诊断与真实 CI。** `src/windows-native-client.js` 暴露 Native 调用，`src/auxiliary-preflight-request.js` 将当前音轨策略与 IN/OUT 编成有界请求；`src/main.js` 的钩子检查 Windows 选择与 UI 来源，等待单份有效异步回执；`src/media-workspace.js` 在完整源流测量旁新增“实测 FLAC / 裁切复制成本”，用独立 JS 校验器验证预算作用域、范围、选流、回执和测量 ID，展示每次观测包字节。部分轨被测量时明确提示其余轨没有覆盖。
4. **专项 Draft Windows FFmpeg 执行。** 新增 `.github/workflows/windows-b16-runtime.yml`，不受常规 Windows local smoke 的 Draft 跳过规则影响，仅在 B16 代码变更时执行 Windows PowerShell 5.1 脚本解析、Node 收据/请求回归、实际双轨全段+裁切 FLAC 独立 FFmpeg 编码和独立 FFprobe 对照、已有多音轨/软字幕裁切复制 oracle。不触发 VVC/Android 全套矩阵。

## 可信语义：完整源流保守预算没有改变

- `src/flac-encode-preflight.js` 以及 `src/trim-copy-preflight.js` 都返回 **仅观测**。FLAC 收据必须标记 `observationOnly:true`、`canReplaceFormalBudget:false`、`canCertifyFinalMux:false`。复制流收据同样不能替代保守预留。
- **`src/media-planning.js::sizeBudget` 没有放宽 FLAC 的拒绝。** 严格体积目标采用 FLAC 而没有最终混合任务等价的、可复用的实际 FLAC 成品包成本证据时，继续明确报错。当前观测数值不能自动改变视频码率、预留余量或“可交付”状态。
- 隔离音频输出缺少完整视频和其他字幕/附件流；FFmpeg 在真实最终混合封装中可能改变音频编码起止位置、packet 边界、PTS、encoder padding 和封装开销。只有同源、同时间策略、同音轨、同实际编码器设置且最终 mux 证明成立，才可能升级成本权限。
- Windows `FILETIME` 与源文件字节数及原始 `measurementId` 可检测常见更改但不是加密内容证明。浏览器界面不拥有原生 NTFS tick 真值，因此最终依赖 Native 对 file stat 与 ledger ID 的独立验证。

## 测试证据与退出条件

- **16 / 16 隔离 JS 核心逻辑测试通过**：8 条 FLAC 收据与预算拒绝、8 条多流请求选择与来源边界。
- **2 / 2 静态接线测试通过**，前端 `main.js`、`media-workspace.js`、`windows-native-client.js` 语法解析通过。
- **Linux FFmpeg 小型真实重现**：3 秒 FFV1 + 双 PCM 音轨合成源；第一音轨完整 FLAC packet payload 39300 bytes、第二音轨 0.4–2.4 秒裁切后 27599 bytes；仅说明本机 FFmpeg 命令能生成预期两轨，非 Windows 产品端到端验收。
- 新 `src/flac-encode-preflight.test.mjs`、`src/auxiliary-preflight-request.test.mjs` 已接入 Draft-fast 与完整 `Test frontend`。
- **Pending：** 真实 Windows PowerShell 解析、独立 FFmpeg/FFprobe 运行、Windows Native Bridge HTTP 异步收据、实际浏览器 UI 操作、长片/音轨组合/FLAC 编码器配置、视频/软字幕混合封装真正成本等价、Android/Web 计量与正式严格体积闭环。

本工作包很大程度消除了“FLAC 无法实际测量”的可观测性缺口，但仍不能宣布 B16 或完整理论初版完成。
