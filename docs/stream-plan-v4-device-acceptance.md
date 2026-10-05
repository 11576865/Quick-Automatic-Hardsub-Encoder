# Stream Plan v4 真机 / 本机最终验收

Hosted CI 已经证明 task schema v4 的任务编译、真实 FFmpeg 执行、Windows hosted runner、Android Kotlin 编译和浏览器交互契约可以通过。**这不等价于真实 Windows 用户环境、真实 Android 设备或目标播放器兼容性已经通过。**

本文件定义下一层验收：使用同一份多流容器，在实际 Windows Native 和 Android APP 中执行固定任务，并把导出的成品交给独立验证器检查。

## 1. 生成 Device Acceptance Pack

需要本机有 FFmpeg / FFprobe：

```bash
node scripts/build-stream-plan-v4-device-fixture.mjs
```

默认生成：

```text
device-acceptance/stream-plan-v4-pack/
  stream-plan-v4-source.mkv
  burn.ass
  soft.srt
  attachment.txt
  chapters.ffmeta
  device-acceptance-cases.json
  source-probe.json
  README.md
```

也可以从 GitHub Actions 的 **Stream Plan v4 device fixture** workflow artifact 获取同一类测试包。

测试源包含：

- 视频 #0：320×180 / 30 fps / H.264；
- 视频 #1：240×136 / 24 fps / H.264；
- 两条 AAC 音轨；
- 一条内封软字幕；
- 一个 attachment；
- 两个 chapter；
- 容器 metadata。

它故意把“多视频、多音频、软字幕、附件、章节、metadata”放进同一个 MKV，用于暴露任何仍然存在的“默认 v:0”“所有流共用一个时间范围”“换容器等于转码”等旧假设。

## 2. 真机任务矩阵

每个任务都从同一个 `stream-plan-v4-source.mkv` 开始。导出时使用下表规定的文件名；验证器根据文件名识别任务。

| ID | 在 APP / Windows Native 中执行 | 导出文件 |
| --- | --- | --- |
| V4D-01 | 只选视频 #1；H.264 转码；视频完整；无音频；MKV | `V4D-01-v1-transcode.mkv` |
| V4D-02 | 选视频 #0,#1；H.264 转码；视频完整；无音频；MKV | `V4D-02-both-transcode.mkv` |
| V4D-03 | 选视频 #0,#1；加载 `burn.ass`；硬字幕；无音频；MKV | `V4D-03-both-hardsub.mkv` |
| V4D-04 | 只选视频 #1；H.264 转码；音轨 #0 Stream Copy；MP4 | `V4D-04-remux-transcode.mp4` |
| V4D-05 | IN=1s / OUT=3s；视频 #0 trim；两条音频 full；MKV | `V4D-05-video-trim-audio-full.mkv` |
| V4D-06 | IN=1s / OUT=3s；视频 #0 full；两条音频 trim；MKV | `V4D-06-video-full-audio-trim.mkv` |
| V4D-07 | 视频 #0 Stream Copy/full；只取音轨 #1 并转 AAC 96 kb/s；MKV | `V4D-07-video-copy-audio-aac.mkv` |
| V4D-08 | IN=1s / OUT=3s；视频 #0 trim；无音频；软字幕 full；保留 metadata / chapters / attachments；MKV | `V4D-08-assets-and-softsubs.mkv` |

除上表明确写出的字段外，保持默认参数即可。不要在 V4D-01～08 中加入额外裁切、缩放、旋转、帧率变化或滤镜，否则验证器无法区分“task schema 错误”和“用户额外修改”。

## 3. 独立验证

把某个平台的 8 个导出文件放入一个目录，例如：

```text
device-acceptance/windows-native-outputs/
device-acceptance/android-device-outputs/
```

然后运行：

```bash
node scripts/verify-stream-plan-v4-device-outputs.mjs \
  device-acceptance/stream-plan-v4-pack \
  device-acceptance/windows-native-outputs
```

Android 同理。

验证器不是检查“命令能不能生成”，而是读取真实成品：

- V4D-01：确认只剩视频 #1 的 240×136 流；
- V4D-02：确认两条视频都存在；
- V4D-03：分别解码两条视频的字幕激活帧，并与源流比较，确认两条都发生真实画面变化；
- V4D-04：确认成品确实为 MP4，视频发生转码而 AAC 音频被保留；
- V4D-05 / 06：分别读取 video/audio packet 末端，证明视频与音频时间策略可以不同；
- V4D-07：对视频 packet 做 SHA-256 序列比较，证明所谓 Video Stream Copy 没有偷偷重编码，同时音频确实变成单条 AAC；
- V4D-08：确认软字幕仍覆盖完整源时间轴，并检查 metadata、2 chapters、attachment 都存在；
- 每个成品都执行完整 A/V 解码扫描。

全部 8 项通过后，才可把该平台标记为 **Stream Plan v4 Device Accepted**。

## 4. Reference Outputs

为了验证测试包和验证器自身，可以让仓库的 shared task compiler 直接调用桌面 FFmpeg 生成一套 reference outputs：

```bash
node scripts/build-stream-plan-v4-device-fixture.mjs
node scripts/build-stream-plan-v4-reference-outputs.mjs
node scripts/verify-stream-plan-v4-device-outputs.mjs \
  device-acceptance/stream-plan-v4-pack \
  device-acceptance/reference-outputs
```

这一结果属于 **executor/reference evidence**，不是 Windows Native 或 Android device evidence。它的用途是证明：

1. fixture 本身可构造；
2. task schema v4 可以表达这些任务；
3. verifier 能识别正确输出；
4. 如果真机输出失败，可以优先定位平台执行层，而不是先怀疑测试数据。

## 5. 当前证据状态

截至本验收链路加入时：

- shared task schema v4 + desktop FFmpeg reference：已通过；
- GitHub hosted Windows runner 上的真实 Windows Native Bridge：8/8 用例已执行并通过独立 verifier；
- Windows local smoke：通过；
- Android Kotlin / task parser：已编译通过；
- Android API 35 x86_64 emulator 上的真实 MainActivity + EncodeService + packaged FFmpegKit：8/8 用例已执行；最终导出 artifact 已在 host 侧重新通过独立 FFmpeg/FFprobe verifier；
- Android emulator 的成品交接曾出现一次假绿：connected test 结束后 target package 已被卸载，后续 `run-as` 把错误文本写进媒体文件，同时 POSIX `node ... | tee` 未传播 verifier 非零退出码。现已改为手动安装 APK、直接运行 instrumentation、在卸载前导出成品，并在仓库 Bash 脚本中使用 `set -euo pipefail`；PR #64 run 37315987657 明确输出 `passed: 8 / total: 8`；
- **用户实际 Windows 机器：尚未形成 field-device 证据**；
- **真实 Android 设备：尚未形成 field-device 证据**；
- 外部目标播放器：仍属于独立兼容性验收。

GitHub Windows runner 的 runtime-backed 结果比单纯 parser/fixture evidence 更强，因为任务确实进入 Native Bridge、由 Bridge 启动 FFmpeg、经过 Bridge 自己的终态验证，再由外部 verifier 读取最终成品。但它仍不能代表用户机器上的 GPU、驱动、文件系统、杀进程行为、OEM Android 环境或具体播放器。

## 6. 证据等级

这一阶段严格区分：

```text
Task compile pass
  < real FFmpeg reference pass
  < hosted Windows / Android build pass
  < hosted native-runtime pass (Windows Native Bridge / Android Emulator)
  < real Windows / Android field-device pass
  < target-player playback pass
```

前一层通过不能自动替代后一层。

播放器验收尤其独立：FFprobe 能看到音轨、packet 完整、FFmpeg 能解码，都不能证明某个具体外部播放器一定能播放该 codec/container 组合。

## 7. 当前不纳入本轮 Device Acceptance 的能力

task schema v4 当前仍明确不支持同一任务内的 per-video heterogeneous action，例如：

```text
v:0 = Stream Copy
v:1 = HEVC Transcode
```

同一任务选择多条视频时，它们共享一个视频操作、编码器和滤镜计划。

同样，多视频 + 单一 target-size、整片 two-pass、统一 frames cap 仍在语义层提前拒绝。只有定义了明确的 per-stream budget / allocation semantics 后，才应把这些组合加入验收矩阵。
