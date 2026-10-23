# QHE WU11 Guided 逐轨显式采用 → Manual 正式任务（2026-10-23）

**基线** `main@c31f2ee6b61bb76341dba9b1527befc4420916fb`；原报告 R19/R24 及路线 B02/B04/B05/B06/B11/B13、A01–A03，验收 issue #107。PR #129 已以 **独立 Windows Native fixture** 验证同一个 VBR 成品 FLAC Copy / AAC 重新编码、内封 ASS 和字体以及码率、源包和成品；那次“显式采用”仍为自动 fixture，不是真用户点击。

## 本次真实 UI 接线
- 原 `audio-stream-plan-ui.js` 是由正式 `mediaTaskForm` 唯一拥有的 JSON 字段/锁编辑器，之前在 Guided 视图被隐藏。现在 Guided 也在共用输出面板提供同一个逐轨编辑器；没有第二套音轨选型状态，也不允许自动继承旧 Manual 音轨策略。
- `#guidedMixedAudioConfirm` 复用 `#guidedToManual` 原按钮：当存在非空逐轨计划但用户没有勾选本次确认，必须拒绝交接，而不是静默丢弃；改变来源或修改该方案会取消确认。UI 明确告知用户必须使用完整音轨范围、来源成本计量和重新计算预算/码率。
- `src/guided-explicit-audio-handoff.js` 在任何真实表单变更之前读已选每轨 `audioPlan`、`mustCopyAudioOrdinals`、`audioKeepSourceIdentity` 和来源当前 `full-source` 测量，要求显式点击、至少一 Copy/一重新编码、每 Copy 都由相同源锁定、整轨完整；使用生产 `guidedTaskSettings` 和唯一 `compileTask` 以真实复制流成本和编码预算重新算 best-effort 视频码率，生成**新** Guided 快照。
- 再经生产 `compileGuidedCpuHandoff`、`commitGuidedCpuHandoff` 应用并比对 DOM 实际回写的 schema-v4 输出；锁字段数组 `mustCopyAudioOrdinals` 必须 JSON 序列化，修复原有表单回写中隐含的 `[0]`→`"0"` 错误。
- 新快照不携带旧 Native 短样/SSIM 证书；任何预算身份、来源、逐轨、编译器拒绝、用户未确认都不能自动写入 Manual。仅成功后 UI 才转 Manual 并要求重新验证执行结果。

## 验证与边界
`src/guided-explicit-audio-handoff.test.mjs` 用受控媒体、实测格式预算负例检查来源漂移/锁丢失/未批准/非法轨道/目标码率重算及对原快照不变性。`scripts/check-wu11-guided-mixed-audio-ui.cjs` 在真正 Chromium DOM 点逐轨动作、保留锁、测量、明确勾选和交接；其 `run` 后端受控模拟，**不能**被称为同一真实 Windows Native 会话。原 PR129 的 Windows CI 仅证明 Native 端。所有新断言及完整前端、WU01 专项仍 **Pending exact-head CI**；未验证前不能合并 main。

仍开放：真实用户浏览器与 Native 后端同 Session 成品核验，真实设备/长视频/多轨语言、声道时钟与其他 Bxx/Axx 完整验收，以及真实严格体积上限；不因为本次 UI 入口而标 WU11 全部结束。
