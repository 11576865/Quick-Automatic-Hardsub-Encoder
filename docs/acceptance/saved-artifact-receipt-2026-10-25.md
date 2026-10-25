# 成品保存回执进入界面与报告

范围：R19 §03/P1、A08；R24 §05/§20，B02/B17/B20/B24。最新 main a7e31cb 已有 Native 原子发布、同 Job 导出 SHA、目标文件变更保护。缺口是这些保存证明仅留在 Native 回调，任务报告和成品证据区没有保留用户保存路径与哈希。本项优先于新增编码器或其他队列变体，补齐已有成品的可追溯交付记录。

保留原任务和保存状态权威。纯 normalizer 仅接受 ok、相同非空 jobId、正安全整数字节与 staging outputBytes 一致、非空路径及 64 位十六进制 SHA。无效回调不会生成保存证明，既有保存状态处理不在本切片重写。Native listener 把合格收据作为独立副本写入 completed 与报告快照，审计刷新继续保留；成品页用 textContent 展示，报告 JSON 增加 deliveryReceipt。浏览器下载仍只表示交给浏览器，没有本机落盘证明。

测试先写：同 Job 副本保存及失败/错 Job/缺失/无效字节/哈希/浏览器下载拒绝；stub 返回 null 时正例失败，随后通过。全套模型 452 项：440 PASS、12 SKIP、0 FAIL。新 Windows production main.js 检查保留既有保存 SHA/音轨/ASS 像素断言，并检查成品界面的真实路径/哈希和实际下载 JSON 的 deliveryReceipt。该新 Native 验收 Pending，不提前宣称通过。

限制：只是 Native 后端报告的保存回执，非保存后任意时间的持续完整性监控；不验证外部播放器、真实设备或整部影片。B02/B17/B20/B24 未整体关闭。UIGS Intake Pending。
