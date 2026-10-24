# 可见工作台操作到 Native 保存成品

原始范围：R19 §09/§14、R24 §14/§18–20；B13/B17/B20/B24，A08。基线 main aa466c9 已集成 PR134 主界面成本测量和 PR133 SHA256 保存校验。两个独立验收不能证明同一次可见操作使用同一份真实 Native 成本并保存成品。

本单元复用既有完整生产 main.js/Windows Bridge 测试。来源检查和成本测量从 evaluate(el.click()) 改为 Playwright 对实际可见按钮点击，并断言可见状态与原账本一致、Native measurementId 存在。保留 task.budgetEvidence.measurementId 一致性以及同一 job 保存后的 SHA、音轨包、ASS 像素验证。

优先于新增编码器或扩展批处理：这是已有主工作台流程的最后两处程序化操作缺口。无需改产品算法、放宽任何成品断言或虚构来源。

本地仅 JS 语法及 diff 检查；真实 Windows Native 执行交由远端 CI。新提交不提前宣称 PASS。仍使用预选合成来源、CI 授权保存目录；不证明真实系统选片/保存对话框、长片、真实用户设备或整项 B/A 完成。
UIGS Intake Pending；待新执行证据后再去重。
