# QHE WU13：成品暂存到用户保存位置的真实 Native 交付闭环（2026-10-24）

**基线**：main `193ecfcbf276f37249a036e59ee79edf874bbe5c`，WU12 PR #132 既有 Windows CI 真生产首页 Native 编码/成品审计 3/3 PASS。依据 R19/R24 D1/D4，B17/B24 和 A08。

## 问题

WU12 证明了最终 `output.mkv` 在 Bridge 私有临时目录中存在、音轨逐包保真、AAC 重编码、内封 ASS 及附件字体烧录像素真实；但没有证明**用户点击保存后**实际目录中的文件与已验证的那个成品相同。在严格体积模式以外，先前 `Export-Job` 复制时缺少全类型目标文件字节指纹对照。保存失败、同名文件替换、真实用户点击和最终文件身份仍有断点。

## 有界工程实现

- Windows Native `Export-Job` 对每个已完成 Job 在复制前计算暂存 SHA-256 / 字节数，在复制后重新核验暂存与同目录私有临时副本的完整 SHA-256 和字节数，对严格体积模式额外守住已批准的上限及事先认可的 SHA，才允许原有原子 `Publish-VerifiedOutput`；成功回执带 SHA-256、字节数和 Job ID。任何失败不发布未经验证的文件，清理孤儿临时副本。
- 发布用原有 Windows SaveFileDialog，网页不会新增 `destinationPath` 参数。专供 GitHub Windows Runner 的 `-CiSaveDirectory` 只能在 `GITHUB_ACTIONS=true` 且路径位于当前 `RUNNER_TEMP` 已存在目录下使用，代表测试时已明确授权的**保存对话框选择结果**；不能当成普通用户对话框可操作性的验证。
- Windows 脚本不新建假的编码器。它复用 WU12 **完整发布首页**真实 V3 导入、分析、预览、Manual FLAC Copy 锁 + AAC 和 Native 正式编码。测试先在 CI 用户目录写入已有旧内容，并验证未知 job 保存被拒绝且旧文件未变，然后真实点击 V3“成品”→“保存成品”，等待生产 `__onNativeExportResult` 事件让任务进入 `saved`。
- 独立审计旧文件被替换、无孤儿临时/备份、Native 保存 SHA = 实际目录 MKV SHA = 对应 Job 私有 staging SHA；同时对**发布后的文件**再次执行 FFprobe/FFmpeg FLAC 全包 Hash 一致、AAC 重编码、ASS/字体烧录像素与来源预算绑定验证。

## 证据边界

此次验收需要实际 Windows CI 成功，才可称为发布路径闭环；提交源代码本身不是 PASS。CI 在启动 Bridge 时声明了隔离保存位置，因而它**不能证明**真实 SaveFileDialog UI、用户取消、磁盘故障、权限错误、覆盖提示、重开应用恢复、真实长片或播放器矩阵。不会由短测试素材推断全部 A08 / A09 已完成。

**预期外部验收：** 精确 PR 头 Windows WU02/WU11/WU12/WU13 同套真实浏览器 Native 码流、保存与校验，完整前端回归及 UIGS Evidence Coverage 均成功才合并。