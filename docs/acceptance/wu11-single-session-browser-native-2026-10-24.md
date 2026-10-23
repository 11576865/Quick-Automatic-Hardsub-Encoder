# WU11 同一次 Windows Chromium → Native 正式成品验证（2026-10-24）

源报告 R19 P1/P2/P3、R24 §05/§11/§13；验收矩阵 B02/B04/B05/B06/B07/B11/B13/B24 与 A01–A03。基线 main@4e4e5e1（PR #130 已合并），参见 issue #107。

## 核心整合

PR #129 使用真实 Windows Native Bridge 编码混合 FLAC Copy／AAC 重编码，但采用意图由受控 fixture 模拟；PR #130 在真实 Chromium DOM 点击了逐轨计划和批准按钮，但运行传输被模拟。两段不能被称为一个真正由浏览器交接触发的 Native 成品。

本单元在现有 Windows WU02 rich MKV/内封 ASS/附件字体的**同一 Bridge 进程**内，启动真实 Chromium、加载生产 media-workspace 与 windows-native-client，经 Native probe、embedded ASS/font import、source-budget、Guided 逐轨选择和明确批准、正式 compileGuidedCpuHandoff/compileTask、Native startNativeEncode/getNativeJobStatus 直到 completed。浏览器提交的 jobId 返回 PowerShell，独立寻找对应 output.mkv，而非借用前一个独立任务的成品。

独立 oracle 检查：真实源 SHA、浏览器测量 ID、任务 VBR 视频码率和来源成本、a:0 FLAC 所有源包 SHA256 一致、a:1 AAC 实际重新编码、真实 ASS/font 与前一受保护导入来源一致、解码成功、正式烧录帧与去除 Dialogue 的参考帧像素不同。未确认时的第一次 Guided→Manual 点击必须拒绝且无执行。

## 边界

宿主页面是最小 HTML fixture，但调用真正的产品 UI/任务编译器和真实 Windows Native 客户端，不是伪造编码回执。该 CI 仍不是完整 main.js 来源选取流程、用户物理设备、长视频、VFR/B帧、所有流 disposition、严格字节上限或播放器兼容性验证。既有两个 Native 短窗的质量证书不自动继承到新音轨预算。

提交后状态：**Windows Chromium / Native / FFmpeg exact-head CI 尚未执行或完成；PR 不得提前合并。**