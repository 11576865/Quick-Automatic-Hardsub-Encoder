# Quick Automatic Hardsub Encoder

一个围绕 **ASS 硬字幕压制**构建的跨端自动化工作台。

它把“选择视频、字幕和字体 → 预检 → 真实 libass 预览 → 编码测试 → 自动方案选择 → 正式压制 → 校验与导出”整理成同一套界面，并根据运行平台使用不同后端：

- **Windows Native**：系统 FFmpeg / FFprobe + NVIDIA NVENC / CPU 编码；
- **Android Native**：FFmpegKitNext + libass + ARM64 原生编码服务；
- **Browser / WebAssembly**：安装即用的浏览器后端与兼容 fallback。

**Web App:** https://11576865.github.io/Quick-Automatic-Hardsub-Encoder/  
**Web package:** 0.1.0  
**Android native line:** 0.2.1-native

> 这个项目的中心目标不是“把 FFmpeg 命令放到网页里”，而是尽量把硬字幕压制前后容易出错的判断、预览、测试、回退和输出验证自动化。

## About

Quick Automatic Hardsub Encoder is a cross-platform ASS hardsub encoding workbench with a shared modern Web UI and native Windows/Android backends. It performs subtitle/font preflight, real libass preview, H.264/H.265/AV1 sample benchmarking, quality/size planning, native NVENC or software encoding, progress/cancel handling and verified MKV export without requiring users to assemble FFmpeg commands manually.

## 项目定位

传统硬字幕工作流往往是：

```text
找 FFmpeg
→ 写命令
→ 处理 ASS 路径和字体
→ 猜编码器 / CRF / preset
→ 跑一遍
→ 发现字幕、字体、体积或速度不对
→ 重来
```

本项目把它改造成：

```text
视频 + ASS + 字体
        │
        ▼
媒体 / ASS / 字体预检
        │
        ▼
真实 libass 字幕预览
        │
        ▼
H.264 / H.265 / AV1 测试片段
        │
        ├── 速度
        ├── 样本体积 / 码率
        ├── SSIM
        └── 本机能力
        │
        ▼
自动 / 半自动方案选择
        │
        ▼
正式硬字幕压制
        │
        ▼
输出验证
        │
        ▼
MKV
```

它和 [MKV-Fast-Muxer-v3](https://github.com/11576865/MKV-Fast-Muxer-v3) 的边界不同：

- **Fast Muxer**：不重编码，只把软字幕和字体封进 MKV；
- **本项目**：字幕通过 libass 真正烧进视频画面，因此视频必须重新编码。

## 当前三种运行路径

### Windows Native — 推荐的 Windows 路径

Windows 11 上推荐：

```text
windows/start_windows.bat
```

启动后：

```text
现代 Web UI
      │
      ▼
127.0.0.1 Native Bridge
      │
      ├── FFprobe
      ├── libass
      ├── NVIDIA NVENC
      ├── x264
      ├── x265
      └── SVT-AV1
```

浏览器只负责界面和控制；视频读取、测试片段和正式压制都由系统原生 FFmpeg 完成。

Bridge 会检测：

- FFmpeg / FFprobe
- CPU
- NVIDIA GPU
- `h264_nvenc`
- `hevc_nvenc`
- `av1_nvenc`
- `libx264`
- `libx265`
- `libsvtav1`
- libass
- SSIM

同一格式下，只有 **实际运行探测通过** 的 NVENC 才会被标记可用；否则回退 CPU 软件编码器，而不是因为 FFmpeg 列出了 encoder 名称就假定 GPU 一定能用。

默认启动器隐藏后台 Bridge，不再弹出旧 WinForms 主窗口。

调试：

```text
windows/start_windows_debug.bat
```

旧 UI 仅保留为诊断入口：

```text
windows/start_windows_legacy_ui.bat
```

详细见 [windows/README.md](windows/README.md)。

### Android Native — 原生 APK 路径

仓库已经包含原生 Android 应用：

```text
android-native/
```

当前架构：

```text
同一套 Web UI
      │
      ▼
Android Native Bridge
      │
      ├── SAF 文件选择
      ├── FFprobe
      ├── libass preview
      ├── sample benchmark
      └── Foreground EncodeService
              │
              └── FFmpegKitNext
```

正式压制不依赖 Activity / WebView 生命周期，而由 Android foreground service 持有 FFmpeg session。

当前 Android native 路径已经包含：

- Storage Access Framework (SAF) 视频 / ASS / 字体选择；
- persistable URI；
- 输入 seekability 探测；
- 不可 seek 输入的 app-private staging；
- x264 / x265 / SVT-AV1 软件编码；
- libass；
- FFprobe；
- SSIM；
- 原生预览；
- 测试片段；
- 正式压制；
- 通知栏进度；
- 通知栏取消；
- wake lock 生命周期管理；
- 输出 staging + FFprobe 验证后再导出；
- 本机成功压制历史，用于后续 ETA 估计；
- App 内更新检查；
- APK SHA-256 / signer 校验；
- 16 KiB page / ELF alignment CI 检查；
- Adaptive launcher icon。

Android MediaCodec 会被探测，但 **当前不会因为存在 encoder 名称就默认启用硬件编码**。设备 / 厂商差异可能导致初始化失败或输出兼容性问题，因此目前正式默认仍是经过验证的 ARM64 软件编码路径。

详细的故障约束见 [Failure prevention checklist](docs/failure-prevention-checklist.md)。

### Browser / WebAssembly

网页本身也保留浏览器后端。

自定义 FFmpegKitNext Web core 由工作流构建，包含：

- libass
- fontconfig
- FreeType
- FriBidi
- HarfBuzz
- dav1d
- x264
- x265
- SVT-AV1
- pthreads
- FFprobe

GitHub Pages 部署会按 `.github/core-lock.json` 下载固定版本的 Web core Release asset，并校验 SHA-256。

WebAssembly 路径适合作为：

- 安装即用入口；
- 非 Windows / 非 Android Native fallback；
- 预检和测试环境。

浏览器后端仍受 wasm / 浏览器内存和文件 API 限制，因此较大的正式压制任务优先推荐 Native 路径。

## 输入

用户需要提供：

1. 视频；
2. ASS 字幕；
3. 字体（可选 / 可多选，但字幕需要的字体应尽量提供）。

当前浏览器 UI 对非 Native 路径保留约 **1 GiB** 输入保护；Native 路径并不使用这个浏览器文件大小判断作为正式媒体处理上限，但仍受磁盘、staging 空间、编码时长和设备能力约束。

## ASS 与字体预检

当前前端会分析：

- ASS Style；
- Dialogue；
- 内联 `\fn`；
- 字体请求；
- TTF / OTF / TTC / OTC 内部名称；
- TrueType/OpenType `cmap` Unicode 覆盖范围；
- 按 ASS 实际 Dialogue 跟踪 Style、`\fn`、`\r` 与绘图模式后的字体/字符使用；
- 上传字体与 ASS family 的匹配；
- 主字体缺字 / 需要 fallback 的静态预警；
- Web、Windows Native、Android Native 真实 libass 预览中的 `fontselect` / missing-glyph / fallback 日志；
- 将运行时日志结构化为“主字体缺字 → 已找到 fallback / fallback 未确认”的逐字符诊断。

Windows 端会把 UTF-16 ASS 安全规范化成 libass 可处理的 UTF-8 临时文件，避免 BOM / UTF-16 直接送入 FFmpeg 造成乱码或字体识别异常。

Android Native 则通过持久 URI / app-private font pool 把用户字体交给 libass / fontconfig，而不是假定 WebView IndexedDB 就等于原生字体路径。

## 真实字幕预览

项目不使用 DOM / Canvas 模拟 ASS 最终效果作为权威预览。

预览链路是：

```text
实际视频帧
   +
实际 ASS
   +
实际字体
   ↓
FFmpeg + libass
   ↓
预览图
```

因此字体、位置、描边等关键效果以实际 libass 渲染结果为准。预览还会把 libass 的字体选择日志结构化：当主字体缺少某个 Unicode 字形时，会区分“已选择后备字体”和“仍未确认可用 fallback”，并保留原始日志供核对。

这也是正式压制前最重要的一道人工确认。

## 编码器

项目当前围绕三种目标格式：

### H.264

Windows：

- `h264_nvenc`
- `libx264`

Android / Web：

- `libx264`
- MediaCodec 仅在验证后作为实验路径

### H.265 / HEVC

Windows：

- `hevc_nvenc`
- `libx265`

Android / Web：

- `libx265`

### AV1

Windows：

- `av1_nvenc`
- `libsvtav1`

Android / Web：

- `libsvtav1`

Android 还包含 dav1d 用于 AV1 软件解码能力路径。

## 样本测试与方案选择

正式编码前可以生成真实测试片段。

记录 / 比较的内容包括：

- 编码耗时；
- average speed；
- 输出大小；
- 视频码率；
- SSIM；
- 当前 codec / preset / quality；
- 本机历史性能。

当前一级压制方式收敛为三类：

- **快速预设**：通过滑块在“更快 / 均衡 / 更精细”之间选择固定 CRF/CQ + preset，不运行质量校准；
- **目标质量**：通过 SSIM 阈值滑块设定校准目标，可固定编码器，也可自动比较 H.264 / H.265 / AV1，在同一质量阈值下优先选择更低样本码率、差异很小时偏向更快者；
- **目标体积**：通过连续体积预算滑块设定相对源文件的输出上限，并保留 ×1.00 / ×1.25 / ×1.60 / ×2.00 快捷吸附点。

这些是自动选参辅助，不应理解成短样本能够精确预测整片结果。

项目的安全原则明确规定：

> 短测试片段只能提供近似吞吐、视觉检查和相对比较；不能把一个 keyframe-heavy 短片段线性外推成精确的整片体积或完成时间。

## 音频策略

硬字幕压制只改变视频。

默认：

```text
video → re-encode with ASS/libass
audio → stream copy
output → MKV
```

这样避免不必要的音频二次编码。

## HDR / 高位深保护

当前版本如果检测到：

- 10-bit / 更高位深；
- HDR；
- PQ / HLG；
- BT.2020 + 高位深；

会允许做必要的分析 / 字幕预览，但会锁定正式编码测试和压制。

原因是当前项目尚未建立经过验证的 HDR / 10-bit 色彩保持链路。

它宁可明确拒绝，也不会静默把：

```text
10-bit HDR
→ 8-bit SDR
```

然后把结果当成成功。

## Windows Native 安全边界

Native Bridge：

- 只监听 `127.0.0.1`；
- 每次启动生成随机 token；
- 请求必须带 token；
- CORS 仅接受项目 GitHub Pages 与 localhost 开发入口；
- Windows 本地视频路径不暴露给网页；
- Bridge 接受结构化任务，而不是任意 FFmpeg shell command。

正式输出遵循：

```text
encode to temporary file
→ FFprobe / integrity validation
→ verified
→ safe publish to destination
```

如果目标位置已经存在旧成品，新任务失败时不会先把旧文件破坏掉。

## Android Native 安全边界

Android 原生正式任务采用：

```text
SAF input
   │
   ├── seekable → direct reusable SAF read
   └── non-seekable → app-private staging
                         │
                         ▼
                app-private job output
                         │
                         ▼
                   FFprobe verify
                         │
                         ▼
              ContentResolver export
```

它不会默认直接把长时间 FFmpeg 输出写入最终 SAF 文件。

这样做是为了避免：

- provider 不可 seek；
- 中途失败留下损坏成品；
- Activity 被杀后任务丢失；
- 输出尚未验证就覆盖旧文件。

同时会检查 app-private 可用空间，正式压制过程中也保留 emergency reserve。

## 任务状态、取消与恢复

Windows 和 Android 都把正式压制作为“单一 owned job”。

原则：

- 同时只能有一个正式 native encode；
- 禁止重复启动竞争同一个 FFmpeg session；
- 支持显式取消；
- 临时文件按任务隔离；
- 成功之前不把临时输出当成最终成品；
- Android 长任务通过 foreground service 存活；
- Android 完成任务可以在 Activity / WebView 变化后继续读取状态和导出。

## 本机性能历史

Android Native 会保存近期成功压制记录，例如：

- codec
- preset
- width / height
- fps
- average speed

对相同规格的后续任务，用最近记录的中位数估计 ETA。

它不是全局 benchmark，也不会把旧设备 / 不同分辨率的数据硬套到当前任务。

## Android APK 与更新

当前 Android 包名：

```text
io.github.quickhardsub
```

当前 native 版本线：

```text
0.2.1-native
```

APK 工作流会验证：

- package name；
- versionCode / versionName；
- signer SHA-256；
- APK SHA-256；
- 16 KiB ZIP alignment；
- ARM64 native ELF LOAD alignment。

Pages 发布时，APK 与 `app-update.json` 必须来自 **同一个 commit**。

更新清单使用 versioned APK URL，避免浏览器 / CDN 旧 APK 缓存。

## 界面

当前项目已经不再使用早期 WinForms 作为主界面。

统一入口是现代 Web UI，按运行环境自动切换：

```text
Windows Native
Android Native
Browser
```

UI 包含：

- 固定深色工作台（不再提供浅色或跟随系统主题切换）；
- 平台状态；
- 视频 / ASS / 字体输入；
- 预检；
- 字幕预览；
- 编码方案；
- 质量校准；
- 样本测试；
- 正式压制；
- ETA / 进度；
- 环境诊断；
- 技术日志；
- Android 版本 / 更新信息。

Windows 与 Android 共用同一套自适应信息架构。界面按可用窗口宽度分为 compact / medium / expanded / large / extra-large 五档，而不是按“手机 / 桌面”维护两套页面：窄窗口优先单列和触控目标，中等窗口恢复双列输入，宽窗口把真实字幕预览与压制方案并列，更宽窗口进一步提高输入和工作区的信息密度。Windows 窗口缩放与 Android 横竖屏使用同一套重排原则。

## Windows 快速开始

1. 下载仓库 ZIP 或 clone；
2. 确认 Windows 可以安装 / 找到 FFmpeg；
3. 双击：

```text
windows/start_windows.bat
```

Bridge 的 FFmpeg 搜索顺序：

1. `tools/ffmpeg/bin/`
2. `tools/ffmpeg/`
3. `windows/`
4. WinGet Links
5. 系统 `PATH`

如果需要手动安装：

```powershell
winget install --id Gyan.FFmpeg -e --source winget
```

## Web 本地开发

要求 Node.js。

```bash
git clone https://github.com/11576865/Quick-Automatic-Hardsub-Encoder.git
cd Quick-Automatic-Hardsub-Encoder
npm install
npm run dev
```

Vite 已配置本地 COOP / COEP。

GitHub Pages 无法直接设置这些响应头，因此静态部署使用 `coi-serviceworker` 提供 SharedArrayBuffer / pthread 所需的 cross-origin isolation。

## CI / 构建体系

仓库目前包含独立工作流：

### FFmpeg core Release

```text
Build Web Core Release
Build Android Native Core Release
```

`.github/core-lock.json` 固定 FFmpegKitNext revision、Release tag 与 asset 名称。WebAssembly core 和 Android ARM64 Maven bundle 被发布为长期 Release assets，并附带 SHA-256 校验文件；普通应用构建不再依赖 90 天 Actions artifact。

### Android APK + Pages

```text
Build Android and Deploy Frontend
```

同一个 workflow 从锁定的 Core Release 构建 Android APK 与 Web 前端，验证 APK 签名、package、16 KiB ZIP/ELF alignment 后，把 APK 发布到 rolling development Release，并生成指向该不可变版本 APK 的 `app-update.json`。GitHub Pages 只保存网页与更新清单，不再长期保存 APK。

### Windows smoke

```text
Windows local smoke
```

验证：

- PowerShell parser；
- FFmpeg / FFprobe；
- libass；
- x264 / x265 / SVT-AV1 catalog；
- NVENC runtime probe contract；
- GPU 名称探测返回结构；
- UTF-16 ASS normalization；
- localhost Bridge；
- CORS / token；
- old-output preservation；
- synthetic ASS hard-sub encode。

### Pages

Pages 发布现在与 Android APK 构建合并在同一个 workflow 中：

1. 读取并校验固定 Core Release；
2. 构建前端与 Android APK；
3. 校验 APK metadata、签名和 16 KiB 对齐；
4. 将版本化 APK 发布到 `dev-builds` prerelease；
5. 生成与该 APK 同 commit、同 SHA-256 的 `app-update.json`；
6. 仅将 Web 资源和更新清单部署到 GitHub Pages。

这样不再需要跨 workflow 轮询 Android artifact，也不会让普通 APK artifact 保留 90 天。

## 故障预防原则

这个项目已经专门维护：

[docs/failure-prevention-checklist.md](docs/failure-prevention-checklist.md)

其中记录的不是抽象“最佳实践”，而是这个项目在原生 FFmpeg / Android SAF / WebAssembly / libass / MediaCodec / 长任务中需要主动避免的失败模式。

一些重要规则：

- 不因 encoder 名字存在就认为硬件编码可用；
- 不把 FFmpeg return code 当成唯一成功条件；
- 不直接把未验证的 native 输出发布给用户；
- 不让长任务依赖 Activity 生命周期；
- 不假定所有 SAF URI 可 seek；
- 不把 WebView File 与 Android native URI 混为一谈；
- 不把 IndexedDB 字体库当成 native font pool；
- 不允许任意 FFmpeg command 从 JS 进入 native bridge；
- 不允许静默 HDR → SDR；
- 不用短样本冒充整片精确预测；
- 不让成功后的 cleanup 反过来破坏成品。

## 当前边界

### Browser

非 Native 浏览器路径仍有约 1 GiB 输入保护和 WebAssembly 内存限制。

### Android

当前正式默认编码仍以 ARM64 软件 encoder 为主。MediaCodec 处于能力探测 / 实验路径，不应描述成稳定默认硬件加速。

### HDR / 10-bit

当前不做正式压制。

### 自动质量策略

当前已有真实 sample / SSIM / size / speed 校准，但“自动选择最优方案”仍然是一套工程策略，不是绝对画质评价器。

### 跨平台一致性

Windows、Android、Web 共享同一套交互和决策逻辑，但底层 FFmpeg build、硬件、文件 API 和 codec 能力不同，因此具体编码器可用性以运行时探测为准。

## License

本仓库原创代码采用 [MIT License](LICENSE)。

但最终分发物包含的第三方组件遵守各自许可证。

特别是当前 Web / Android native core 使用：

```text
--enable-gpl
x264
x265
```

因此不能只看仓库根目录的 MIT 就推断组合二进制也是纯 MIT。

详见：

[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)

## 项目状态说明

仓库中的 `PROJECT_STATUS.md` 记录了较早的 v0.1 阶段状态，其中一些“仍待实现”的描述已经被后续 Windows Native、Android Native 和 CI 工作覆盖。

当前 README 以 main 的实际代码和 CI 为准；`PROJECT_STATUS.md` 更适合作为早期阶段记录，而不是当前完整能力清单。
