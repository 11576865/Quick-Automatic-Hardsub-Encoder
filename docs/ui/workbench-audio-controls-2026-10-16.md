# 中央逐音轨正式设置接入 · 2026-10-16

## 范围与来源

用户继续推进基础功能；依据 R24 §11 的“全局音频默认不能替代轨道级覆盖”和 R19 §07，映射 B04/B05/B06/B20。本单元沿用已批准的桌面/平板 v3 布局，把原逐音轨编辑流程接到中央输出面板，不扩展媒体编译器与 Native 协议。

## 行为

中央“逐音轨输出计划”可独立选择 Copy/AAC/Opus/FLAC/排除、码率、时间范围、输出声道和采样率，并声明“必须 Copy”。恢复全局策略仍调用原编辑器，已有保留锁时保留原确认提示。原始来源轨道仍只读。

新控件不持有第二份任务状态，不创建新的命名表单字段。所有写入经原控件 change 处理器，唯一 audioPlan、mustCopyAudioOrdinals、audioKeepSourceIdentity 仍由原编辑器拥有；正式编译器继续拒绝保留锁冲突。

运行锁与不可用选项阻止写入；引导模式隐藏这组手动设置并拒绝合成事件。来源对象与 name/size/lastModified 绑定防止下一帧刷新前的旧控件写入新来源；来源变化时同步焦点中的旧值。手机保留原编辑器。界面按原能力展示选项，具体后端支持仍以正式检查为准。

## 验证与边界

专项浏览器用例先以“缺少中央逐音轨控件”失败，再验证真实任务编译/执行/保存生命周期：第 0 轨必须 Copy、第 1 轨 AAC 96 kbps 单声道进入正式任务；执行禁用/合成写入拦截、修改使计划失效、全局恢复及锁清除、来源变化后轨道重建和锁失效、旧来源同步竞态拦截、手机/平板切换均有断言。媒体传输为模拟，不是实机编码证据。

来源竞态另有先失败后修复证据：旧投影曾将 FLAC 写入新来源的 audioPlan；新增来源绑定后应保持空计划，专项通过。独立代码复查无 Critical/Important；对非法选项拒绝后焦点控件显示旧值的 Minor 同时修复。

中文 834px 平板截图检查可读，四个桌面/平板宽度无横向溢出；临时 QA 字体不成为产品依赖。完整验证结果以任务记录为准。

本轮补齐 B06 的新界面可达性与正式任务接入，不能据此关闭复杂多轨媒体、语言/default/延迟属性、真实提供者保存和物理设备验收。其他高级意图、通用提取、预先选目录保持独立缺口。UIGS 复用既有产品案例，不提升 Canonical。

本地最终结果：`node --test src/*.test.mjs` 427 通过/12 跳过/0 失败；`npm run build` 通过；`check-workbench-basic.cjs`、`check-media-ui.cjs` 与 `check-expected-workbench.cjs`（11 宽度 × 3 工作流）均退出 0。

## 主线集成

[PR #118](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/pull/118) 已合入 `main@217ebf8338e6b639d9b5c1ecffbfeafe740efa9c`；发布前远端树 `dc6cae1fe0c95bdd87af736dac3ac842bec19529` 与本地验证树完全一致。唯一一次即时外部状态读取：[Test frontend](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38889408123)、[Build Android and Deploy Frontend](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38889407994)、[UIGS Evidence Coverage](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38889408124) 均运行中，Intake 预期跳过。按仓库协议标记 Pending External Validation，不等待下一轮或宣称已上线。
