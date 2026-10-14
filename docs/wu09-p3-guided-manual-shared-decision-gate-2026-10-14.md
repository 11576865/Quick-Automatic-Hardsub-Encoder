# QHE WU-09 · P3 Guided/Manual 共同证据决策门禁

原报告：R19 §16 P3、补遗 B，R24 §13–18；追踪 B04/B11/B12/B13/B14。

## 已交付的用户可见行为

Guided 与 Manual 的候选比较现在调用同一只读 `evaluateSharedEvidenceDecision`。它接收当前工作流、原证据参考身份与当前参考身份、现有共享率失真前沿、所选体积目标以及完整文件／仅视频／复制音频成本估算的预算坐标。输出仅有诊断、候选推荐或独立 Native VBR 短样验证三层状态和相应门禁；它不重新采样、不改变 SSIM 拟合、不自动切换 codec/preset，也不声称最终完整电影体积。

Guided 的 ASS 渲染参考与 Manual 的源 SDR 参考分域，严格拒绝交叉；缺乏源音频复制字节数的完整文件坐标是估算，不能触发 Guided 推荐分支的采用提案。Manual 切换到“仅视频负载”时曲线可作为诊断但不能开始候选 VBR 验证。回到真实账本下的“成品目标体积”且存在同源、共同短样范围时才可得到候选推荐，Native VBR 与用户显式确认仍由原有专属事务执行。用户更换目标、候选、参考、形式预算后既有核验会被现有流程作废。

## 精确验收

测试代码 SHA `6ea0bea2b5d2e0ae467ccd9cf5310e3982f0388c`。
共享单测与真实 `fitRateDistortionModel/createMultiBranchFrontier/projectWholeFileFrontier` 集成检查、Vite/Chromium 模块/UI 可用性：https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38592703806 SUCCESS。
前端整体测试 `38592703737`、UIGS Evidence Coverage `38592703764` SUCCESS。

## 不宣称

未运行新一轮 Windows Native 相同片段/参考的配对 CQ/VBR、未在最终实际影片中复验目标体积与质量、未交付跨平台兼容或完整全球最优。这是共同候选推荐资格层的纵向切片，而非完整 P3/B04/B11/B12/B13/B14 验收。下一开发单元不能仅因本轮成功自动授权。
