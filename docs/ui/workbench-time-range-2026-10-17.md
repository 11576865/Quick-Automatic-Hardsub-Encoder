# 中央处理时间范围 · 2026-10-17

## 范围与授权

用户继续实现已设计桌面/平板工作台，沿用远程发布与 main 集成授权。重新读取 R19 §05/06/07/12、R24 §06/09/11/19 以及初版路线/追踪矩阵，锚定 B03/B04/B08/B09/B20。既有中央 start/end 仅 Copy 显示，videoRange/audioRange/subtitleRange 只能到完整编辑器调整；本轮补齐重编码任务的基础截取路径，优先于高级色彩、通用提取与新增后端。

## 实现

三工作流共用“处理时间范围”。Copy 默认展开，保留关键帧判断及请求/实际边界说明；转码/硬压默认折叠，用户按需展开。Guided 显示说明并隐藏、禁用 Manual 时间控件，不改引导方案。原手机界面继续使用原编辑器。

start/end 移至统一 basic projection 事件路径，复用原表单 input/change/blur 处理，避免旧处理器重复提交；失焦由原 normalizeTimeControl 规范化时间，并同步原校验信息。三个范围选择不建立第二状态：videoRange、audioRange、subtitleRange 直接写入正式控件。逐音轨范围仍优先于音频默认；软字幕时间策略不被误认为硬烧 ASS 的策略。

执行中及 Guided 隐藏状态拒绝合成写入；正式编辑器/时间轴更新回投中央。保留原编译器非法起止拒绝、计划失效和 ASS 源时钟补偿；不新增 Smart Cut、不把关键帧预判断当作实际精度证明，不修改保留合同或时间映射算法。

## 当前验证

专项先以缺失 videoRange 中央控件失败，实施后通过。受控浏览器通过真实 compileTask，验证 0.5–1.5 秒截取映射到 trim 输入、视频/软字幕时长 1 秒而完整音频 2 秒；独立 Copy full 视频仍映射源输入，同时 trim 软字幕映射裁切输入。手动 ASS 保持原渲染顺序与 setpts 正负0.5秒源时钟补偿。非法 end≤start 拒绝执行，原时间格式化/编辑器回投/Guided与运行锁通过。此前逐轨/逐对象/保存失败重试等专项仍通过。

1440/1194/834/768 专项无溢出，中文平板截图复查可读。Node 439项：427通过、12跳过、0失败；构建通过，保留既有 bundle 大小提示。完整 check-media-ui.cjs 回归与 check-expected-workbench.cjs 的11宽度×3工作流均退出0；独立静态审查无Critical/Important。上述媒体传输是模拟，不等于真实VFR/B帧、ASS像素、音画同步或保存提供者验收。

PR120 前端托管回归38894004555 completed/success；部署尚未在本轮确认。

UIGS Intake 已查询并读取既有 Candidate `inbox/candidates/2026-10-03-human-friendly-media-time-input-normalization.md`，本次复用中央解析及规范化原则，未产生新的跨项目结论，不修改 Canonical。远程 checkpoint `83e04a82fd5fb8d77b03c70c406cf40164eb637c` 的树 `620da26288a84cebfab8c6f78e436cf830351773` 与本地验证树一致。
