# WU-10 · Windows Native 真实来源锁定音轨的成品包保真

依据：R19 §03/§16 P2、R24 §05/§11；B02/B05/B06/A02。

## 可复现实验

1. 真实 FFmpeg 生成 3 秒 H264 + FLAC a:0 + AAC a:1 的 MKV。
2. Windows Native Bridge /api/probe 实际探测来源。Node 使用权威 `compileTask` schema-v4 编译 mustCopyAudioOrdinals:[0]、原 FLAC Copy 和第二轨 AAC 96kbps 重编码。
3. 负例：锁定来源身份不符、将被锁 FLAC 改为 AAC，两种情形编译器必须拒绝。
4. 同一正式任务通过 localhost /api/encode 完成，依据 jobId 获取输出 MKV。
5. 独立 FFprobe 对源与成品 a:0 执行 `-show_packets -show_data_hash sha256 -show_entries packet=data_hash`，按顺序逐一核对压缩包 SHA-256、包数；再确认 a:1 已重新编码。

## 精确证据

测试源码 SHA：`54ca3a4e2f7a8fd4222d7f31bca957577b98b539`。

真实 Windows Native CI：https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/actions/runs/38597508774 （SUCCESS）。其他同 SHA：Frontend 38597508576、UIGS Evidence Coverage 38597508191（均 SUCCESS）。

实际完成成品：121,709 字节。源与成品 FLAC a:0 **141/141 个压缩包 SHA-256 全部一致**；a:1 codec 仍为 AAC，但其输出包哈希序列与来源不同，证实进行了重编码。

## 边界

这是单个短合成完整时段 MKV 的音频**压缩包 payload 等价**，不是整个 MKV 字节相等，也不涵盖裁切、字幕、语言与 disposition、PTS/DTS、完整音画同步、播放器兼容性、实际用户影片或 Android/Web。P2/A02 维持部分实现。

## Web 真实运行阻断

当前 `public/vendor/ffmpeg-kit-next-web/` 仅包含 README，没有 `dist/index.js` 与实际 `lib/...` WebAssembly 核心。源码 `src/engine.js` 动态加载该路径，缺失时返回 `missing-core`。因此 WU-08 浏览器受控编排验收不能等同 Web FFmpeg 实际双来源成品验收。须独立建立可重现的本地核心构建/供给和真实浏览器运行验证。
