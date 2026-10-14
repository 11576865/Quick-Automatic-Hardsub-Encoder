# WU-05 B09/A04 · 成品真正开场时间与音轨首包收据

理论根：R19 §06（`requestedIn/Out`、`actualFirstPresentation`、`copiedPacketRange`、`audioTimeMapping`、`verificationStatus`）；R24 §09（PTS/DTS、B 帧、VFR、音频偏移）。

**已提交、待验收的产品能力**：已完成、未陈旧的 Windows Native Stream Copy Trim 成品界面出现“检查已完成成品的时间轴”。用户明确点击后经 localhost Bridge，在私有已完成文件上分别使用 FFprobe 读取输出**解码呈现帧**首 PTS、视频编码首包 PTS/DTS、逐条音轨首包 PTS/DTS，并绑定现有 job ID、成品字节数、文件写入时间。将收据写入原任务报告 JSON；读取失败不会影响已存在的成品保存。

**明确不冒充的证据**：输出时钟上的第一个解码帧时间不是输入源时钟的 `actualFirstPresentation`；`executionSeekIn` 只是 Native 执行的寻址提示，不证明实际首帧。`copiedPacketRange=null` 与 `audioTimeMapping.sourceMappingVerified=false`，不能凭此宣称源包哈希一致、整段最后帧验证、VFR/B 帧音画同步或 A04 验收完成。最大 8 音轨，FFprobe 只采样视频首 128/64 包、音频首 32 包，按需执行，不强行扫描长片。

实施文件：windows/native-bridge.ps1、src/windows-native-client.js、src/main.js、src/media-workspace.js、src/media-planning.js、src/cut-timeline-evidence.js；任务字段进入现有正式报告而非并行第二数据源。

状态：模型单测、托管浏览器与真实 Windows Native 尚待 exact-head CI；目前绝不标为 PASS。