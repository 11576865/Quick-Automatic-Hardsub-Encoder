# 硬字幕压制工作区重设计报告

日期：2026-10-02  
状态：实现中 / 设计基线  
范围：Quick-Automatic-Hardsub-Encoder 的硬字幕压制功能与 UI；纯视频转码、无损快速剪切仅做兼容性调整。

## 1. 问题定义

当前界面同时存在两套硬字幕压制控制面：

1. 原有“预检 → 真实 libass 预览 → 快速预设 / 目标质量 / 目标体积 → 正式压制”的引导路径。
2. 新增的统一媒体工作区，其中又包含 codec、preset、CRF/CQ、码率、尺寸、帧率、滤镜、音轨、封装、试压和另一枚“开始硬字幕压制”按钮。

两套系统同时出现时，用户无法稳定回答三个问题：

- 现在应在哪一处决定最终输出？
- “目标质量 / 目标体积”与“CRF / 码率 / target size”哪一组是正式权威？
- 两个“开始硬字幕压制”按钮是否执行同一套参数？

这不是视觉密度问题，而是执行语义重复。

## 2. 重设计目标

硬字幕压制应只有一条用户工作流：

```text
选择素材
→ 媒体 / ASS / 字体预检
→ 真实 libass 预览
→ 选择控制方式
   ├─ 目标控制：快速 / 目标质量 / 目标体积
   └─ 参数控制：codec / preset / CRF / 帧率 / 尺寸 / 滤镜 / 音轨
→ 正式执行
→ FFprobe / 完整性验证
→ 保存成品
```

“目标控制”和“参数控制”不是两个产品，也不是普通/专业权限分级。它们是同一任务的两种控制表示；共享素材、预检、预览、原生后端、任务所有权和输出验证。

同一时刻只能显示一套正式执行入口。

## 3. 外部研究

### HandBrake

HandBrake 将字幕处理与编码设置分离，并将 Preview 作为耗时整片编码前的短样本验证入口。其文档明确把 Preview 用于测试当前设置在一小段源视频上的实际结果：

- https://handbrake.fr/docs/en/latest/advanced/subtitles.html
- https://handbrake.fr/docs/en/1.9.0/workflow/preview-settings.html

可借鉴点：预览是正式编码前的验证环节，而不是编码参数表中的附属按钮。

不照搬点：本项目需要 ASS 字体依赖、libass fontselect/fallback、风险采样、跨 Windows/Android/Web 后端，因此不能退化成单一“字幕轨道”页。

### Subtitle Edit

Subtitle Edit 的 Burn-In Subtitles 把字体/字幕表现、视频编码、音频、裁切和目标体积组织为一个明确的“生成烧录视频”任务，并使用 libass 进行真实预览：

- https://github.com/SubtitleEdit/subtitleedit/blob/main/docs/features/burn-in.md

可借鉴点：参数可以很专业，但必须围绕一个明确的生成任务组织；编码器只显示实际可用能力。

不照搬点：本项目已经有更强的字体静态分析、运行时 fallback 诊断、真实样本比较和原生长任务所有权，不应为了视觉简化删除这些证据层。

### Shutter Encoder

Shutter Encoder 的公开说明采用“先选择视频编码功能，再在相关区域添加字幕”的上下文方式：

- https://www.shutterencoder.com/en/faq-tips/

可借鉴点：字幕控制应出现在会使用字幕的编码任务内，而不是成为与视频处理并列的另一套全局设置。

## 4. 新的信息架构

### 4.1 顶层任务选择

顶层是三种互斥操作：

- ASS 硬字幕压制
- 纯视频转码
- 无损快速剪切

它们是“任务类型”，不是流程步骤，因此 UI 不再使用 01 / 02 / 03 暗示顺序。标签改为 ASS / VIDEO / COPY。

### 4.2 硬字幕压制五阶段

顶部流程条固定表达：

1. 素材
2. 预检
3. 预览
4. 方案
5. 压制

纯转码和无损剪切切换为各自的三阶段流程，避免仍显示字幕专属步骤。

### 4.3 控制方式

完成素材分析并进入制作阶段后，出现“选择控制方式”；正式执行仍由真实 libass 预览门槛约束：

**目标控制（Goal Driven）**

用户表达连续目标：

- 快速预设
- 目标质量
- 目标体积

系统负责把目标映射为编码参数，并保留测试片段、SSIM 校准和编码器比较。

**参数控制（Parameter Driven）**

用户直接控制：

- codec / encoder
- preset
- CRF / CQ / bitrate / target size
- FPS / resolution / pixel format
- crop / deinterlace / scale / rotate / filters
- NVENC 专项参数
- audio / tracks / metadata / attachments

该模式不绕过预检或真实预览。

## 5. 状态与执行契约

两种控制方式共享：

- `state.video`
- `state.ass`
- 字体与 fallback 诊断
- `workflowReadiness()`
- Native owned job / browser encode lifecycle
- 输出 staging
- FFprobe / packet / stream validation
- 保存流程

UI 只允许当前控制方式对应的正式执行按钮可见。

切换控制方式不改变素材、不重新分析、不清除真实预览，也不修改 ASS。

## 6. 响应式行为

桌面 / 大窗口：

- 真实字幕预览继续保持在 production 区主视觉位置；
- 右侧只显示当前控制方式；
- 参数控制工作区进入同一 production context，不再插在素材卡与预览之间。

手机：

- 控制方式两项纵向排列；
- 参数控制继续使用单列、折叠高级参数和非 sticky action dock；
- 不复制另一套移动端业务模型。

## 7. 本次实现

本次 PR 完成：

- 将任务切换器的 01/02/03 改为 ASS / VIDEO / COPY；
- 硬字幕顶部流程改为五阶段语义流程；
- 新增“目标控制 / 参数控制”互斥控制方式；
- 默认显示目标控制；
- 参数控制工作区只在用户主动切换后出现；其参数可提前配置，但正式执行仍要求真实 libass 预览满足既有 readiness 门槛；
- 参数控制工作区移动到真实预览之后的 production context；
- 纯转码与无损剪切仍直接使用统一媒体工作区；
- 任务概览识别参数控制模式；
- UI smoke 增加“同一时刻不能出现两套硬压执行面”的回归测试。

## 8. 尚未在本次强行统一的内部实现

当前“目标控制”的执行逻辑和“参数控制”的 `compileTask` 执行逻辑仍有两条内部代码路径。

本次先修复用户层语义冲突，不在同一 PR 中强行重写编码核心。后续应评估是否把目标控制最终也编译成同一个 task schema，使两种控制表示最终汇入一个 canonical task compiler。

在完成该迁移前，不应宣称内部已经只有一个编码计划模型。

## 9. 验收

必须满足：

- 硬字幕默认只看到“目标控制”的正式执行面。
- 切到“参数控制”后，目标控制的输出策略和执行卡隐藏。
- 切回目标控制后参数控制工作区隐藏。
- 两种模式都必须通过 `workflowReadiness()` 的字幕分析与真实预览门槛。
- 切换到转码 / 无损剪切后，不显示硬字幕控制方式和字幕专属 production 区。
- Windows / Android / Web 不复制独立业务 UI。
- 桌面和 390px 手机视口无水平溢出。
- CI 保持现有 parser、媒体 task、真实 FFmpeg、Windows Bridge 和 Android 编译边界。
