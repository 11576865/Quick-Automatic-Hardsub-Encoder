# WU-07 P2 · 来源绑定音轨“必须 Copy”保留合同

原始依据：R19 §03/§16 P2、R24 §05/§11 的独立 UserIntent must-preserve 与原音轨身份、逐轨动作保留要求。

正式能力：在现有逐音轨计划增加每条轨道的“必须 Copy”显式勾选；勾选会把该轨目前的操作改为 Copy，随后 `compileTask` 以同一个正式 schema-v4 任务接管约束。再次在 UI 改成 AAC、Opus、FLAC 或删除时**不悄悄解除锁，也不自动覆盖冲突**，而是拒绝方案；用户可明确解除勾选或取消恢复全局策略的提示。更换视频来源清空源绑定的 UI 锁；导入旧配置即便携带锁也需要当前来源证明，否则编译器拒绝。

限制：本锁只约束源音轨存在与 codec-copy 的**计划**，不保证成品包 SHA、语言标签、实际 PTS/采样精度/完整音画同步已验证；音轨的 full/trim 时间范围仍按用户原有设置。这是 R19 P2/B02/B05/B06/A02 的一项有界真实产品能力，并非全媒体的 signed UserIntent 或 P2 完成。

验证计划：三工作流正常 Task v4、混合 FLAC/AAC 异构 audioPlan、冲突拒绝、换源失败封闭、真实 Chromium 勾选/取消及再编译。当前提交等待 exact-head CI，外部 Windows/A02 完整文件证据分别保留开放。
## 精确验收结果

被测 SHA：`38d4b04e8b1edfac99dc3116f4931c310b075d08`。
真实生产工作台 Chromium + 正式编译器单测：https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38580653413（SUCCESS）。
前端全局与 UIGS Evidence Coverage 分别为 `38580653495`、`38580653198`（SUCCESS）。

用户设置源 FLAC a:0 的 must-copy 锁，同时设 AAC a:1 重编码并执行受控后端：正式 task 保留两个音轨，lock 位出现在 OutputPlan。试图把锁定轨改为 AAC 会保留锁并让 `compileTask` 拒绝；取消确认的“恢复全局音频策略”保持锁，确认后才解除；换来源后锁与旧来源键同时清空。

这是‘用户意图防静默改码/丢轨’的可执行产品行为，不代表真实 Windows 成品包完全等价，也未验证所有输入音频的 language/title/disposition/时间基，P2/A02 未整体签收。
