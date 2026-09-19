# Quick-Automatic-Hardsub-Encoder

一种在浏览器本地运行，自动完成 ASS 字幕预检、字体检查、编码比较与 H.264 / H.265 / AV1 硬字幕压制的快捷工具。

## 在线使用

https://11576865.github.io/Quick-Automatic-Hardsub-Encoder/

> 在自定义 FFmpeg WebAssembly core 构建完成前，页面可以打开并进行基础文件/ASS/字体分析；真实 libass 预览与硬字幕压制需要完整 core。

## 目标

面向约 1 GB（含）以下的小视频。用户只需要选择视频、ASS 字幕以及必要时的字体文件；程序负责文件挂载、字幕预检、真实 libass 预览、编码样本测试、方案比较和成品下载，避免手工输入 FFmpeg 命令、整理路径和改文件名。

## 当前 V0.1 骨架

- 视频 ≤ 1 GiB 输入限制
- ASS 样式/Dialogue/内联 `\\fn` 字体分析
- TTF / OTF / TTC / OTC 内部字体名称读取与初步匹配
- WebAssembly / SharedArrayBuffer / WebCodecs 能力检测
- 真实 FFmpeg + libass 预览接口
- H.264 (`libx264`) / H.265 (`libx265`) / AV1 (`libsvtav1`) 三编码器样本测试接口
- 样本时间、大小、SSIM 与全片体积/时间估算
- 1.6× / 2.0× / 效率曲线三种空间策略入口
- 字体警告后允许用户在看过预览的前提下继续
- 音频默认 stream copy
- 输出 MKV 并触发浏览器下载

## 编码核心

项目采用可替换的 FFmpegKitNext Web core。上游 Web 构建支持 `WORKERFS`、FFprobe、pthreads，并为 `libass`、`x264`、`x265`、`libsvtav1` 等外部库提供构建路径。

FFmpegKitNext 不发布 Web 二进制包，因此需要单独构建。完成后将本地包内容放到：

```text
public/vendor/ffmpeg-kit-next-web/
```

至少应包含：

```text
dist/index.js
lib/...
```

目标构建需要：

```text
libass
fontconfig
freetype
fribidi
harfbuzz
x264
x265
libsvtav1
pthreads
ffprobe
```

## 本地开发

```bash
npm install
npm run dev
```

多线程 WebAssembly 需要跨源隔离。本地 Vite 已配置 COOP/COEP headers。

## 部署说明

GitHub Pages 不能直接设置 COOP/COEP 响应头，因此项目使用 MIT 许可的 `coi-serviceworker` 在静态托管上建立跨源隔离；支持自定义 headers 的托管平台则可以直接使用 `public/_headers`。

## License

原创代码采用 MIT License。FFmpeg、FFmpegKitNext、x264、x265、SVT-AV1、libass 等第三方组件继续遵守各自许可证；把自定义 Web core 纳入公开分发前需要补齐 THIRD_PARTY_LICENSES 和相应源码/许可义务。
