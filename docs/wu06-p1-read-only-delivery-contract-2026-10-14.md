# QHE WU-06 · P1 只读领域交付合同投影

原报告：R19 §03/§16 P1 和 R24 §05；追踪 B02/B20/B24。

## 正式实现

基于唯一权威 `compileTask` 输出（schema v4）和已探测源媒体快照，在 `src/delivery-contract-projection.js` 生成深冻结的只读投影，分别展现 SourceAsset 标识、SourceStream 逐流事实与 action、从正式任务推导的 UserIntent、旧编译器已有的 OutputPlan、正式 FFmpeg 参数以及未由该投影取得的 ArtifactRecord。工作台原有任务检查器提供可展开入口，来源变更后投影失效。无第二个可编辑 task，也无额外编码器或执行后端。

对存在明显视频流 `-map` 缺失、编码器不一致和 ASS 硬压滤镜缺失的情况返回 `review-required`，只做诊断，不擅自纠正命令、丢弃已完成文件或改变用户配置。该报告是对现有编译器能力的可解释化，不是 P1 新架构所有权迁移。

## 托管验收

- Tested SHA: `0124946d6939f73a285dcf609a6a973924d44219`。
- WU06 Node official v4 compiler and real Playwright Chromium: https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38575999722 SUCCESS。
- Test frontend run 38575999605 SUCCESS，UIGS Evidence Coverage run 38575999820 SUCCESS。
- Chromium 证明不同工作流展示真实 `-c:v`/`-map`，SourceAsset 身份可查、并在变更来源后清空旧编译合同；只读检查时不会开始执行任务。

## 开放与禁止推断

不具备独立 UserIntent 的用户签收与保留约束所有权；没有取代后端的 ImmutableJobPlan；没有新成品哈希/逐流/时间/播放器验证，也没有多来源 B21 和真实设备完整验收。P1 只是 owner-approved ‘first-stage read-only projection’，不能从专项 Chromium CI 推断全部 B02/B20/B24 关闭。若未来进行正式状态迁移，必须以实验和产品授权作为新的工作单元。
