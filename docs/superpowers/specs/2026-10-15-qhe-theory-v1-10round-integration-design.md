# QHE 理论初版：10 轮 / 3 天集成冲刺设计

> 日期：2026-10-15。性质：产品集成设计（Spec），不是实施或验收记录。
> 目标候选日：2026-10-18。计时前提：存在连续的实际执行会话或用户接续运行；聊天回复本身不会在后台开发。

## 1. 目标与权威范围

**目标**：复用当前代码，在不改变 QHE 初版定义的前提下，优先完成一个可实际操作的 Windows Native 纵向闭环，贯通
「来源/用户意图 → 统一编译任务 → 有限实测决策 → 显式采用 → 真 FFmpeg 编码/剪切 → 独立成品核验 → 导出及报告」；同时整理三工作流、批次矩阵、Web/Android 能力状态。

**完整范围权威**：
- R19：《QHE_未来产品架构与压缩决策工程研究报告_2026-10-12_更新版(1).pdf》，全篇及 P0–P5、A01–A10。
- R24：《QHE_产品定位与压缩决策_聊天讨论综合研究报告_2026-10-13 (1).pdf》，全篇。
- `docs/initial-version-report-traceability-2026-10-13.md` B01–B25；`docs/qhe-initial-version-route-reanchor-2026-10-14.md`。
- 这十轮只是达到**理论初版基本实现**的加速冲刺；不以十轮交付代替原报告初版全部验收。不擅自把未实现内容延期或删除。报告中的提案、实验与可选项仍按原意处理。

**成功判断**：至少 Windows Native 上，ASS 硬压、纯转码、Stream Copy 都可用现有 UI 指派同一个权威任务编译器执行并得到独立可检验的实际文件；Guided/Manual 测量证据不串域，真实候选选择可经过独立 VBR 验证后显式采用；复制/转码音轨策略与完成文件一致；明确区分预测、验证、UNSUPPORTED 与 FIELD-PENDING。不能只靠模型单测、控制器模拟或屏幕截图判断闭环。

## 2. 当前冻结基线与禁止行为

核对于 2026-10-15：
- `main`：`de8bfb476b7f35b952db88bcaf5b4d2c9ed44d38`。
- PR #104：`0feed738042745ace6c031f726a3ad93561e56e8`，Draft，目标 main；真实 Windows 多编码器与复杂 MKV 证据已存在。
- PR #105：`815b743f7f8137c2aa7b1c6fa06722558037c2de`，Draft，叠加 #104；来源于这条提交的 **独立冲刺分支** `feat/qhe-theory-v1-10round-20261015`。
- 既有 10 月 14 日 PR #105 同提交部分工作流 Success，Android/其他 Windows 全量工作流 Skipped，不能算全绿。
- 既有真实 Windows WU02 内封 ASS+字体/双音轨及 WU10 保留 FLAC 包哈希已通过限定 CI，但不是任意用户素材的全部保真声明。
- 当前 Web `src/engine.js` 依赖 `./vendor/ffmpeg-kit-next-web/dist/index.js`，构建目录实际缺核心。Chromium 受控编排不是 Web FFmpeg 端到端完成。

**不可改变**：
1. `src/media-task.js::compileTask` / v4 是唯一正式任务编译器；不能建立第二份 Guided/Manual 或 batch 参数真相。
2. 源、ASS、字体、复制流与实测质量参考有独立身份；不可跨来源、跨字幕参考复用不相容证据。
3. 严格体积上限只能由经过实测成本准入与**成品实际总字节**确认；CQ 样本不证明 VBR/成品体积或整片画质。
4. 未请求变更的音轨、字幕、章节、色彩、时间轴不得默默被改变。未知或不支持时失败封闭并向用户显示原因。
5. 不进行未经批准的主线合并，不改变现有文件保护/失败重试/撤销逻辑，不擅自用第三方 GPL 源码替换项目 MIT 实现；先借鉴算法与测试，确需移植先做许可复核。
6. 每个增量先提交到可恢复分支，精确 SHA 与 CI 状态分离；CI 排队不得被称为 PASS。

## 3. 设计选择

### 选择 A（采用）：以现有 #105 栈为集成主体，按真实可用产品模块收敛
- 保持 `compileTask`、`media-stream-plan.js`、`whole-file-frontier.js`、`decision-reference-scope.js`、`shared-evidence-decision.js`、`guided-branch-adoption.js`、`manual-transcode-adoption.js`、Windows Native Bridge、`outputReport` 为权威。
- 对缺口仅作最小适配和必要回归；以上游 ab-av1/LosslessCut/HandBrake/StaxRip/ffmpeg.wasm 的源代码作实现参考，而非整套框架迁移。
- 按用户可操作的端到端结果组块交付，每组块可多次小提交；十轮不是十个相互独立的微型 PR。

### 备选 B（不采用）：从 main 重写新的任务/媒体领域核心
风险：大量重复、旧 API/数据结构分裂、难以在三天窗口内验证。

### 备选 C（不采用）：仅把已有 Synthetic CI 全部调整为绿色后宣称完成
风险：把受控 fixture 当作真实可交付成品，违反 B01/B24 和后端现实边界。

## 4. 组件与数据流

```text
SourceAsset + selected streams + ASS/font reference
    ↓ identity/probe + per-stream user intent
Existing UI (Guided / Manual / Stream Copy / Batch)
    ↓ single task snapshot + compileTask(v4)
Immutable compiled execution inputs
    ↔ bounded Native CQ/VBR measurements (matching reference only)
    ↔ sizeBudget / wholeFileLedger (whole-file coordinates)
    ↓ explicit user approval where proposal changes execution
Native adapter (Windows primary; Android/Web independent capability gates)
    ↓ staged output + verify source/actual stream/timeline/bytes
Verified artifact + outputReport + save-only retry + task inspection
```

**状态机约束**：SourceReady → IntentFrozen → PlanCompiled → Executing → StagedOutput → Verified / Rejected → SaveHandoff → Saved/SaveFailed；中途来源、字幕、字体、体积或候选变化必须使依赖证据失效；失败后的重试不得覆盖已验证旧成品。

**错误处理**：对未知流成本、不兼容证据、未验证的剪切精度、缺 Web Core、缺真实 GPU 或无设备时显式使用 INCOMPATIBLE/UNSUPPORTED/PENDING，不偷偷退化承诺。各后端具有共同业务语义，但不强制支持相同 codec。

## 5. 十轮切片（每轮交付独立可验证结果）

| 轮次 | 产品块/实现重点 | 原报告锚点 | 明确完成证据 |
| --- | --- | --- | --- |
| 1 | 当前栈与源码复用审计；创建安全分支、设计、持久任务、最小稳定基线 | B01/B24/B25 | 精确 SHA、差分清单、无误称 PASS/merged |
| 2 | 核对并集成 Guided/Manual/Copy 的编译/状态身份；补真实 UI→编译回归 | B02–B05/B11 | 操作不丢意图、实际 `compileTask` 参数/回滚一致 |
| 3 | Windows Native 复杂 MKV：内封 ASS 字体、FLAC copy + AAC/Opus 转码、成品独立报告 | B05–B07/A01–A03 | 真 FFmpeg/FFprobe + 字体/音轨和时间元数据检查 |
| 4 | P3 共用同源/参考门禁、有限 CQ 比较、VBR 实测、显式采用、正式输出 | B11/B12/B14/B15/A05/A06 | 真实候选→正式 Job→实际成品闭环，失败失效 |
| 5 | 整文件成本坐标与严格大小策略，复用 B16 预检/收据，不凭测试推算保证 | B13/B16/B17/A07 | 已知成本可编译、未知成本拒绝 strict、输出总字节门禁 |
| 6 | Cut 快速复制与重编码选择、PTS/DTS、B 帧/VFR 独立切点验收 | B08/B09/A04 | 请求/实际切点和同步证据或准确的未验证警示 |
| 7 | 冻结多来源/多输出任务矩阵→权威编译→批量实际输出与失败重试 | B21/B17/A08 | 两来源/两任务独立成品与 save-only 重试 |
| 8 | Android/Web 实际能力与 runtime gap，优先复用现有适配器 | B18/B19/A10 | 实测路径或精确 UNSUPPORTED / FIELD-PENDING，Web Core 不伪通过 |
| 9 | 在同一版本运行版本化黄金矩阵，追加实际边界/回归和 UI 可见证据 | B10/B20/B23/B24/A01–A10 | 合成/真实设备/播放器证据逐项标明、不可泛化 |
| 10 | 审查、集成候选、完整回归、可复现运行交付和未完成原报告缺口 | B01/B24/B25 | 精确提交、必要 CI、实际成品、报告范围差距，不自动发布 |

轮次在三天内可并行准备，但任务身份/独立输出检查为下游前提；不得用时间限制删改原报告要求。每轮前最多保留两个已授权 next units；执行两轮后重新锚定报告和差距。不向用户报告未经执行的结果。

## 6. 日期与暂停条件

- 第一天（10 月 15—16）：轮 1—3，重点是完整 Windows Native 单任务的可复现基础。
- 第二天（10 月 16—17）：轮 4—7，重点是压缩决策、整体预算和两种输出编排真实闭环。
- 第三天（10 月 17—18）：轮 8—10，重点是能力验证、全面回归、交付候选和准确剩余清单。
- 日期是期望窗口，不是自动保证。若异步执行或未进入后续工作会话，保存 `.uigs/tasks` 续作；无后台持续执行承诺。
- 如发现 #104/#105 语义冲突、关键回归 FAIL、许可无法满足、无法得到实体后端证据或原范围被隐式修改，停止对应闭环、保留安全代码，并向用户提交具体 Blocker / Direction Review。
- **“基本实现”**：初版核心可在至少一个真实后端连续操作并被独立验收。**“完整初版”**：仍需两份报告全部适用的 B01–B25/A01–A10 闭环；其余未完成项显示 Pending 而非被重新命名为以后版本。

## 7. 自查与外部依赖

- 本设计不改变已有源码，未新运行 Windows/Android/Chromium、未产生额外 CI PASS，也未授权合并 Draft PR。
- 编码/采样缓存对照 ab-av1，剪切策略对照 LosslessCut/smartcut，编码队列对照 StaxRip/HandBrake；实际移植必须逐一核对原版 revision、运行语义、许可与回归。
- 若需要用户的 Windows 物理显卡、真 Android SAF 提供者、外部播放器或正式 Web 核心，分别报告 FIELD-PENDING 或 BUILD-PENDING；不以物理缺测而删除初版要求。
- 进入代码实施前依据此 Spec 编写可审查的 Implementation Plan 并由用户确认，选择最小中断的原生实施路径。
