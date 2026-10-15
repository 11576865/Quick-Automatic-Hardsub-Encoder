# QHE 桌面与平板 UI 设计交付（2026-10-16）

## 授权与整合

用户明确授权将已交付版本合并到 main，并按理论模型绘制实际 UI；随后明确限制只绘制桌面和平板。
PR #113 已合并，main 合并提交 `6bd0ac6dd38323620a812262b60dcb1fce6c680c`。
远程 `b4f9dca` 与本地 `2e47b9c` 的树完全相同：`3a9b1513d9f5ca9fabfd786b4268af6e4397727e`。Git CLI 网络不可达，使用 GitHub 对象 API 发布完全相同的树；不是替换产品改动。

## Figma 设计

[可编辑 Figma 文件](https://www.figma.com/design/FPHdsXxN7xNniLKjZQcVKd?node-id=3-2)

主要依据：附件 R24《QHE 产品定位与压缩决策 聊天讨论综合研究报告》§19–20、§8–18，及仓库 B02/B05/B20 来源与计划、成品分离。保留三条正式工作流，手动与测量推荐汇入统一正式计划，采用候选须确认，Stream Copy 显示切点限制，不提供重编码寻优。

| 图号 | 内容 | 宽度 | Figma node |
| --- | --- | --- | --- |
| D01 | 桌面 ASS 硬字幕 | 1440 | 3:2 |
| D02 | 桌面纯视频转码 | 1440 | 3:130 |
| D03 | 桌面无损剪切 | 1440 | 3:255 |
| D04 | 桌面候选比较与显式采用 | 1440 | 3:365 |
| D05 | 桌面成品与差异验证 | 1440 | 3:500 |
| T01 | 平板横屏 ASS 硬字幕 | 1194 | 3:632 |
| T02 | 平板横屏纯视频转码 | 1194 | 3:760 |
| T03 | 平板竖屏无损剪切 | 834 | 3:885 |

使用项目 expected-workbench.css 的深色及绿色强调色和 Noto Sans SC。组件发现：仓库无 Code Connect；新文件无现有组件；Simple Design System 按钮与本项目变量/外观不符，因此建立六种本地可复用控件，绑定变量及文本样式。页面布局为自动布局、可编辑文字/组件实例/矢量图，未使用整页截图作为设计图层。

全部八图逐一查看渲染，修复自动布局轴和字段宽度后确认无横向越界。设计素材、曲线和数值显式为示例；预期能力标注待接入。不是实际视频渲染、测量证据、交付验收或全部能力已实现的声明。没有绘制手机 UI，也未声明完成全部空白/忙碌/错误状态或可点击原型。

## 合并后的宽平板回归与有限修复

PR #113 的前端 CI run 38787479870 在 920px 的宽平板 overview 与主区并列断言失败。根因：expected-workbench.css 将原本 display:contents 的 support-rail 改为 grid，导致嵌套 overview/runtime 不再直接参与外层命名网格。不是此前本地已复现的 phone review 基准失败。

修复：821–1180px 平板恢复 support-rail 的 display:contents；920–1180px 显式使用 runtime/main/intent/overview 命名区域，将检查器与概览排列在主区右侧。不修改执行参数。
回归先加入 1180/1024/920px 的真实 DOM 几何断言并观察失败，再以 CSS 修复通过。目标浏览器检查覆盖 8 种宽度 × 3 工作流、草稿隔离、键盘和重置。Node 422 pass / 12 skipped / 0 fail，Vite 构建通过。旧完整浏览器套件及物理设备验收不在这些通过声明内。
修复发布后的托管 CI 属于 Pending External Validation，不连续轮询。

## UIGS Intake

查询 Foundry 后没有找到相同的 support-rail / nested named-grid 记录。另写窄范围 Bug/Observation，保留本次红绿证据；不修改 Canonical。Figma 自动布局纠错属于已知工具约束，不另建重复规范。

