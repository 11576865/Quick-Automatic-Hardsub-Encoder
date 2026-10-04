# Windows Native

Windows 上默认使用 **现代 Web UI + 后台 Native Bridge**。实际视频处理仍由本机 FFmpeg、CPU 和 NVIDIA NVENC 完成；浏览器只负责界面与控制。

## 启动

普通使用：

```text
windows/start_windows.bat
```

它会：

1. 打开一个 **Windows Native Bridge 状态控制台**；
2. 只监听 `127.0.0.1`；
3. 生成本次启动专用随机 token；
4. 自动打开项目的现代 Web UI；
5. Web UI 检测到 Bridge 后优先使用 Windows Native，而不是 FFmpeg WASM。

控制台会显示 Bridge 端口、FFmpeg 路径/版本、CPU、GPU、可用编码器以及主要任务状态。**使用 Windows Native 时请保持该窗口开启；关闭它会断开本机后端。**

页面首次连接成功后，会把本次 localhost Bridge 凭据保存到当前浏览器标签页的 `sessionStorage`。因此普通刷新仍保持 Windows Native；Bridge 已退出时，过期会话会自动清除，不会长期误判为 Native。

如果确实希望后台静默运行，可以改用：

```text
windows/start_windows_background.bat
```

正常使用时不会出现旧 WinForms 主窗口。只有选择视频、ASS、字体或保存成品时，会按需出现 Windows 系统文件对话框。

## 调试入口

需要让 Bridge 在当前命令窗口前台运行、便于观察 PowerShell 级错误时：

```text
windows/start_windows_debug.bat
```

默认 `start_windows.bat` 已经会显示正常状态控制台；debug 入口主要用于让启动脚本本身保持前台并在失败时暂停。

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

FFmpeg 解析不再直接采用 `PATH` 中第一个命中的可执行文件。Bridge 会把 `ffmpeg.exe` 与同目录 `ffprobe.exe` 视为一个工具链，并对候选进行版本和能力探测，以避免 Miniconda/Anaconda base 环境中的旧 FFmpeg 抢占系统新版。

优先来源：

1. 环境变量 `QUICK_HARDSUB_FFMPEG` 显式指定；
2. `tools/ffmpeg/bin/`、`tools/ffmpeg/`、`windows/` 内的项目版本；
3. WinGet Links 与 Gyan.FFmpeg 的 WinGet 安装目录；
4. 系统 `PATH` 中的其他候选。

同一来源层级内优先选择版本更高、支持 `-fps_mode` 和 NVENC `-multipass fullres` 的工具链；Conda/Miniconda/Anaconda 路径会降权。界面会显示实际版本、来源、完整路径以及能力降级警告。

如果需要强制指定某一份 FFmpeg：

```powershell
$env:QUICK_HARDSUB_FFMPEG = 'D:\Tools\ffmpeg\bin\ffmpeg.exe'
windows\start_windows.bat
```

可安装：

```powershell
winget install --id Gyan.FFmpeg -e --source winget
```

## Bink 2 / .bk2 输入

Windows Native 可以识别 `.bk2` / Bink 2 输入，但当前 FFmpeg 不能直接解码 Bink 2 视频。项目因此提供一个**可选外部输入适配器**：

```text
原始 .bk2
  → RAD Video Tools（外部依赖）
  → 临时 AVI staging
  → FFprobe / FFmpeg 实际解码验证
  → 现有纯转码 / 硬字幕流程
```

RAD Video Tools **不随本项目分发或捆绑**。Bridge 会按以下顺序寻找本机工具：

1. `RADVIDEO64` 环境变量；
2. `RADVIDEO_HOME`；
3. 项目附近的 `tools/radvideo/`；
4. 常见 Program Files 安装目录；
5. 系统 `PATH`。

检测到 Bink 2 且 FFmpeg 无法解码时，Web UI 会明确区分“元数据可读取”和“视频不可解码”，并在 RAD 可用时提供 **使用 RAD Video Tools 导入**。导入是一个独立长任务，可以取消；未知进度时只显示阶段和已用时间，不伪造百分比或 ETA。

外部导入不会修改原始 `.bk2`。临时 AVI 只用于本次 Bridge 会话，并在更换源视频或关闭 Bridge 时清理。由于视频已经经过 RAD 解码，导入后不会提供“无损快速剪切 / Stream Copy”作为原始 Bink 码流复制语义；应选择纯视频转码或硬字幕压制。

Bink 2 素材可能包含多音轨或 Alpha 等额外语义。当前适配器只保证“RAD staging 可以被 FFmpeg 实际解码”这一执行前提，不声称这些高级语义一定被无损保留；重要游戏素材应在实际输出后核对轨道与透明信息。

如果 RAD 没有被自动找到，可以显式指定：

```powershell
$env:RADVIDEO64 = 'D:\Tools\RADVideo\radvideo64.exe'
# 或
$env:RADVIDEO_HOME = 'D:\Tools\RADVideo'
windows\start_windows.bat
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
