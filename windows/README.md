# Windows 11 本地压制

下载仓库 ZIP，解压后双击 `windows/start_windows.bat`。使用 Windows 自带的 PowerShell 和文件选择窗口；普通使用不需要 Android App、Node.js 或 Python。软件在本机读写视频，不上传到网页。

首次启动会寻找 FFmpeg 和 FFprobe，顺序是仓库内的 `tools/ffmpeg/bin/`、`tools/ffmpeg/`、脚本所在目录，再查找 WinGet 链接和系统 `PATH`。已有 FFmpeg 的用户直接使用。没有 FFmpeg 的用户点“检查 / 安装 FFmpeg”，可以通过 `winget install --id Gyan.FFmpeg -e --source winget` 安装；如果设备不提供 winget，也可以从 [FFmpeg 官方下载页](https://ffmpeg.org/download.html)取得 Windows 构建，把 `ffmpeg.exe`、`ffprobe.exe` 放到 `tools/ffmpeg/bin/`。安装后重新启动界面。WinGet 安装可能需要网络与许可确认。

选择视频、ASS、必要的字体文件和 MKV 输出路径，选择 H.264、H.265 或 AV1，再开始压制。音频直接复制。显示 FFprobe 读取的时长与实际 FFmpeg 进度；可以取消。压制使用系统现有的 `libass` 与软件编码器，因此 FFmpeg 必须包含所选编码器和 `ass` 滤镜。字体文件会临时复制到仅供这次压制使用的目录，结束后删除。视频文件由 FFmpeg 直接读取，不会复制整片；不受网页版 1 GiB 限制，但输出需要足够磁盘空间。

这是 Windows 本地压制的第一版，提供文件选择、基础校验、质量模式、进度与取消。网页中的真实预览、三编码器样本比较、自动质量校准和字体缺字检查尚未接入这个原生入口，压制前请自行核对字体和字幕。FFmpeg 内含的编码器及性能取决于具体构建；AV1 可能耗时较长。请先用短视频验证输出画面、声音与字幕。

开发者可以运行 `npm install` / `npm run dev` 启动网页版；这与本地 PowerShell 入口相互独立。GitHub Pages 仍需要完整 FFmpeg Web 核心才能进行网页压制。
