# QHE 中央画面预览接线 · 2026-10-22

## 范围与证据锚点

依据用户继续推进硬压实现，沿用已批准的桌面/平板 Figma v3 工作台与初版 R19/R24 范围，锚定 B03/B08/B09/B20 与 A04 的来源画面定位和交互可达性。最新起始 `main@4df6c594da53f465f99a07ed8d44936c6e99d5fa`。优先补齐中央「生成实际预览」在转码/剪切模式下只打开旧时间轴、没有主动生成帧的缺口；本轮不扩大为音画同步、VFR/B 帧帧准确验证、HDR 色彩证明，也不新增媒体执行器。

## 本轮实现

1. 转码与 Stream Copy 工作流的中央「生成实际预览」现在在实际来源和探测媒体就绪时，调用正式 `#taskWaveformLoad`：现有单一 `media-workspace.js` 实现分析时间轴、选定视频轨并发起源视频解码帧。中央预览经真实 DOM 更新显示，不另造 `hooks.frame` 调用链。无来源、未检查、时间轴加载中/不可用时显示操作解释，不假装成功。
2. 原中央预览按实际 File 对象引用隔离来源：发现来源对象变化后，将当时已存在的旧硬字幕/源视频帧 URL 标记为不得沿用，只有新帧 URL 出现才呈现。比较文件名/大小/mtime 不足以证明相同来源。此为 UI 防止过期画面误认的保护，不替代底层 FFmpeg 与 Native 源身份验证。
3. 从 `#taskFramePreviewStatus` 或时间轴状态显示正在分析/失败的反馈。原硬字幕 `#previewBtn`、正式编辑器、时间轴光标、执行计划和视频/音频保留字段均继续使用既有权限和状态所有者。

## 回归与验收

- `src/workbench-v3-model.test.mjs`：旧源 URL 必须拒绝，新帧可展示，无 URL 或 hidden 必须拒绝。
- `scripts/check-expected-workbench.cjs`：1440 宽度、没有来源时按中央预览请求应显示显式帮助；两份元数据可相同但 File 对象不同的来源之间不得继承旧帧。原 11 宽度 × 3 工作流测试保持。
- 真实跨端生成行为属于已有 `media-workspace.js` 的时间轴/源帧路径；此 PR 没有新增解码实现，也没有声明 HDR/VFR/用户设备实测。
- 本连接器环境不能运行本仓库的 Vite/Playwright/FFmpeg，本轮新增回归**已编写、未本地执行**。Hosted CI、真实源帧和 Native 设备继续独立核对；未提供证据前均为 PENDING。

## 边界与工作单元

本轮实际新增的是「中央预览生成动作可达现有解码链路 + 旧源视觉隔离」代码，不足以关闭完整 B03/B08/B09/B20/A04。下一单元优先保留多来源/复杂 MKV 成品验收与批次能力，不能自动从本次附带测试选择新的产品方向。新 UI 与原手机界面继续按 768px 呈现规则分工；不更改 Figma 设计、正式任务编译器或旧交付契约。

## UIGS Intake

本轮候选复用范围：异步画面结果与来源对象身份隔离；不凭一次 UI 测试修改 Canonical。Foundry 去重和窄证据记录单独追踪。

## 2026-10-22 继续验证补强

核查到 PR #124 的 GitHub Actions `Test frontend` 工作流总体 Success 时，实际只有 `draft-fast` 作业成功；完整 `frontend` 作业为 Skipped（Draft PR 策略）。不能用工作流绿色误报为完整 Playwright 回归通过。

因此扩展 `scripts/check-source-import-entry.cjs` 的真实前端 + Windows Native Client **模拟 HTTP** 验证：同一个 mock 来源的转码与 Copy 从中央按钮触发唯一 `/api/frame`，回执的 `requestId`、视频流 ordinal、720px 解码宽度保持；后台旧编辑器为唯一帧所有者，中央展示其结果。另在桥返回 `ok:false` 时要求中央清除旧帧、显示失败原因、用户再次点击可重试。这里的 PNG 是测试固定像素，不是 FFmpeg 生成的真实媒体产物。

下一步解除 Draft 以触发完整 `frontend` 作业（其脚本链包含 `check-media-ui.cjs` → `check-source-import-entry.cjs`），在本轮事务提交后仅读取一次任务状态；不把 Pending 当 PASS。真实 GPU、长片、VFR/B 帧与用户设备仍属于 FIELD-PENDING。

## 2026-10-23 已观察到完整 CI 失败及一次有界修复

- 正式非 Draft Frontend run [39754507684](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/39754507684) **failed** at `scripts/check-source-import-entry.cjs:81`。其余 Node、FFmpeg 集成、npm build 进入浏览器前已通过；失败具体是 Copy 预期 4 次 Native frame HTTP 请求，断言时记录为 3。失败日志在已有 Transcode 成功图像仍在中央 `img.src` 时即可被满足这一竞态上吻合，尚不足以判定实际 Copy 取帧缺失。
- 仅修复测试同步：点击 Copy 中央取帧前注册 `page.waitForResponse`，必须真正看到本次 `POST /api/frame` 回应后才断言累计 4 次请求；保留旧的响应/图像有效性要求和实际测试覆盖。不添加固定 sleep、不删功能断言，不改运行产品代码。
- 本修复按 `AGENTS.md` 仅进行一次。新一代完整 CI 尚**Pending External Validation**；不因旧 run 失败或修复提交而合并到 main，且不轮询到通过为止。Windows Native 响应为模拟，真实媒体/设备验收仍需独立证据。

## 2026-10-23 修复后第二次完整 CI 结果与本次交接

- 前次修复生成 `98d2b05a` 的正式 CI [39877054900](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/39877054900) 完整前端 FAILED，确切位置是 `scripts/check-source-import-entry.cjs:88`。此时新增的 Copy `POST /api/frame` 响应已被 Playwright 观察并且请求数达标，但立即读取中央 `img.src` 是 `null`。该证据尚不能区分真正的应用同步错误与 HTTP 响应→Native Callback→原始 img 更新→requestAnimationFrame 中央投影的多个异步阶段。
- 本次有界修复 `75c78e5c` 将测试通过条件改为：本轮 HTTP 响应已到，原有帧所有者 `#taskFramePreviewImage` 非 hidden 且拥有真实响应的 PNG URL，然后中央 `[data-v3-frame]` 非 hidden 且拥有同一 URL。保留请求总数和响应断言，没有固定 sleep，也没有修改产品代码。若条件仍不能满足，完整 CI 会明确失败而不是伪绿。
- 单元性质：测试完成判定与视觉投影同步，B20 用户可见取帧入口。真实媒体、设备、VFR 与成品帧准确性仍未验证；不宣称整个 B20/A04 完成。
- 根据仓库执行协议，分支新提交后检查一次外部状态；不等待或反复重试。主线合并门槛仍是完整 frontend PASS。
