# WU-05 B09/A04 · 成品真正开场时间与音轨首包收据

理论根：R19 §06（`requestedIn/Out`、`actualFirstPresentation`、`copiedPacketRange`、`audioTimeMapping`、`verificationStatus`）；R24 §09（PTS/DTS、B 帧、VFR、音频偏移）。

**已提交、待验收的产品能力**：已完成、未陈旧的 Windows Native Stream Copy Trim 成品界面出现“检查已完成成品的时间轴”。用户明确点击后经 localhost Bridge，在私有已完成文件上分别使用 FFprobe 读取输出**解码呈现帧**首 PTS、视频编码首包 PTS/DTS、逐条音轨首包 PTS/DTS，并绑定现有 job ID、成品字节数、文件写入时间。将收据写入原任务报告 JSON；读取失败不会影响已存在的成品保存。

**明确不冒充的证据**：输出时钟上的第一个解码帧时间不是输入源时钟的 `actualFirstPresentation`；`executionSeekIn` 只是 Native 执行的寻址提示，不证明实际首帧。`copiedPacketRange=null` 与 `audioTimeMapping.sourceMappingVerified=false`，不能凭此宣称源包哈希一致、整段最后帧验证、VFR/B 帧音画同步或 A04 验收完成。最大 8 音轨，FFprobe 只采样视频首 128/64 包、音频首 32 包，按需执行，不强行扫描长片。

实施文件：windows/native-bridge.ps1、src/windows-native-client.js、src/main.js、src/media-workspace.js、src/media-planning.js、src/cut-timeline-evidence.js；任务字段进入现有正式报告而非并行第二数据源。

状态：模型单测、托管浏览器与真实 Windows Native 尚待 exact-head CI；目前绝不标为 PASS。
## 真实验收记录（2026-10-14）

被测功能提交：`cfed326a44412ba9a7f140ae4b39b526c4c3975b`。
Windows B-frame Source → Official schema-v4 Copy Trim → Localhost Native Bridge → Completed MKV → FFprobe：
https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38568220073 （SUCCESS）。
实际请求剪切 2.400–4.800 秒；58,863 字节成品；**输出时钟**首解码视频帧 2.000 秒、首视频包 PTS 2.083/DTS 2.000 秒、首 AAC 包 PTS 0.005 秒。独立 ffprobe 复验与 Bridge 收据首帧值一致。
浏览器/UI 模型验收：https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38568219698（SUCCESS）。前端/覆盖率同 SHA SUCCESS。

**语义边界**：这并非来源 `actualFirstPresentation` 的确定映射；源包逐包哈希、B 帧/VFR 完整尾界、音轨首包到实际可听声音的采样映射、播放同步仍未验收。JS 报告字段 `copiedPacketRange:null` 与 `sourceMappingVerified:false` 保持真实。首视频呈现与首音频包 PTS 差异超过 0.5s 时只警告复核，不自行判断音画已失同步。

早期真实 Windows CI 用 PowerShell 5.1 默认编码重新序列化 UTF-8 JSON，破坏中文兼容性警告，导致任务未进入 Native；改为直发 Node 原始 UTF-8 字节后托管验收通过，不能将该环境故障当作产品视频错误。
