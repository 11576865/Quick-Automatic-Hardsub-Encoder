const VENDOR_ENTRY = './vendor/ffmpeg-kit-next-web/dist/index.js';

export class EncoderEngine {
  constructor(onLog = () => {}) {
    this.onLog = onLog;
    this.api = null;
    this.ready = false;
    this.mediaInfo = null;
    this.inputPath = '/input/source.bin';
    this.assPath = '/subtitle.ass';
    this.fontDir = '/fonts';
  }

  async init() {
    try {
      this.api = await import(/* @vite-ignore */ new URL(VENDOR_ENTRY, document.baseURI).href);
    } catch (error) {
      this.onLog(`FFmpegKitNext Web core 未找到：${error.message}`);
      return { ready: false, reason: 'missing-core' };
    }

    const { FFmpegKitConfig } = this.api;
    FFmpegKitConfig.enableLogCallback?.(log => this.onLog(log.getMessage?.() ?? String(log)));
    await FFmpegKitConfig.init(false);
    this.ready = true;
    return { ready: true };
  }

  async stageFiles(videoFile, assFile, fontFiles = []) {
    this.assertReady();
    const { mount, writeFile, FFmpegKitConfig } = this.api;

    const stamp = Date.now();
    const inputMount = `/input_${stamp}`;
    this.fontDir = `/fonts_${stamp}`;

    await mount(inputMount, { files: [videoFile] });
    this.inputPath = `${inputMount}/${videoFile.name}`;
    await writeFile(this.assPath, new Uint8Array(await assFile.arrayBuffer()));

    if (fontFiles.length) await mount(this.fontDir, { files: fontFiles });
    FFmpegKitConfig.setFontDirectoryList?.(fontFiles.length ? [this.fontDir] : []);
  }

  async probe() {
    this.assertReady();
    const { FFprobeKit } = this.api;
    const session = await FFprobeKit.getMediaInformation(this.inputPath);
    const info = session.getMediaInformation?.();
    if (!info) throw new Error((await session.getOutput?.()) || 'FFprobe 无法读取视频信息');
    this.mediaInfo = info;
    return normalizeMediaInfo(info);
  }

  async detectSoftwareEncoders() {
    this.assertReady();
    const output = await this.execute('-hide_banner -encoders', true);
    return {
      h264: /\blibx264\b/.test(output),
      h265: /\blibx265\b/.test(output),
      av1: /\blibsvtav1\b/.test(output)
    };
  }

  async renderPreview(timeSeconds, index = 0) {
    this.assertReady();
    const output = `/preview_${index}.png`;
    const filter = `ass=${escapeFilter(this.assPath)}:fontsdir=${escapeFilter(this.fontDir)}`;
    const decoder = this.inputDecoderArgs();
    const cmd = `-y -ss ${Math.max(0, timeSeconds).toFixed(3)} ${decoder}-i ${q(this.inputPath)} -vf ${q(filter)} -frames:v 1 ${q(output)}`;
    await this.execute(cmd, false, 60000);
    const bytes = await this.api.readFile(output);
    if (!bytes) throw new Error('预览帧没有生成');
    return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  }

  async benchmarkCodec(codecKey, options = {}) {
    this.assertReady();
    const duration = options.duration ?? 6;
    const start = options.start ?? 0;
    const crf = options.crf ?? defaultCrf(codecKey);
    const preset = options.preset ?? defaultPreset(codecKey);
    const encoder = encoderName(codecKey);
    const out = `/sample_${codecKey}.mkv`;
    const filter = options.withSubtitles
      ? `ass=${escapeFilter(this.assPath)}:fontsdir=${escapeFilter(this.fontDir)}`
      : null;
    const vf = filter ? ` -vf ${q(filter)}` : '';
    const extra = codecExtra(codecKey);
    const decoder = this.inputDecoderArgs();
    const cmd = `-y -ss ${start.toFixed(3)} -t ${duration.toFixed(3)} ${decoder}-i ${q(this.inputPath)} -an -sn${vf} -c:v ${encoder} -preset ${preset} -crf ${crf}${extra} ${q(out)}`;
    const t0 = performance.now();
    await this.execute(cmd, false, options.timeoutMs ?? 120000);
    const elapsedSeconds = (performance.now() - t0) / 1000;
    const bytes = await this.api.readFile(out);
    if (!bytes) throw new Error(`${codecKey} 样本没有生成`);

    const ssim = await this.measureSsim(out, start, duration).catch(() => null);
    return {
      codecKey,
      encoder,
      crf,
      preset,
      elapsedSeconds,
      sampleBytes: bytes.byteLength,
      ssim,
      encodeSpeed: duration / elapsedSeconds
    };
  }

  async measureSsim(encodedPath, sourceStart, duration) {
    const decoder = this.inputDecoderArgs();
    const cmd = `-ss ${sourceStart.toFixed(3)} -t ${duration.toFixed(3)} ${decoder}-i ${q(this.inputPath)} -i ${q(encodedPath)} -filter_complex ${q('[0:v]setpts=PTS-STARTPTS[ref];[1:v]setpts=PTS-STARTPTS[test];[ref][test]ssim')} -f null -`;
    const output = await this.execute(cmd, true);
    const m = output.match(/All:([0-9.]+)/g)?.at(-1)?.match(/All:([0-9.]+)/);
    return m ? Number(m[1]) : null;
  }

  async encodeFull(codecKey, options = {}) {
    this.assertReady();
    const crf = options.crf ?? defaultCrf(codecKey);
    const preset = options.preset ?? defaultPreset(codecKey);
    const encoder = encoderName(codecKey);
    const output = `/output_${codecKey}.mkv`;
    const filter = `ass=${escapeFilter(this.assPath)}:fontsdir=${escapeFilter(this.fontDir)}`;
    const extra = codecExtra(codecKey);
    const decoder = this.inputDecoderArgs();
    const cmd = `-y ${decoder}-i ${q(this.inputPath)} -map 0:v:0 -map 0:a? -sn -vf ${q(filter)} -c:v ${encoder} -preset ${preset} -crf ${crf}${extra} -c:a copy ${q(output)}`;
    await this.execute(cmd);
    const bytes = await this.api.readFile(output);
    if (!bytes) throw new Error('成品文件没有生成');
    return bytes;
  }

  inputDecoderArgs() {
    return this.mediaInfo?.videoCodec === 'av1' ? '-c:v libdav1d ' : '';
  }

  async execute(command, returnOutput = false, timeoutMs = 0) {
    const { FFmpegKit, ReturnCode } = this.api;
    this.onLog(`$ ffmpeg ${command}`);

    let timer = null;
    let timedOut = false;

    const runPromise = FFmpegKit.execute(command);
    const timeoutPromise = timeoutMs > 0
      ? new Promise((_, reject) => {
          timer = setTimeout(async () => {
            timedOut = true;
            this.onLog(`FFmpeg 超时（${Math.round(timeoutMs / 1000)} 秒），正在取消当前会话…`);
            try { await FFmpegKit.cancel(); } catch {}
            reject(new Error(`FFmpeg 超时：超过 ${Math.round(timeoutMs / 1000)} 秒，已取消当前任务`));
          }, timeoutMs);
        })
      : null;

    let session;
    try {
      session = timeoutPromise ? await Promise.race([runPromise, timeoutPromise]) : await runPromise;
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (timedOut) throw new Error('FFmpeg 会话已因超时取消');

    const rc = session.getReturnCode?.();
    const output = await session.getAllLogsAsString?.(1000) || await session.getOutput?.() || '';
    if (!ReturnCode.isSuccess(rc)) throw new Error(output || `FFmpeg 执行失败：${rc}`);
    return returnOutput ? output : session;
  }

  assertReady() {
    if (!this.ready || !this.api) throw new Error('FFmpeg Web 核心尚未加载');
  }
}

function normalizeMediaInfo(info) {
  const raw = typeof info.toJSON === 'function' ? info.toJSON() : info;
  const streams = raw.streams || raw.getStreams?.() || [];
  const format = raw.format || raw;
  const video = streams.find?.(s => (s.codec_type || s.type) === 'video') || {};
  const audio = streams.find?.(s => (s.codec_type || s.type) === 'audio') || {};
  return {
    duration: Number(format.duration || raw.duration || 0),
    size: Number(format.size || raw.size || 0),
    bitRate: Number(format.bit_rate || raw.bitrate || 0),
    videoCodec: video.codec_name || video.codec || 'unknown',
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: parseFps(video.avg_frame_rate || video.r_frame_rate),
    pixelFormat: video.pix_fmt || '',
    audioCodec: audio.codec_name || audio.codec || '',
    audioBitRate: Number(audio.bit_rate || 0)
  };
}

function parseFps(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const [a, b] = String(value).split('/').map(Number);
  return b ? a / b : a || 0;
}
function q(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
function escapeFilter(value) { return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'"); }
function encoderName(k) { return k === 'h264' ? 'libx264' : k === 'h265' ? 'libx265' : 'libsvtav1'; }
function defaultCrf(k) { return k === 'h264' ? 18 : k === 'h265' ? 20 : 28; }
function defaultPreset(k) { return k === 'av1' ? '8' : 'medium'; }
function codecExtra(k) { return k === 'av1' ? ' -svtav1-params lp=4' : ''; }
