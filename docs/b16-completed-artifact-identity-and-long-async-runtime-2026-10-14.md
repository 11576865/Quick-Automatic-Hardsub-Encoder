# QHE B16 — 完成成品身份绑定与同步/异步逐流审计

日期：2026-10-14
状态：实现提交到 PR #105 工作分支；精确新头部 Windows B16 运行及 Node CI 尚待执行。
边界：当前成品 FFprobe 真实性，**不是**未来 FLAC 预算预测证明。

## 问题

先前实际 Windows B16 专项、真实 Native HTTP 全段/裁切 FLAC 任务和最终混合封装包字节测量已经通过。但输出回执在客户端只有 `audioPacketBytes` / `subtitlePacketBytes`，无法独立辨认回执属于哪个正式 Native 作业、哪个 staged artifact、哪个文件版本。短片同步审计返回后，也缺少针对缓存回执的成品文件变更检查。

这与“来源／源流计量 ID 必须绑定”是同一种工程完整性问题，但属于**输出域**而不是输入域。单纯返回 `verified:true` 和几组包字节不构成可复用的跨作业文件身份。

## 本批合同

1. Native `Get-CompletedTrimPacketEvidence` 与 `Get-AsyncTrimPacketEvidence` 的通过回执保留 `scope:'completed-artifact'`，另附：
   - `artifactBytes`：扫描时的成品实际总长度（安全整数）
   - `artifactWriteTicks`：Windows staged 文件 `LastWriteTimeUtc.Ticks` 的**字符串**，避免 JS 超过 53 位安全整数后的舍入
   - `artifactJobId`：当前正式 Native Job ID
2. 同步审计扫描前后检查成品长度和修改时间。已经 `ready` 的同步缓存，在每次后续查询时重新核对 staged 文件，不再沿用已被修改的成品回执；异步原有 stat 检查继续有效。
3. `reconcileAuxiliaryMuxObservation` 必须同时验证 `completed.jobId`、`completed.outputBytes` 与回执中的作业 ID、成品长度和合法 Windows tick 文本。不满足条件直接输出 `unavailable`，而不是把两份孤立 packet totals 标记为相等。
4. 对真实 `compileTask`，`outputPlan.audio` 的 `outputOrdinal` 必须与 array index 一致，且实际成品音轨数必须与编译结果一致；软字幕输出计划按真正的 `{sourceOrdinal,action}` 对象匹配，输出字幕轨数和方法收据同样需要完全一致，禁止用其他音轨代替来源。
5. 回执属于**该次已完成成品的可比性审计**，返回值永远保留 `canReplaceFormalBudget:false`、`canCertifyFutureMux:false`。没有提高 Native FLAC 隔离预演的预算权限；预测和交付仍依赖正式混合文件实际字节大小与既定严格体积闸门。

## 执行与回归

- `src/auxiliary-mux-reconciliation.test.mjs` 补充不一致 Job ID、成品总字节、Windows ticks、缺失/多余/重排音轨、冒用 FLAC/复制预演方法和多余字幕流等拒收测试；使用实际 `compileTask` 流映射形状而非自造的数值字幕映射。
- `scripts/check-flac-native-http-lifecycle.ps1` 已有真正双音轨 FLAC Native HTTP 正式成品回归；本轮进一步独立 `Get-Item` 核对回执文件版本，随后修改 staged 成品，要求下次 `/api/jobs/{id}` 返回 `outputPacketAuditState:'unavailable'` 和空审计回执。
- `scripts/check-b16-long-async-output-identity.ps1` 新增真正 **182 秒**、32×32、1fps 的低复杂度源，完整通过 Native FLAC 正式任务/超过 180 秒的异步 FFprobe 分支，对比独立 FFprobe 包字节，并修改文件检查 `ready` 回执失效。它是低成本的时长/生命周期验收，**不是**复杂真实视频的速度或质量基准。
- 专项 `.github/workflows/windows-b16-runtime.yml` 在 Draft PR 上执行上述两个 Windows Native 测试，并继续运行真实 FLAC/裁切复制 oracle、Node 收据门禁与 PowerShell 5.1 语法。
- 本地通过隔离纯 JS 函数行为测试；真实 Windows/完整 Node 的最新提交结果 **Pending**，只有独立运行完成后方可签收。

## 后续理论缺口

当前作业中的音视频/字幕最终包字节、固定头部开销、实际输出总大小是不同成本坐标。要让 **FLAC 预编码证据进入正式未来体积决策**，还需要同任务媒体执行参数/时间戳/源流映射的可重复性、能够控制最终 FLAC 音频复用路径、容器余量和严格上限失败回滚机制。当前未实现该升级；不解除严格体积模式对 FLAC 未知预测成本的拒绝，也不宣布 B16 完成。
