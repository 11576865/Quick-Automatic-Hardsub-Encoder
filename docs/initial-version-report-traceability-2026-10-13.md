# QHE 初版：理论报告要求—实现—验收追踪

核对日期：2026-10-13。审查分支：PR #105，head `ba10fb966ee63168e03526afd09c02140c6aa04c`；执行代码验证身份为 `bbec19d5f6f537838ffe99e7d6127f7307831061`。本次修改只恢复范围和追踪，未新增产品能力。

## 完成标准与批准来源

用户在本会话明确纠正：理论报告就是初版计划。该指令覆盖报告早期的“长期提案/尚待批准”标签，也禁止把尚缺能力自行划为后续版本。初版完成标准以完整报告为分母；五轮交付、一个实验路径或 CI 绿灯仅是子集证据。

R19：《QHE_未来产品架构与压缩决策工程研究报告_2026-10-12_更新版(1).pdf》，§01–19/P0–P5/A01–A10。R24：《QHE_产品定位与压缩决策_聊天讨论综合研究报告_2026-10-13 (1).pdf》，§01–25，补充意图、可比性、时间成本、预算坐标与设计反证条件。

保留报告内部的概念解释、示意、可选、适配器实验和明确不应承诺条款；它们仍在追踪中，但不能被错误改写为“任意片源全局最优”“三端必须都具备VVC/HDR”或“自动采用”。不以这种区分删减初版范围。

## 追踪矩阵

“限定路径已验收”不等于这一行的全部要求闭环。“未确认”表示现有检查没有足够证据，不能凭符号搜索断言全仓库绝无实现。本矩阵是首轮来源核对，复杂链路仍需进一步逐路径确认。

| ID | 报告锚点 | 初版要求 | 当前状态 | 代码／证据 | 未关闭部分 |
|---|---|---|---|---|---|
| B01 | R19 §01、§16–19；R24 §23–24 | 初版以整份报告为完成分母，证据分层，旧能力不退化 | 范围记录错误，现纠正 | AGENTS.md；五轮任务记录；9 条 CI | 五轮交付是子集；无逐报告验收矩阵时不能宣布初版完成 |
| B02 | R19 §03；R24 §04–05 | 来源资源、轨道、用户意图、计划、冻结任务和实际成品分离 | 部分实现 | media-task.js；task-review.js；manual-sample-evidence.ps1 | 目前由表单/编译任务投影构成；完整来源/意图/保留合同及跨端身份需补齐 |
| B03 | R19 §05；R24 §06–09 | ASS、纯转码、Stream Copy 是完整且平等的工作流 | 已实现主要路径，验收有限 | media-workspace.js；main.js；clip-queue.js；Windows/Android CI | 复杂真实素材、旧路径完整回归和用户任务成本未全部验收 |
| B04 | R19 §03、§14；R24 §19–20 | 引导和专业视图编辑执行同一份任务，切换无覆盖 | 核心已实现 | shared-task-presentation.js；guided-task-handoff.js；shared-task-ui acceptance | 共享执行已验收；目标探索仍生成显式 CPU 模板；决策内核尚未完全共享 |
| B05 | R19 §03、§07；R24 §05、§11–12 | 逐流保留/变更意图、不可改变属性、冻结执行计划及成果证据 | 部分实现 | media-stream-plan.js；media-task.js；task-review.js | 输出投影已有，但未证明独立保留合同覆盖全部属性和任务生命周期 |
| B06 | R19 §07、A02/A03；R24 §11 | 逐音轨 copy/AAC/Opus/FLAC/drop，语言、声道、标志和时间对应 | 主要策略已实现，属性验收不全 | audio-stream-plan-ui.js；media-stream-plan.js；rich-MKV Windows fixtures | 真实多声道、多语言默认标志和延迟/降混组合未全部验收 |
| B07 | R19 §05、§07、§12、A01；R24 §07 | 内封 ASS 与字体依赖绑定、真实 libass 渲染和复杂几何验证 | 部分实现/需继续追踪 | ass.js；fonts.js；font-diagnostics.js；main.js；VVC ASS smoke | 已有外置输入和实际渲染路径；内封选择到字体绑定的跨端完整链不能视作已闭环 |
| B08 | R19 §06、A04；R24 §09 | 请求/实际呈现切点、复制包范围、音频时间映射和验证状态 | 部分实现 | media-task.js；native-bridge.ps1；device verifier；clip queue | actualStart 和关键帧预览不等于完整 requested/actual/PTS/DTS/A-V 时间审计；VFR/B帧/偏移真实验收待补 |
| B09 | R19 §12；R24 §04、§07 | 字幕事件、章节、音频时钟、PTS/DTS 与重基准一致 | 局部测试已有 | media-stream-plan integration；rich MKV and device verifier | 边界事件、非零偏移、VFR、完整音轨配裁切视频的综合矩阵待补 |
| B10 | R19 §12、§18；R24 §16、§21 | 色彩变化必须明确，HDR/位深不能混同 | 保护性门禁已有 | media-task.js；media-capabilities.js | 保持不安全输入阻断；端到端色彩正确性/显示实验仍缺，不能以门禁等同色彩能力完成 |
| B11 | R19 §08–09；R24 §13–16、§20 | 共同参考上包络、证据域、CQ/VBR 分离、显式采用和回滚 | 限定路径已实现并 CI 验收 | manual-transcode-comparison/session/vbr-verification/adoption.js | Windows SDR 纯转码实证；ASS/引导与专业比较的统一合同仍未闭环 |
| B12 | R19 §08、§16；R24 §13–16 | 有界 codec × resolution × preset 候选与明确可比范围 | 有限交叉集合已实现 | manual-candidate-set.js：x264/x265 × medium/fast × 原尺寸/1080p/720p | 不能宣称完整候选适配；AV1、其他可用实现、ASS 渲染参考和高级处理的准入仍待完善；不追求无限全局最优 |
| B13 | R19 §09、§11、P3；R24 §14、§18 | 总文件目标与固定/编码音轨、字幕、附件、封装预算接入同一决策坐标 | Windows候选比较及单编码器已共享完整账本；上一轮9CI成功；本轮外部验收Pending | whole-file-frontier.js；transcode-calibration-panel.js；size-budget-adoption.js；245 local tests/build pass | 引导ASS预算决策仍待统一；单分支browser/native复验Pending；B16精确裁切/FLAC/跨端计量仍开放 |
| B14 | R19 §10、§15；R24 §13、§17 | 质量/大小/编码时间及资源与兼容条件的可解释取舍 | 部分实现 | manual-transcode-session.js encode-time quota；main.js 风险采样 | 配额限制不等于显示同预算候选耗时/收益，也不等于按用户时间意图选择；需真实成本呈现及策略 |
| B15 | R19 §10；R24 §17 | 风险场景、配对窗口、追加测量和不足证据结果 | 引导已有，专业未全面共享 | scene-risk-selection.js；calibration-refinement.js；main.js；Manual 两窗口 | 统一候选调度/风险覆盖；字幕高密度、暗场/噪声真实素材验证仍待补；不伪造统计覆盖率 |
| B16 | R19 §11；R24 §18 | 复制流精确范围成本、重编码音频成本、附件和余量完整计量 | 部分实现 | media-planning.js；Windows source-budget；whole-file-budget tests | 裁切采用全源保守预留；FLAC重编码拒绝；Android/Web计量缺；必须保留为初版开放项 |
| B17 | R19 A07/A08；R24 §18、§20 | 严格实际字节上限、取消、保存失败重试、来源变更和旧文件安全 | 主要机制已实现 | native-bridge.ps1；Android EncodeService；browser save fixture | 合成及模拟回归通过；真实提供者、重开成品、并发变更/磁盘不足场景仍需验收 |
| B18 | R19 §04、A10；R24 §10、§21 | 三端同业务语义，能力逐级探测，不支持明确拒绝 | 部分实现 | media-capabilities.js；platform adapters；三端 compile/CI | 三端无相同编码器承诺；浏览器大文件、Android生命周期/空间和用户机能力链证据待完善 |
| B19 | R19 §04、P4、§19；R24 §10、§21 | VVC/GPU/HDR 按适配器实验与证据边界推进 | Windows VVC合成链已验收；其余未关闭 | windows/vvc-runtime.ps1；required VVC CI | 许可/分发、目标设备与真实文件缺；HDR继续保护性阻断；报告实验性要求仍在矩阵，不擅自延期 |
| B20 | R19 §14、P5；R24 §19–20 | 任务中心、多尺寸、单主图、候选解释、回退和真实预览 | 主要展示已改，产品验收不全 | media-workspace.js；task-review；curve SVG；候选比较表；compact disclosure | 表格是报告允许的候选展示，不强制重复PR103虚线；信息收敛、真实载入态/字体/触控/可用性仍待验收 |
| B21 | R19 P5；R24 §19 | 批次矩阵与每项来源/意图/计划/执行/成果管理 | 综合矩阵未确认实现 | clip-queue.js 仅现有剪切片段队列 | 剪切队列不能替代多来源/多输出转换矩阵；需设计和接入统一任务执行 |
| B22 | R19 §13、P5；R24 §22 | 可选的版本化成果交换与跨项目证据语义 | 可选设计项未实现 | 现有outputReport/JSON，非正式ArtifactManifest | 保留报告可选性质，不强制合并产品；版本/身份/证据适配尚未建立，不把一般报告导出当成协议 |
| B23 | R19 §15；R24 §03、§23 | 同素材同约束的任务收益、操作/时间/错误率对照 | 缺少控制实验 | 报告列出HandBrake/StaxRip等对照维度 | 没有实际收益证据；不拿功能数量或编码器存在证明产品定位完成 |
| B24 | R19 §16–17；R24 §23 | 版本化综合黄金样本和 A01–A10 独立验收 | 部分合成矩阵，现场待补 | scripts/verify-stream-plan-v4-device-outputs.mjs；rich MKV；paired codec CI | 所有验收项必须分别绑定素材、后端、版本、PASS/FAIL/UNSUPPORTED/FIELD-PENDING，见下表 |
| B25 | R19 §16–19；R24 §24 | 完整范围关闭后集成和可安装/可运行交付 | 未完成 | PR104→PR105仍草稿且未合并 main | 不能以分支 CI 全绿宣布产品完成；报告缺项、产品审阅、集成与发布产物验收均需关闭 |

## 原报告 A01–A10 验收状态

| 验收 | 本次可以确认的证据 | 仍需补齐 |
|---|---|---|
| A01 内封 ASS+字体硬压 | 有 libass 预览/字体诊断和 ASS硬压合成测试 | 内封选择/依赖绑定/复杂字幕几何与真实字形独立验收 |
| A02 视频转码+FLAC复制 | Windows rich-MKV 包数据/PCM 对照，Android 合成成品矩阵 | 用户素材、首尾时间与设备现场 |
| A03 另一音轨AAC/Opus转码 | 逐轨编译、执行矩阵、成品codec/声道检查 | 多声道角色、语言/默认标志和延迟组合 |
| A04 VFR/B帧快速剪切 | 关键帧预览、实际起点、片段队列 | VFR/B帧/非零偏移完整时间审计与同步 |
| A05 共同参考多codec | Windows实际配对采样/CQ-VBR/证据域通过 | ASS和三端合同、更多可用候选与复杂素材 |
| A06 多分辨率 | 8分支/32CQ/2VBR合成Windows实验；采用尺寸检查 | 实际高分辨率用户文件、全片输出和观察 |
| A07 严格体积 | 后端成品/保存边界拒绝超限；合成/浏览器模拟 | 真实提供者/已有文件安全、重开和成本未知组合 |
| A08 取消/保存失败 | 共享任务跨视图回归；保存重试不重编码 | 真机中断/权限/空间不足与提供者行为 |
| A09 目标播放器 | 未找到可以覆盖产品承诺的目标设备证据集 | 实際设备/播放器/版本/成品身份 |
| A10 Android SAF/Web大文件 | Android模拟器8成品独立验证；浏览器模拟门禁 | SAF提供者真机和浏览器大文件/内存边界 |

## 继续实施顺序

1. B13+B16：把完整文件账本映射到决策预算轴；先证明只改变坐标/可行域，不冒充新质量测量、不继承失效证据。精确裁切、FLAC、跨端计量继续保持开放。
2. B04+B11+B12+B15：统一引导/专业决策语义与采样/参考身份，补 ASS 旗舰链、可用候选及风险追加测量；共享表单不替代共享决策。
3. B05+B06–B10+B24：逐流保留合同、内封字幕字体、时间/色彩安全与独立结果矩阵。
4. B14+B20+B21+B22：实测成本取舍、完整任务 UI、批次矩阵、可选成果交换。
5. B03+B18+B19+B23+B25：基线回归、适配器/真机/长片/播放器与对照任务验收、集成/安装交付。

这是依赖顺序，不是重新限定五轮，也不是另定长期版本。并行可行但任何项的延期/取消须有用户批准。不得据矩阵行数给完成百分比。

## 恢复与验证

主任务 `.uigs/tasks/qhe-initial-version-full-report.json` 接管完整初版进度。旧 `.uigs/tasks/qhe-five-round-delivery.json` 保留历史，明确只代表子范围。候选/预算/共享任务/手机UI任务继续提供局部证据。

实现 `bbec19d` 的9条 hosted工作流在本次重新读取时均为success；这只支持相应 fixture，不关闭上表缺项。没有修改执行代码，本轮无新编码/安装/真机/截图通过声明。

UIGS Intake：已去重并记录为 Case `inbox/cases/2026-10-13-qhe-report-baseline-cannot-be-replaced-by-scoped-ci-delivery.md`，Foundry提交 `c4299f7c4f058dcb640f7671e53ccbd2cb85c18c`；不修改Canonical。

## B13 实施补记

2026-10-13：Windows Manual 多候选比较默认改用完整文件目标坐标，调用现有逐流账本，加入复制流/附件、各轨时长的编码音频及封装余量。显式视频负载坐标只供诊断；坐标改变保留 CQ 测量、撤销旧 VBR。

采用事务写入目标体积/单位/余量/size模式/原交付策略，正式编译码率必须与已验证码率一致；任何不一致回滚。当前目标超域或不可行时不自动换成中点。成本未知时拒绝完整预算推荐。

验证：242 pass、9 conditional skip；7 真实 FFmpeg 回归通过；build通过。新增浏览器成本缺失/非零复制负载/坐标重投影无新采样/严格目标采用检查仍为 Pending；本地 Chromium不可用。B13 未整体关闭：引导与单分支语义、B16精确裁切/FLAC/跨端计量继续在初版范围内。

### B13 单编码器补记

单编码器面板改用同一完整账本及投影，移除原独立音频折算；在原声成本未知时阻断完整预算推荐。VBR证书绑定精确目标、参数、来源、成本快照；确认采用通过通用size事务保留当前编码器及交付策略，重编译码率/上限不一致即回滚。补行为测试验证完整音轨不随视频裁切时长缩小。

245本地测试通过、9条件跳过，build通过；浏览器成本快照变更和单分支size采用新增检查Pending。之前73c9470的9条CI已通过。本轮没有关闭引导ASS决策和B16成本覆盖；不宣称完整初版完成。


## 2026-10-14 B14 增量证据（未更改初版验收分母）

- `src/manual-time-tradeoff.js` 和 `src/manual-transcode-compare-ui.js` 将配对短样的真实 FFmpeg 编码时间与 SSIM / 视频码率并列展示，并新增下载范围明确的 JSON 观测收据。
- 只有原始来源 / 运行时 / 参考标识一致、且视频质量最小值与均值均在 0.003 内的 **已有实测 CQ 档位** 才提供近似同质对照。曲线在未实测视频目标处的拟合推荐不继承编码时间；整片时间、功耗和资源收益仍未验证。
- `src/manual-time-tradeoff.test.mjs` 与 `src/manual-transcode-session.test.mjs` 增加结构 / 失败封闭 / Native 会话到时间证据的测试。B14 分类维持「部分实现」；真实 Windows、浏览器与 exact-head CI 均 Pending。B04/B11/B12/B15 的 ASS Guided 统一决策合同仍未关闭。
- 详细范围见 `docs/b14-observed-quality-size-encode-time-2026-10-14.md`，当前进度在 `.uigs/tasks/qhe-initial-version-full-report.json`。



## 2026-10-14 B15 共用有界 Native 场景分层采样（未关闭其他初版条目）

B15 原有 Guided ASS 的 `scene-risk-selection.js` 逻辑新增 Manual 纯转码复用路径。新 `manual-paired-risk-plan.js` 对剪切范围输出两个不重叠窗口，使用原生 `sceneRiskOnly` 信号与明确 9 秒总探测预算；最多采集 3 处独立风险信号，失败则进入未标记为风险实测的时间分层计划。Native 视频 seekable 属性现在传递至 Manual media 预检，无法随机寻址/不足两窗时拒绝生成对比曲线。

源码：`src/main.js`、`src/manual-paired-risk-plan.js`、`src/manual-transcode-compare-ui.js`；回归：`src/manual-paired-risk-plan.test.mjs`。6 组源码等价隔离 JS 逻辑测试通过；真实 Windows Native、浏览器和 exact-head CI 待验收。两条链路共享采样策略，而非混用 Manual 原始 SDR SSIM 与 Guided ASS 字幕渲染 SSIM。B04/B11/B12/B15 均维持未整体关闭。


## 2026-10-14 B04/B11 统一决策参考身份（不等于完成全链路决策）

- `src/decision-reference-scope.js` 新增 Guided ASS 渲染参考与 Manual 纯转码原始 SDR 参考的显式身份；两者使用同一身份判断方式，但**不得直接交叉采用 SSIM/CQ 证据**。
- `src/main.js` 在完整 Guided 质量采样的风险预检前后、Native 异步采样前后、分支实测模型发布、曲线选择和正式 CRF 计划编制时检查 ASS 文本、有效字体元数据及强制/自动字体映射是否匹配原渲染参考。对不上则将模型视为不可用，而不是向新参考重投影。
- `src/manual-transcode-comparison.js` 为现有 Native source/reference/filter/window 证据附加 `referenceScope` 与纯转码域声明；`src/manual-transcode-compare-ui.js` 导出的观察收据保留该声明，VBR 实测和显式参数交接规则不变。
- `src/decision-reference-scope.test.mjs` 已纳入 Draft-fast 和完整前端检查；7 项隔离 JavaScript 纯逻辑测试通过。完整 Node/浏览器/Native 及真实修改字幕字体的 UI 测试仍待验收。缓存哈希仅供失效判断，不代表源文件完整性认证。
- B04/B11/B12/B15 均**未关闭**：完整 Guided ASS VBR/Manual 统一采用和回滚合同、复杂 ASS 字幕场景与实际成品仍待工程闭环。


## 2026-10-14 B11 Windows Native 真正 ASS 渲染参考的单遍 VBR 两窗验收路径

- 新增原生 `sampleExact + guidedRenderedReference + withSubtitles + measureSsim`，与现有 Manual `windows-native-exact-vbr-v1` 分开。Native 先以相同 ASS/font filter 构造 FFV1 渲染参考，再对实际 Guided 参数的 VBR 结果测 SSIM；不能使用 Manual 的无字幕源视频作为参考。
- Windows 源/FFmpeg 快照与 staged ASS UTF-8 SHA256、字体内容 SHA256 进入 `windows/guided-rendered-sample-evidence.ps1` 收据。Native Guide 硬件 p7/tune/maxrate/bufsize 与软件 preset/码率的实测参数按正式单遍编码路径选择；不借用 Manual 不同的 NVENC 参数。
- `src/guided-native-vbr-verification.js` 严格核对两窗、参考域、ASS 独立哈希、字体哈希一致性、实际编码器/码率/尺度及 SSIM；`src/main.js` 暴露 Windows-only 验证与“确认当前已验证参数”，确认仅针对**当前**配置，绝不自动修改编码器或码率，字幕/字体/体积/来源变化后必须重新验证。
- `src/guided-native-vbr-verification.test.mjs` 已纳入快测与完整前端。Windows 离线收据测试 `scripts/check-guided-vbr-evidence.ps1` 和真实 2× Native localhost FFmpeg/ASS 短样已接入 `Windows local smoke`；真实 Windows 以及前端 CI 最新头部运行 Pending。
- 严格文件上限与两遍 H.264 **不使用**此单遍 CQ/VBR 证明。完整跨候选 Guided / Manual 显式采用事务、整片质量与大小、设备/字幕系统字体验证仍未闭环，B04/B11/B12/B15 状态不晋升为完整初版已完成。


## 2026-10-14 B04/B11/B12 推荐分支 VBR 验证与原子采用增量

- 原 `adoptSizeFrontierBranchBtn` 会在未验证的 CQ 推荐上直接改变 Guided 编码器/分辨率；现在仅暂存不可变推荐提案，保留当前正式参数，使用 Native 精确 ASS 渲染参考两窗口 VBR 校验提案本身。
- `src/guided-branch-adoption.js` 将原编码器/分辨率、候选 branch、来源/字幕/字体渲染 scope、目标体积、视频码率、preset 固定为决策身份。验证结果须与提案及当前曲线匹配；显式确认才进入预览编译→写入→正式编译→执行字段对照，不一致或异常自动尝试回滚。
- Native NVENC Guided VBR 实测收据修复实际执行 preset `p7` 的声明和验证；此前 UI 通用 preset 不能代表真实硬件执行设置。候选输出容器现按提案 codec 校验，而非按旧选中 codec。
- 2026-10-14 新增 `src/guided-branch-adoption.test.mjs`、扩展 `src/guided-native-vbr-verification.test.mjs`，纳入前端 Draft-fast 和完整工作流；18 项隔离 JS 核心逻辑测试通过、主入口语法解析通过。真实 Windows FFmpeg/NVENC 和浏览器 UI 测试仍 Pending。
- 文档 `docs/b11-guided-vbr-branch-transaction-2026-10-14.md` 记载范围。此阶段是 Guided selected-state 事务，尚未把 Manual 正式字段编译/跨 UI 迁移/两遍与严格策略/整片结果完全归入同一可靠合同。B04/B11/B12 不作完成签收。


## 2026-10-14 B04/B12 引导→专业共同 CPU 正式任务编译合同

- `guided-task-handoff.js` 不再仅拷贝体积目标交给可编辑表单；`guided-cpu-compiler-contract.js` 在改变 UI 之前调用真正的 `compileTask`，按当前媒体及同源逐流测量校验完整任务的容器、软件编码器/preset、分辨率、预算字节数、可用视频码率、音频固定成本、4% 容器余量以及两遍/严格体积策略。新合同不允许自动移植旧 Native ASS 质量证据。
- 发现既有 Guided Native 是 **ASS 先渲染→bicubic 缩放**，Manual 默认是 **缩放→ASS 渲染**。共享 `media-task.js` 新增显式 `subtitleRenderOrder`（默认 `after-scale` 保持旧 Manual；交接用 `before-scale`），且 `media-workspace.js` 把该字段纳入真实表单/导入。交接必须核对生成的完整 `-vf` 而不只是分辨率。
- 交接之后实际重读 Manual 表单再调用 `compileTask`，执行计划不同则恢复先前参数并输出失败状态；执行字段一致才转换为 Manual 控制策略。Native GPU/Web/Android 的一致性并未被假定。
- `src/guided-cpu-compiler-contract.test.mjs` 使用仓库真实编译器、时长、音轨及预算函数执行 11 个隔离 JavaScript 用例，全部通过；Draft-fast/全量前端 CI 与真实浏览器/FFmpeg 动画字幕/滤镜顺序仍待验收。文档 `docs/b12-guided-manual-shared-cpu-compiler-parity-2026-10-14.md`。
- B04/B11/B12 均保持部分实现，完整 B01–B25/A01–A10 理论初版分母和重型 CI 退出条件不变。


## 2026-10-14 B16 编码前裁切复制流独立预演（非最终精确成本）

- 新增 `windows/trim-copy-preflight.ps1`，以 FFmpeg 对指定源中选择的音轨/软字幕做有界隔离裁切复制，使用现有 `trim-packet-audit.ps1` 独立逐包统计预演文件，按来源文件长度和精确十进制 FILETIME 字符串检查异步测量期间来源是否变更。
- `windows/trim-copy-preflight-bridge.ps1` 提供 Native localhost `POST/GET /api/trim-copy-preflight`：需要既有完整源流测量 ID，始终固定当前所选源，单飞异步启动与查询；来源变化取消原工作。JS `trim-copy-preflight.js` 只认可映射、起止范围、容器和来源均匹配的预演数据，并且永久保留 `observationOnly` / `canReplaceFullSourceBudget:false`，**不得**将独立辅助流预演误称完整视频混合封装的精确成本或降低现行原源流上界。
- `src/trim-copy-preflight.test.mjs` 8 项隔离 JS 校验通过；Windows Native smoke 新增含双音轨、软字幕的真实 FFmpeg 独立测量对照、错误映射拒绝以及 localhost 异步接口测试；线上实际 Windows/Node 验收 Pending。
- 此阶段只是下一步精确成本预测的可观测基础。真正完整任务裁切 seek/PTS、多路视频及附件交错、最终 mux 包选择、FLAC 重新编码成本以及 Android/Web 计量均未闭合。详见 `docs/b16-isolated-trim-copy-preencode-2026-10-14.md`。B16 和完整初版均未签收。


## 2026-10-14 B16 综合批次：多轨 FLAC 真实预编码、共享工作台观测及 Draft Windows 定向实测

- `windows/flac-encode-preflight.ps1` 现在能够对选定多个源音轨按 `full` / `trim` 分别保持来源区间与声道/采样率配置，实际用 FFmpeg 编出 FLAC，在独立 Matroska 辅助成品中通过现有 FFprobe 工作器逐音轨计包字节。输出不超过 1 GiB 临时文件上限，编码/扫描有界；超过有界时间不能外推为完整音轨成本。
- `windows/flac-encode-preflight-bridge.ps1`、`native-bridge.ps1`、`windows-native-client.js`、`main.js` 构成独立的来源绑定异步 Native 预演链；保守预算工作器与正式编码排他运行，文件 stat / 精确 `FILETIME` / `measurementId` 改变使旧回执失效。
- 共享 `media-workspace.js` 新增“实测 FLAC / 裁切复制成本”诊断入口。请求由 `auxiliary-preflight-request.js` 依据当前逐音轨计划及 IN/OUT 生成，只读展示包负载并且明确 partial/no-final-certificate 状态；`flac-encode-preflight.js` 与 `trim-copy-preflight.js` 均独立检查流映射与来源范围。**`media-planning.js::sizeBudget` 不变：未经最终混合任务证明的 FLAC 仍禁止进入严格体积预算，裁切复制继续完整源流保守预留。**
- 单独的 `.github/workflows/windows-b16-runtime.yml` 能在 Draft PR 中运行 PowerShell 5.1 语法、两个 JS 测试集、真实双音轨 full/trim FLAC 和双音轨/软字幕复制的独立 FFprobe 对照，不启动全部 Windows/Android/VVC 矩阵。
- 隔离模块测试 16/16 PASS，两个独立源码接线测试 PASS，`src/main.js` / `src/media-workspace.js` / `src/windows-native-client.js` 解析通过；本地 Linux FFmpeg 3 秒双 PCM 音轨真实 FLAC 命令得到 39300 和 27599 audio packet bytes。托管 Windows、浏览器和复杂实际音轨的实证仍 Pending。详细边界在 `docs/b16-flac-native-multistream-preencode-and-draft-windows-runtime-2026-10-14.md`。B16 和完整理论初版不能签收。


## 2026-10-14 B16 第二阶段：真实 Windows 通过后的 Native 混合 FLAC 成品逐流审计

- 已读取精确提交 `0bd2381c` 关联工作流：`Windows B16 runtime acceptance` run `38513613921`、`Test frontend`、`UIGS Evidence Coverage` 均成功。该 Windows B16 测试在实际 PowerShell 5.1 上运行 FFmpeg FLAC 双轨/裁切复制字幕而非仅做语法检查。
- 对真正的 `compileTask` 发现两个证据链阻断：原 Native `Get-CompletedTrimPacketEvidence` 只在 `copiedTrimReserveBytes>0` 时运行，而质量/码率 FLAC 无 `sizePlan`；原 `outputPlan.subtitles` 是对象数组，但成品对照按数字数组查找，默认 `all` 也只是符号映射。
- 本批将 FLAC 编码轨加入 Native 成品 packet audit 触发、展开字幕/附件完整来源轨号（不改变 FFmpeg 实际 `-map`）、修正对象映射和只读报告差值。新 `scripts/check-flac-native-http-lifecycle.ps1` 连接真实 Native localhost，验证 FLAC 预演状态、同源重新计量使旧证据失效，继而运行无 `sizePlan` 的正式质量模式双 FLAC 成品并独立复核两条音轨的包字节。
- 17 项仓库实际 JS 模块行为检查通过；`docs/b16-native-flac-finished-mux-audit-and-stream-map-2026-10-14.md` 记录精确边界。新的 Native HTTP/完成成品专项 Windows CI 和浏览器互动尚 Pending，B16 全部及完整理论初版不签收；孤立 FLAC 观测仍不得自动下调正式体积预算。


## 2026-10-14 B16 第三阶段：已完成 FLAC 成品包收据与真实文件/Job 身份

- 旧头部 `c54a8191` 的独立 Windows B16 真实 FFmpeg/Native HTTP、Test frontend 和 UIGS Coverage 已全部通过；此前同步成品 packet 和默认字幕映射合同已可通过真实平台。其它全部 Windows/Android Matrix 仍按 Draft 跳过，不算已验收。
- 本批使同步及长片异步 Native `outputPacketEvidence` 附加 `artifactBytes`、不经 JS 浮点舍入的字符串 `artifactWriteTicks`、`artifactJobId`。短成品在测量前后及每次后续读取均核对 staged 文件长度和修改时间，旧文件被更改就撤销回执。
- `src/auxiliary-mux-reconciliation.js` 必须核对正式作业 ID、完成成品字节数与 packet 回执身份、权威 `compileTask` 音轨输出次序/数量、完整字幕来源映射以及 FLAC / 裁切复制真实编码方法才能返回本次单作业可比较结果。任何错配返回 unavailable，不增加 `canReplaceFormalBudget` 或 `canCertifyFutureMux` 权限。
- `scripts/check-flac-native-http-lifecycle.ps1` 在通过独立 FFprobe 后实际修改短成品并要求回执失效。`scripts/check-b16-long-async-output-identity.ps1` 新增真正 182 秒低分辨率/低帧率 Native 正式 FLAC 编码和异步完成审计，独立复扫包字节并在修改成品后要求旧审计失效；两者接入允许 Draft 的 `windows-b16-runtime.yml`，真实长时长 Windows 精确头部 CI Pending。
- `docs/b16-completed-artifact-identity-and-long-async-runtime-2026-10-14.md` 描述输入/输出/未来预算证据界限。当前成品实际包字节是当前作业审计证据，不得当作下次 FLAC 预算的预测或交付保证；B16 和理论初版维持部分实现。


## 2026-10-14 B16 completed-mux 视频/音频/字幕实际包字节账本

- 已验证完成品的 Windows Native `outputPacketEvidence` 增加视频 packet total。短输出走原 30 秒 bounded FFprobe 同步扫描；182 秒以上或大于 512 MiB 输出走现有异步 worker，各视频/音频/字幕扫描有明确 120 秒及行数限制。
- 新 `src/completed-mux-byte-ledger.js` 按真实作业 ID、artifact bytes、NTFS ticks 以及 `outputPlan` 预期流数量核对每类 packet payload，计算 `otherAndMuxBytes = artifactBytes - videoPacketBytes - audioPacketBytes - subtitlePacketBytes`。其中包含附件、metadata、codec extradata、索引及容器头，**不是纯容器开销**。
- `outputReport.completedMuxByteLedger` 与共享工作台短/长任务报告显示该次实际成本，不允许作用于未来预测：`canPredictFutureBytes:false`、`canAuthorizeStrictBudget:false`。
- 新 8 项隔离行为测试 PASS，Draft fast/full 与 Windows B16 专项 CI 接线。Windows 真实短 Native、182s 异步 Native 以及 1v+2a+1s Matroska 独立 FFprobe 交叉验收已加入脚本，新精确提交的 Windows PASS Pending。
- B16 仍需严谨的 FLAC 已编码音轨复用路径和形式化预算成本准入，且需长篇/VFR/复杂 ASS、Android/Web 与成品交付端验收。未降低 B01–B25 / A01–A10 完整理论模型分母。


## 2026-10-14 B16 第五阶段：FLAC 已编码缓存逐包复用的真实证据和专门 Windows 运行验收

- 现有实际 Windows B16 Runtime `38534906483` 在头部 `9a503bfc` 已完成且全部步骤 PASS：多轨 FLAC、复制流、Native HTTP 来源证据与 182 秒完成成品视频/音频 packet 审计均有真实 Windows FFmpeg 证据。这不等于能提前预测 FLAC 音频大小。
- 改为用 FFmpeg **先实际编码 FLAC 一次形成缓存**，再在视频＋软字幕混合封装时用 `-c:a copy` 复用该编码结果。在本地 Linux 三秒双音轨例子中，缓存与最终 MKV 的 32 包/39,300 字节、21 包/27,599 字节均逐包有序 SHA-256 一致，不只是总字节接近。
- `src/flac-cache-reuse-contract.js` 以源内容 SHA256、缓存/成品文件 SHA256、来源测量 ID、作业 ID、NTFS FILETIME 文本、完整音轨源/缓存/输出映射、full/trim、声道/采样率、逐包有序 SHA256、实际 packet 数/总字节和视频/软字幕存在性，拒绝错源/错流/换码器/换区间/溢出/伪造的复用。
- 六项实际 GitHub 模块纯逻辑隔离测试 PASS；`src/flac-cache-reuse-contract.test.mjs` 增加真正的 FFmpeg 源→FLAC 缓存→完成视频和软字幕成品→FFprobe 每包哈希测试。新证据路径已加入 `Test frontend` 快速/完整 Node 和 Draft `Windows B16 runtime acceptance` 的 FFmpeg 后测试段（宿主验收 Pending）。
- 此批是**可重复执行的缓存复用证明实验**，并非生产任务已经接入缓存作为音轨输入；此前 source-only FLAC 预算拒绝仍在，`canAuthorizeStrictBudget:false`。生产 task 缓存持有/内容不可变/PTS 实际相同/余量上界/严格大小退出验收还要单独实现。文档 `docs/b16-flac-cached-packet-reuse-2026-10-14.md`。B16 与整体 B01–B25/A01–A10 均维持未闭环。

## 2026-10-14 WU-02: 内封 ASS／附件字体硬压新增产品能力的准确证据

**理论基线不变**：本节只追加新实现/验收证据，不替换原报告 B01–B25 和 A01–A10 分母。原有表格若标记 B07/A01 局部 Pending，以本节的精确实现范围理解为 **Windows Hosted bounded PASS + Field Pending**，不可自动提升整个条目为完成。

- **B07 / A01**：Windows Native 的源探测已能列出 MKV 内封 ASS 轨；新增显式导入入口、ASS 转存、附属 TrueType/OpenType 字体提取、源文件大小/写入时刻绑定以及原有 libass 引导/专业硬压链复用。真实 Windows localhost FFmpeg 验收 `38554433547` SUCCESS（被测提交 `1148bcda`）。
- **B05 / B06 / A02–A03 的一个实测组合**：带 1 视频＋2 音频＋1 ASS＋1 字体附件的 5.021 秒真实合成 MKV，正式 schema-v4 输出 H.264 + FLAC copy + AAC reencode；FLAC **235 包逐包有序哈希一致**，AAC 数据包变化，原字体的原始 SHA-256 一致，输出 MKV 为 **251,257 字节**；实际输出与无字幕事件的对照编码解码帧不同，证明字幕已真正烧入画面。原始软字幕及字体附件未在硬压成品中继续作为软流携带，这是该测试显式任务意图。
- **可反证边界**：错误轨号、不同来源和来源被篡改后的资源复用会遭拒绝。Windows 首轮红灯 `38554057407` 是独立验证器中 FFmpeg Filtergraph 对 Windows 绝对路径的解析错误，正式 Native 硬压已完成；修正独立验证器后同一范围通过。
- **仍开放**：Windows 客户端真实按钮操作可用性与完整交接 UI 浏览器验收、真实复杂 ASS/多字体字形几何、较长用户素材、用户设备和目标播放器、Android/Web 对内封资源的相应处理、其它独立功能 B08/B09/B21 及 PR #104/#105 合并发布。不能从 WU-02 专项推导整套 A01–A10 已关闭。

本次 WU-02 记录：`docs/wu02-windows-embedded-ass-source-import-2026-10-14.md`。持久任务记录要求在两项已授权工作单元后重新锚定理论目标，再决定下一项工作，不得按自生成新待办继续延伸。

## 2026-10-14 WU-03：B21 批量与配方的真实第一段实现（非全项完成）

R19 P5 的「批次矩阵」与 R24 §22「多个独立转码/烧录/剪切任务」对应本轮 B21。此前 `clip-queue.js` 仅做同一输入的多段 Stream Copy；当前 PR #105 新增**同一来源多输出方案矩阵**，可以冻结多个正式 v4 视频硬压/纯转码/复制任务，顺序执行后端运行/成品验证/独立保存，来源及字幕字体变化受到任务身份检查，失败不影响已保存成品，保存失败提供不重新编码的重试。

**限定证据**：提交 `7cdff9d`，`Test frontend` 38558570086 PASS、真实 Chromium 控件与受控后端 38558570169 PASS（x264/x265 两个冻结方案、错源拒绝、保存失败保留和重试）。这不是 Windows Native / Web FFmpeg 两条真实产物的批次验收。**完整 B21 多来源输入及跨来源计划/现场验收仍为缺实现/缺证据**，不得视为总目标完成。详见 `docs/qhe-wu03-single-source-multi-output-matrix-2026-10-14.md`。

WU03 完结后新的任务不得自动按照追加测试队列推进；必须再次比较 R19/R24 的其余 B01–B25/A01–A10 未关闭要求。
## 2026-10-14 WU-04 · 无损剪切的关键帧可行性与用户主动转码选择（B08/B09、A04）

**新产品能力**：正式工作台的 Stream Copy IN/OUT 模式现明确提示它不承诺帧精确；在当前来源、当前视频流与未失效关键帧分析相符时，给出“接近关键帧”或“可能提前 X 秒”的**预测值**，否则显示“未知”。选择其他来源/视频流后旧预测不再有效。用户可明确点击并再次确认改为重编码剪切，保留语义 IN/OUT、沿用当前编码参数；不能以旧的 Copy 方案假装输出帧精确或静默重编码。

**精确提交与通过证据**：QHE `501974713ad6ee3fc184b20bb1fbb2ed93fc5396` 的 `QHE WU04 copy-cut user decision acceptance` — https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38562833192 SUCCESS。实际 Chromium 中检验从 UNKNOWN → 估计提前 1.500 秒 → 换源 UNKNOWN、确认/取消、IN/OUT 等值、原正式 `compileTask` 产生 transcode trim 任务。`Test frontend` 与 UIGS Evidence Coverage 同提交 SUCCESS。

**执行状态区分**：新增的是剪切策略选择和信息真实性，不是任意位置 Smart Cut。`actualFirstPresentation`、`copiedPacketRange`、`audioTimeMapping`、`verificationStatus` 这些报告要求及 VFR/B 帧非零 PTS/DTS、音画同步和来源包哈希仍待真实文件独立验收。A04 不能标已完成。B21 单来源多输出产品切片已有 Chromium PASS，但真正多来源任务矩阵未完成。

**回归/外部环境**：这次迭代发现“未知切点”的空偏差被状态映射表达式提前格式化，错误进入 IN/OUT 表单有效性；已经修复并通过上述浏览器验收。Windows WU02 与 B16 的新一轮 CI 部分红灯归因 Chocolatey 503、FFmpeg 未安装或 PATH 未传播，未进入产品视频测试；历史 Windows WU02 成功 run 38554433547 仍有效。后续 CI 已加强可执行文件检查，但当前最新验证必须独立读取，不得提前称 PASS。

**方向门禁**：WU-04 有界产品切片完成，没有自动授权 WU-05。后续需重新按完整理论报告差距选下一条主线，保留初版范围和不合并 Draft 的身份边界。

## 2026-10-14 WU-05 · 成品 Copy Trim 首界 PTS/DTS/音轨实测收据（B09/A04）

**已新增并通过托管真实 Windows 验收的产品能力**：Windows Native 对已完成的 Stream Copy Trim 成品提供按需只读的 `GET /api/jobs/{jobId}/cut-timeline`，由 FFprobe 独立读取输出**解码首视频帧** PTS、首个视频编码包 PTS/DTS、每条输出音轨首包 PTS/DTS；检查成品文件字节数和写入时间，UI 将收据附入原有任务报告 JSON。原成品和交付操作不因时间轴诊断失败而被删除/禁止。前端另外在首视频帧与某音轨首包 PTS 相差超过 0.5 s 时提示需要人工复核，但这不是证明音画不同步的判定。

**实际证据**：被测功能提交 `cfed326a44412ba9a7f140ae4b39b526c4c3975b`。Windows 真实 B 帧 H.264 + AAC -> 现有 schema-v4 正式 Copy Trim，源 IN=2.400 s、OUT=4.800 s，实际完成成品 **58,863 B**。独立 FFprobe 在**输出时间轴**测到首解码视频帧 PTS **2.000 s**、首视频包 PTS/DTS **2.083/2.000 s**、首音频包 PTS **0.005 s**；Bridge 收据的首视频帧 PTS 与独立探测一致。Windows Native `38568220073` SUCCESS；真实 Chromium/model `38568219698` SUCCESS；Test frontend `38568219578` 与 UIGS Coverage `38568219823` SUCCESS。

**不能自动关闭**：`actualFirstPresentation` 此处是 *成品时钟* 的首解码帧，并不能从数值本身映射为 *来源时钟* 的实际第一呈现帧。`executionSeekIn` 是 Native GOP 寻址 hint；`copiedPacketRange=null`，`audioTimeMapping.sourceMappingVerified=false`；来源包 hash、成品尾端、整片 VFR/B 帧时间基、非零音频 priming 及播放器听看同步仍欠独立验收。上述首视频与音频包近 2s 的时间差值得排查，但不能仅凭两项首包数值判断播放失同步。A04/B09 **仅局部真实验收，条目整体未完成**。

相关 WU-05 报告：`docs/wu05-copy-output-timeline-receipt-2026-10-14.md`。严格遵循“验证的精确提交”原则，文档后续提交不替代这些实测 SHA。

防偏航：WU-05 结束后无自动 WU-06，重新以完整 B01–B25/A01–A10 对照确定新的产品能力优先级。

## 2026-10-14 WU-06 · R19 §03/P1 与 R24 §05 的只读交付合同投影（B02/B20/B24）

**理论原文方向**：来源（SourceAsset/SourceStream）→ 用户意图（UserIntent）→ 逐流输出计划（OutputPlan）→ 冻结执行计划（ImmutableJobPlan）→ 成品证明（ArtifactRecord）。报告的 P1 要求先以现有 `schema v4` 为唯一权威，建立只读投影，不得提前引入会修改 FFmpeg 的第二状态体系。

**新增产品能力**：现有任务审阅区可展开 SourceAsset 名称和当前稳定来源身份、每条源视频/音频/字幕/字体附件的 codec 与保留/删除/编码动作、由**已编译任务推导**的用户操作、逐流输出策略、真实 `-map` 与 `-c:v`/libass 执行参数。投影明确标注并不等于独立批准的 UserIntent，也不凭空生成 ArtifactRecord；明显编译映射矛盾仅提示复核，不能修改权威任务。换源后旧编译投影隐藏。

**精确验收**：代码提交 `0124946d6939f73a285dcf609a6a973924d44219`。`src/delivery-contract-projection.test.mjs` 编译真实 schema v4 三工作流并断言混合 MKV 视频+FLAC/AAC+ASS+TTF 各流动作、深冻结**投影**而不冻结原任务/不改 FFmpeg 参数，以及映射异议仅只读提示；真实 Chromium 点击正式工作台“验证当前方案”→ 展开逐流/命令审阅 → 切换 Stream Copy → 来源变更后旧视图失效。WU06 专项 https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38575999722 SUCCESS；Frontend `38575999605` 和 UIGS Coverage `38575999820` SUCCESS。

**严格剩余**：现有视图上的 `UserIntent` 是从真实 v4 任务推断的展示，不是独立持久化的 must-preserve / may-transform / user-approved 对象；`ImmutableJobPlan` 仅展示旧执行参数，并未额外实现后端不可变合同；`ArtifactRecord` 状态明确为未由本投影取得证明。尚缺来源跨后端稳定身份、复杂真实用户文件/目标播放器，以及 P1 逐一文件实测等价签收。因此 B02/P1 仅新的有界能力通过，整体未完成。

下一轮重新从 R19/R24 比较实质产品缺口，不默认围绕 WU06 增加测试或迁移状态所有权。

## 2026-10-14 WU-07 · 用户主动声明“此源音轨必须 Copy”并由正式编译器强制保护（P2/B02/B05/B06）

**新增用户能力**：现有逐音轨界面允许用户对某条原始音轨勾选“必须 Copy”。勾选以源文件身份和音轨 ordinal 绑定至现有 `schema v4` 任务，不另建音频任务所有者。正式 `compileTask` 对锁定轨 `drop` 或改为 AAC/Opus/FLAC，以及复制锁来源缺失／变化、无效与重复轨号都**拒绝生成可执行方案**。用户可明确解除锁或确认放弃锁后恢复全局策略；换来源会清除旧锁。与之并行，另一条未锁定轨仍可独立重编码。只读 OutputPlan/任务检查器显示锁定关系。

**精确证据**：`38d4b04e8b1edfac99dc3116f4931c310b075d08`，官方 v4 编译器单测涵盖 FLAC Copy + AAC 转码双音轨、锁轨转码/删除拒绝、错误来源、取消锁等；真实 Playwright Chromium 通过当前逐轨 UI 实际勾选、计划检查、受控 run hook 接收到同一 v4 Task、冲突后拒绝、确认前不解除锁、换源失效。WU07 CI https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38580653413 SUCCESS；Frontend `38580653495`、UIGS Coverage `38580653198` SUCCESS。

**未解决的验收边界**：“必须 Copy”是执行计划中的 copy/no-drop 约束而非 *源文件与成品音频数据包逐字节相同的签收*；真实字幕、附件、语种标签、音轨 disposition、范围剪切、VFR/B 帧音画同步、外部播放器与三端介质执行仍缺相应独立证据。既有 WU02 曾在特定合成 MKV 上验证 FLAC packet hash（235 包）但不是这一来源保留锁的精确任务执行，不能替本次补齐 A02。R19 P2 和 B02/A02 均**部分实现，未整体关闭**。

本轮不授权自动追加 WU08；下一步重锚完整理论模型剩余实质功能。

## 2026-10-14 WU-08 · B21 真正多来源批次矩阵的 Web 端切片（非完整 B21）

**原报告依据**：R19 §16 P5 批次矩阵；R24 §22 QHE 多个独立转码/烧录/剪切任务；B21 同时要求每项来源、意图、计划、执行、成果分别管理。WU-03 只支持同一来源多个输出；WU-08 新增 1–8 个用户显式选定的浏览器 `File` 对象，每个来源可带加入时冻结的 Copy 或 Transcode 参数，不再要求它们是一个视频文件。

**实现**：`src/browser-source-batch.js` 验证 File 对象身份、名称/体积/修改时间，拒绝同名同体积同时戳的歧义、超出 Web 1 GiB 上限和直接借用另一来源的逐轨音频计划、must-copy 锁、硬字幕附件或严格体积证据。工作台保存各文件的原始 File 句柄与设置快照。执行时逐个切换主视频 File、重新探测、交给**原有唯一 schema v4** `compileTask`、校验再执行；每项成品独立交给浏览器下载。失败时停止后续来源且已移交的输出不会重新编码；保存失败只重试保存，清空完成记录后可以再加入下一批。

**交付语义**：Web 的 `browser-download` 是浏览器下载移交，不是磁盘写入被独立核验。界面明确显示 `已交浏览器下载（落盘待确认）`，不会因受控浏览器 `hooks.save` 返回成功就把 `ArtifactRecord` 标为已在目标磁盘保存。重复编号或完结记录塞满 8 项的可用性问题已修复。

**精确托管验收**：源码与测试 SHA `2b42a49e94ab3fbec991451807791a5b113a4892`。真实生产 DOM + Playwright/Chromium 将两个**实际 File 对象**加入队列，验证当前表单后改质量参数不影响快照，不同来源各自生成正式 v4 任务、受控执行后分别移交下载；第二个来源保存失败只重试保存（不重做编码），清除完成记录后再次加入另一组来源。WU08 CI https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38588049167 SUCCESS；Test frontend `38588049084` 和 UIGS Coverage `38588049025` SUCCESS。

**不计为关闭的内容**：这次执行端为受控 hooks，而非两段真正通过 WebAssembly FFmpeg 编码的成品。Windows Native 多文件路径、Android SAF 授权、内封 ASS+不同文件字体资源、完整多来源多输出组合、真实文件下载落盘确认、用户长片与播放器适配仍为 B21/A 系列缺口。P3 决策核和 B25/PR 合并也未因 WU08 自动完成。

已授权任务完成，重新以原始报告判断下一条产品缺口，**没有自动授权 WU-09**。
