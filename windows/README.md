# Windows Native

Windows 11 下推荐直接使用本机后端，而不是浏览器 FFmpeg WebAssembly。

## 启动

下载仓库并双击：

```text
windows/start_windows.bat
```

不需要 Node.js、Python 或 Android App。程序使用 PowerShell + WinForms，直接读取本机视频，并调用系统/仓库内的 FFmpeg。

## FFmpeg 查找顺序

程序依次检查：

1. `tools/ffmpeg/bin/`
2. `tools/ffmpeg/`
3. `windows/`
4. WinGet Links
5. 系统 `PATH`

缺少 FFmpeg 时，可以在界面里调用：

```powershell
winget install --id Gyan.FFmpeg -e --source winget
```

FFmpeg 必须包含 `ass` / libass。

## Windows Native 硬件检测

启动时会检测：

- CPU 型号
- NVIDIA GPU 型号（优先 `nvidia-smi`，否则 WMI）
- `h264_nvenc`
- `hevc_nvenc`
- `av1_nvenc`
- `libx264`
- `libx265`
- `libsvtav1`

NVENC 不是只检查 `ffmpeg -encoders`。程序还会实际执行一帧编码探测；只有 FFmpeg 支持、驱动可用且 GPU 能成功启动编码时，才标记为“可用”。

## 编码器

正式压制可以使用本机实际可用的以下方案：

| 格式 | GPU | CPU |
|---|---|---|
| H.264 | `h264_nvenc` | `libx264` |
| H.265 / HEVC | `hevc_nvenc` | `libx265` |
| AV1 | `av1_nvenc` | `libsvtav1` |

NVENC 默认使用 P7；如果当前 FFmpeg 的对应编码器公开 `uhq` tuning，则优先使用 UHQ，否则使用 HQ。CPU 路径继续使用 CRF。

ASS 仍通过 CPU 侧 libass 滤镜渲染，然后将视频帧交给所选编码器。音频默认 stream copy。

## 短样本比较

选择视频、ASS 和一种编码格式后，点击：

> 测试同格式 GPU / CPU

程序会：

1. 从原片抽取约 10 秒片段；
2. 用同一份 ASS 和字体生成无损 FFV1 参考；
3. 对当前格式下所有可用编码器分别编码；
4. 记录：
   - 编码耗时
   - 实时倍速
   - 文件大小
   - SSIM
5. 在同一格式内部自动选择建议方案。

自动选择规则刻意保持简单：

- 如果 NVENC 的 SSIM 与该组最佳结果相差不超过 0.002；
- 文件大小不超过软件方案约 18%；
- 并且速度更快；

则优先 NVENC。否则，在 SSIM 接近最佳结果（0.001 内）的方案中优先较小文件，再比较耗时。

这不是“GPU 一定优于 CPU”的评分，而是把画质、体积和实际时间同时展示出来。

## 输出安全

正式编码先写到目标目录中的临时 MKV。FFmpeg 成功后还会用 FFprobe 检查视频流；只有验证通过才替换旧成品。

因此：

- 取消任务不会删除旧成品；
- 编码失败不会覆盖旧成品；
- 临时输出为空或无法被 FFprobe 识别时不会发布。

## RTX 50 系列

如果机器安装了支持当前 GPU 的 NVIDIA 驱动，并且所用 FFmpeg 构建包含 NVENC，RTX 50 系列会自动出现在 GPU 信息和可用编码器列表中。无需在脚本里写死具体显卡型号。
