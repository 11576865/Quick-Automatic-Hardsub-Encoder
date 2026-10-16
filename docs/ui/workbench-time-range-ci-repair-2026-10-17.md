# 时间范围托管断言竞态修复 · 2026-10-17

## 授权与定位

用户继续推进；上一单元 PR121 前端 CI38929527049/job117069627655 在 basic 专项182行 `Copy opens its primary range controls` 返回 false!==true。单元/FFmpeg集成/构建及另两套浏览器回归均 success。依据AGENTS执行一次直接相关的有界修复，锚定B20/B24，不开启新功能范围。

## 根因与红绿证据

模式点击同步更新 body 的 mediaOperation；中央布局由 MutationObserver 观察后，经 requestAnimationFrame 调用 refresh，basic.refresh 才展开 Copy 的 details。Playwright click 返回不构成该投影刷新已完成的保证。CI可能比本地更早读取 open。

在同一 page.evaluate 事件轮调用模式按钮 click 后立即读取 open，已确定性复现原 false!==true，且 operation 已是 copy，证明是旧视图与新模式的时间边界，不是编译或时间策略丢失。

专项改为保留同事件轮切换，waitForFunction 等待 mode=copy、范围details.open、range controls未hidden及copy boundary未hidden，然后保留原 open=true 与 boundary实际可见断言。不用固定sleep，不删断言，不重试掩盖失败；永久不展开仍会超时失败。未改任何 src 产品逻辑或编码行为。

## 验证与边界

修复后完整 check-workbench-basic.cjs 退出0；Node439项中427通过/12跳过/0失败。既有逐流策略、ASS源时钟、非法范围、运行锁、保存重试等均继续验证。本次没有重新跑未变的产品构建或两套已在失败CI中成功的浏览器套件。

修复后托管验证尚未开始；按仓库协议提交后不等待第二代CI完成。真实切点与音画同步仍Field Pending。

## UIGS Intake

已查询并读取既有 `inbox/candidates/2026-10-02-presentation-regression-isolation-semantic-sync.md`，本次提供一个Web投影刷新案例，拟以Test记录补充可复现的同事件轮反例及条件等待，保持Candidate/Test级，不修改Canonical。

## 集成与Intake结果

[PR122](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/pull/122) 已从 `fdd3945c7242946a257b35af7c810077b374449f` 合入 `main@611c6547533abce207cb864cd39c8c3d360f7b4f`。独立审查确认未降低测试力度。修复后托管结果按一次有界修复协议保持Pending，不轮询新一代CI或宣称上线。

Foundry Test `inbox/tests/2026-10-17-qhe-copy-range-animation-frame-readiness.md` 已写入，提交 `8349345482e1bbdf9ce71d0066f6805e87ca4db6`，关联既有语义完成等待Candidate，无Canonical变更。
