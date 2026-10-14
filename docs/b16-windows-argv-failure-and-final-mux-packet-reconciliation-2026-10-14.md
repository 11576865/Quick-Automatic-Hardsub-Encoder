# QHE B16 — Windows FFprobe argv 失败修复与已完成混合封装逐流成本对照

日期：2026-10-14
提交状态：当前批次建立在 PR #105 `83a37a10f1ea10b3fa4f2669c628478e94d29025` 之上，待新精确头部 Windows CI 验收。
范围：B16 部分实现；不会改变 B01–B25 / A01–A10 整体退出条件。

## 上一批 Windows 真实执行结果

`Windows B16 runtime acceptance` 运行 `38510258959` / job `115676894500`：PowerShell 5.1 语法与 Node 19 条收据测试 PASS，FFmpeg Chocolatey 9.0.2 安装 PASS，但 `scripts/check-flac-encode-preflight.ps1` 的真实 FLAC Worker FAIL。GitHub Actions 日志在 `windows/flac-encode-preflight.ps1` `RunBounded` 的首次 FFprobe 读取阶段显示：`You have to specify one input file`。这是命令行参数传递错误，**不是编解码器可用性证明或 FLAC 算法失败**。

根因修复：Windows PowerShell 的自动变量 `$args` 不能当作可控的显式函数参数/顶层 FFmpeg 命令列表；两处相关工作器 `windows/flac-encode-preflight.ps1` 与 `windows/trim-copy-preflight.ps1` 统一改为函数参数 `$Arguments`，临时 FFmpeg 参数列表 `$muxOptions`，避免 PowerShell 对自动变量的覆盖。

## 从独立观测走向已完成混合成品对照

新增 `src/auxiliary-mux-reconciliation.js` 及 `src/auxiliary-mux-reconciliation.test.mjs`，在**完成真实编码、验证成品且独立逐流 FFprobe 审计可用**时，把来源一致的独立 FLAC / 裁切复制观测与最终混合媒体成品中的逐流 packet payload 逐项比较。

准入条件包括当前来源 identity、完整源流 `measurementId`、Windows 来源文件长度/原始 FILETIME 字符串、精确任务起止以及裁切复制实际关键帧起点、输出 Matroska 容器、源音轨索引、输出轨道序号、全段/裁切策略、FLAC 声道/采样率、软字幕轨道映射、真实完成/独立包审计。缺少或不一致则 `status: unavailable`，绝不凭相同总字节数掩盖映射变动。

可比较时区分 `exact-observed-payload-match` 与 `observed-packet-delta`，输出每轨观察到的前后字节数、偏差及其总和。**这只是本次已完成成品的对照**，`canReplaceFormalBudget:false` / `canCertifyFutureMux:false`：它不能证明下一个作业、其它来源或同一素材其它编码参数的成本，更不能计入封装层开销/文件完整体积承诺。

共享工作台只在成功完成来源绑定预演后暂存只读收据；用户改变来源、测量 ledger 或编辑执行参数时使缓存失效。生成任务报告及后台实际 output-packet 审计完成后，可追加 `auxiliaryParity` 对照部分。正式 `sizeBudget` 的 FLAC 拒绝和裁切复制完整源流预留都保持不变。

## 真实与隔离验收

- 新的完整混合成品 Windows fixture：双 PCM 来源、真实视频编码、双 FLAC（第一轨 full、第二轨 trimmed）和一条软字幕一起输出 Matroska；用 FFprobe 独立观察逐流 packet payload，并打印与音频独立预演的差异。数值不强求相等，否则会将合法的寻址/时间戳或编码选择差异误判为缺陷。
- Linux FFmpeg 7.1.5 本地按同一混合 fixture 重现：`isolated.mka` FLAC a:0=39300、a:1=27599 字节；`mixed.mkv` a:0=39300、a:1=27599 字节，视频/双音轨/软字幕全部存在。**这是单个 3 秒合成源的观察值，不代表普遍相等。**
- 9 项基于仓库实现模块的逐流对照行为测试 PASS、前端 UI 模块语法解析 PASS；待以 Node ESM/Windows CI 复核。
- 专项 Windows 工作流和 Draft-fast/完整前端测试已新增逐流对照测试。精确头部 Windows PowerShell 5.1/FFmpeg、Native 实际 HTTP/UI 场景和长片依旧 Pending，不能提前签收。

## 未关闭的需求

证明完整混合任务与预演的实际 FFmpeg seek/packet 选择契约，独立认证同一实际任务整体输出成本（不仅辅助流包负载），再决定何种 FLAC 成本可以进入严格体积预算。还需要真实长片 VFR、多字幕/附件、声道格式、异常/缓存/跨进程重启、Android/Web 计量和最终交付验收。
