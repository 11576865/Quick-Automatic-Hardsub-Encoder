# Windows Native

Windows 上默认使用 **现代 Web UI + 后台 Native Bridge**。实际视频处理仍由本机 FFmpeg、CPU 和 NVIDIA NVENC 完成；浏览器只负责界面与控制。

## 启动

普通使用：

```text
windows/start_windows.bat
```

它会：

1. 隐藏启动 `native-bridge.ps1`；
2. 只监听 `127.0.0.1`；
3. 生成本次启动专用随机 token；
4. 自动打开项目的现代 Web UI；
5. Web UI 检测到 Bridge 后优先使用 Windows Native，而不是 FFmpeg WASM。

正常使用时不会再出现旧 WinForms 主窗口。只有选择视频、ASS、字体或保存成品时，会按需出现 Windows 系统文件对话框。

## 调试入口

需要查看后台控制台：

```text
windows/start_windows_debug.bat
```

需要旧 WinForms 工具做兼容/诊断：

```text
windows/start_windows_legacy_ui.bat
```

旧 WinForms 界面不再是默认入口。

## 本机后端

Bridge 自动检测：

- FFmpeg / FFprobe
- CPU
- NVIDIA GPU
- `h264_nvenc`
- `hevc_nvenc`
- `av1_nvenc`
- `libx264`
- `libx265`
- `libsvtav1`
- libass / SSIM

同一编码格式优先使用实际运行探测通过的 NVENC；没有可用 NVENC 时回退 CPU 软件编码器。NVENC 探测失败时，现代 Web UI 会显示 FFmpeg 的错误摘要。

FFmpeg 查找顺序：

1. `tools/ffmpeg/bin/`
2. `tools/ffmpeg/`
3. `windows/`
4. WinGet Links
5. 系统 `PATH`

可安装：

```powershell
winget install --id Gyan.FFmpeg -e --source winget
```

## Bridge 安全边界

- 只绑定 `127.0.0.1`，不对局域网开放。
- 每次启动生成随机 token。
- Web UI 的 Bridge 请求必须携带 token。
- CORS 只允许项目 GitHub Pages 与 localhost 开发环境。
- 视频路径保存在 Bridge 内部，不传给网页。
- ASS 与字体只在用户主动选择后用于当前会话。
- 正式成品仍先写临时文件并经过 FFprobe 验证，再安全发布到用户选择的位置。

## 界面与实际处理

```text
现代 Web UI
    │
    └─ 127.0.0.1 Native Bridge
           │
           ├─ ffprobe
           ├─ libass
           ├─ NVIDIA NVENC
           └─ x264 / x265 / SVT-AV1
```

因此 UI 在浏览器里并不会降低本机编码性能。FFmpeg 仍直接使用系统文件、CPU 与 GPU。
