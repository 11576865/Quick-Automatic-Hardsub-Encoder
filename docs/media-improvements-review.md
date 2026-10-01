# 视频处理工作区改进：审查与验证记录

基线：`9a18d782d5076fe359e2a9a3507bf4c9784d66b9`（上一轮三端重制合并后的 main）。

## 已实现

1. 三端目标体积任务：MB/GB/MiB/GiB、1–30% 余量、所有选择音轨的音频预算、视频码率反算；不使用截断输出的 `-fs`。
2. 同片段三组试压：质量 ±2 / 码率 ±20%、每片大小和耗时、片段外推整片体积、导出短片、采用参数。浏览器可尝试内嵌播放；原生通过成品导出观看。
3. 自定义配置：保存/加载/删除、JSON 导入/导出、参数继续可编辑；不支持的编码器明确提示。
4. x264 整片两遍执行：浏览器 FFmpegKit、Android service、Windows job 各自生成第一遍统计与第二遍成品；任务独立统计文件、第一遍移除音轨、两遍进度。
5. 运行时能力：参数 help、像素格式、音频编码器检查；旧核心自动使用 `-vsync`；NVENC 10-bit 4:2:0 使用 `p010le`；AQ 冲突检查。
6. 音频：AAC/Opus、每轨码率、声道与采样率；Opus 不接受 44100 Hz。
7. 成品检查：指定帧率、显式宽高、位深、音视频轨数量、时长和 packet；短音轨可正常完成；帧数上限须配合明确 CFR。
8. 任务报告：参数、实际体积、时长、耗时、预算偏差与建议重压码率；超出预算保留完整成品。

## 已运行的本地验证

- 12 项任务/预算/能力单元测试通过。
- 原有 ASS、字体覆盖、libass 诊断、输入安全检查和 6 项 UI shell 测试通过。
- 实际 FFmpeg 集成测试通过：转码尺寸/帧率/音轨、8-bit 输入的 10-bit 输出、x264 两遍体积预算、60 fps、旧 `-vsync`、Opus、硬字幕画面差异和截取时间轴、无损剪切 packet SHA-256 与源一致。
- JSDOM 界面逻辑检查通过：配置恢复、预算显示、超预算输出保留、报告启用、三组试压、无损模式清除两遍设置。
- Vite 生产构建通过。

## 未完成的验证与限制

- 本机 Chromium 不存在，下载失败，故未运行真实浏览器布局/截图检查。已扩展 Playwright CI 检查桌面/手机、配置与试压交互，但 CI 尚未运行。
- 本机没有 Windows PowerShell / Android SDK 编译环境。Windows 的真实两遍编码与输出规格检查、Android Kotlin 编译需在 CI 运行。
- 本机无 NVIDIA GPU，不能声称已在 RTX 5070 上实测新增参数组合。
- VMAF 依赖 libvmaf 构建及一致的参考处理链路，此次未接入默认评分。
- 两遍仅支持 x264；AV1/HEVC 的独立两遍机制未统一开放；NVENC multipass 仍按逐帧内部机制执行。
- 输出仍为 MKV；HDR/高位深输入转码保护和浏览器 1 GiB 输入保护继续生效。
- 体积预算和试压外推不是精确大小或主观画质保证。

## 官方资料

- https://ffmpeg.org/ffmpeg.html （`-fs`、`-pass`、`-passlogfile`、`-pix_fmt`、帧率策略）
- https://ffmpeg.org/ffmpeg-filters.html#libvmaf （参考视频与 libvmaf 构建要求）
- https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html （NVENC 参数、逐帧 multipass、AQ）

## 提交与验证状态

修改提交到功能分支并通过 PR 审查。远程 CI 结果需在完成后更新；本地验证不替代 Windows、Android 与真实浏览器检查。
