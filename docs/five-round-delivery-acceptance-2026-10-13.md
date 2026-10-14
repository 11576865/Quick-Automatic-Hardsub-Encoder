# QHE 五轮交付验收 — 2026-10-13

验收对象：PR #105，已测试提交 `95fc86dee63585493818f9c452b69649dd68fc1c`。
本记录是此次五个交付单元的集成结论，不是全部研究规划或正式发布的完成声明。

| 交付单元 | 已落地 | 验收边界 |
|---|---|---|
| 1. H.266 / VVC | Windows 手动硬压/转码、QP/码率、受限 preset、MKV、真实运行能力门禁、可取消成品解码 | 结构化任务测试 PASS；CI 不含 libvvenc，实际编码 UNSUPPORTED。不得将 Windows workflow 绿色解释为 VVC 运行验收通过 |
| 2. 逐流计划 | 独立音轨 copy/AAC/Opus/FLAC/drop，声道/采样率/时间范围，字幕/附件选择，实际输出合同 | Windows 逐流与配对编码工作流通过；Android 模拟器独立核验 8/8 成品 |
| 3. 完整文件预算 | 已测复制流、字幕、附件、音频时长成本、封装余量，实际成品严格字节上限与导出拒绝 | Windows smoke、浏览器回归、Android instrumentation 通过；测量目前仅 Windows；裁切复制流和 FLAC 重编码成本未知 |
| 4. 任务 UI | 当前来源、检查通过的逐流计划、原始执行成品；编辑/换源失效、上一成品保存；桌面三列、手机纵向 | 浏览器完整回归通过；已查看完整生产桌面和 390px VVC 手机截图；成品生命周期另有模拟后端 fixture |
| 5. 集成与证据交付 | 全量本地/真实 FFmpeg 回归、8 条 hosted CI、Android 成品报告、界面截图审查、可恢复记录 | CI 验收完成；真实设备/长片/外部播放器与完整产品规划尚未完成 |

## 验证

本轮新鲜本地验证：Node 211 项通过、7 项条件跳过；实际 FFmpeg 集成 5/5；Vite 构建通过。
已测试提交的 8 条 GitHub Actions 全部成功：

- Frontend：38342175981（含曲线、状态失效、VVC 界面、完整预算、音轨、保存重试与剪切队列回归）。
- Windows smoke：38342175973。
- Windows 逐流成品：38342175957。
- Windows 配对编码：38342175960。
- Android 编译：38342176046。
- Android 模拟器：38342175961，instrumentation 2 tests OK，独立成品报告 8/8。
- Device fixture：38342175964。
- UIGS：38342175974。

详细机器可读记录：`docs/evidence/five-round-delivery/acceptance-2026-10-13.json`。
报告和截图来自该提交对应的 artifact，保留 artifact ID 和已审查 PNG 的 SHA-256。

## 视觉审查

完整生产 UI 的桌面截图中来源/计划/成品三列对齐，实际 390px 手机截图纵向排列，
已审查范围没有可见遮挡或横向越界。手机回归另检查计算布局。
`media-workspace-task-review-mobile.png` 是独立模拟后端 fixture，未加载完整 app 样式，
其白底截图不能用来判断生产产品配色或整体视觉。
完整手动页面仍较长，当前方案和对象概览有内容重复；这是后续收敛项，
不以截图通过证明已经完成易用性研究。

## 留下的边界

- H.266 必须在用户实际含 libvvenc 的工具链中通过 encode/MKV/probe/decode，才能启用。
- GPU、真实 Windows/Android、SAF/provider 保存失败与清理、真实长片和播放器验收仍 Pending。
- 引导式硬压保持原有界面；新的对象概览覆盖共享手动工作台。
- 当前实现没有完成任意编码器 × 分辨率 × preset 的通用自动联合决策。
- 严格字节上限是交付合同，不是任意素材均能收敛到预算的编码保证。
- PR #105 以 PR #104 分支为基础；本轮未合并 main、未部署、未制作正式发行版。

范围内交付完成，现场验证与产品后续工作保留为独立事项。


## Verified hosted acceptance — 2026-10-13

Head `7a67d9e93a2440ace2cde8a7755a16fbd2cc27c0`, tested PR merge
`7bfc63b9b6c133d90c3e974de7bc548954fbbdac`: all nine workflows succeeded.
Required VVC run [38345727802](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38345727802)
executed real QP transcode, bitrate transcode and ASS hard-sub through Bridge.
All three independently report VVC, yuv420p10le, 24 frames and full decode PASS.
Output sizes: 26052 / 31566 / 25990 bytes. Runtime gate Available=true, ExitCode=0.

Downloaded artifact 11788845480 ZIP SHA-256 matched its published digest;
all three output byte sizes matched receipts. Provenance binds official asset
633881560, archive SHA-256 4480b1abcae8bb46146e271fe603efaa90f29671ff9013bb0aed2d64d12951c8,
FFmpeg N-127388-g615b07170e-20261012. Machine-readable receipt and output hashes:
`docs/evidence/five-round-delivery/vvc-runtime-2026-10-13.json`.

This supersedes the hosted-runtime Pending state above and the original generic
smoke UNSUPPORTED gap; historical receipts remain unchanged. These are one-second
synthetic hosted Windows jobs, not physical-device, long-form, external-player or
perceptual ASS fidelity acceptance. No main merge or deployment.
