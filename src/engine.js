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
    this.sourceVideoFile = null;
    this.sourceAssFile = null;
    this.sourceFontFiles = [];
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
    this.sourceVideoFile = videoFile;
    this.sourceAssFile = assFile;
    this.sourceFontFiles = [...fontFiles];
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
    const normalized = normalizeMediaInfo(info);
    this.mediaInfo = normalized;
    return normalized;
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

  async detectSoftwareDecoders() {
    this.assertReady();
    let av1Dav1d = false;
    try {
      const output = await this.execute('-hide_banner -h decoder=libdav1d', true, 15000);
      av1Dav1d = /libdav1d/i.test(output) && !/unknown decoder/i.test(output);
    } catch {
      av1Dav1d = false;
    }
    return { av1Dav1d };
  }

  async testDav1dInput(timeSeconds = 0) {
    this.assertReady();
    const cmd = `-v error -ss ${Math.max(0, timeSeconds).toFixed(3)} -c:v libdav1d -i ${q(this.inputPath)} -frames:v 1 -an -sn -f null -`;
    await this.execute(cmd, false, 30000);
    return true;
  }

  async testInputDecode(timeSeconds = 0) {
    this.assertReady();
    const decoder = this.inputDecoderArgs();
    const cmd = `-v error -ss ${Math.max(0, timeSeconds).toFixed(3)} ${decoder}-i ${q(this.inputPath)} -frames:v 1 -an -sn -f null -`;
    await this.execute(cmd, false, 30000);
    return true;
  }

  async renderPreview(timeSeconds, index = 0) {
    this.assertReady();
    const output = `/preview_${index}.png`;
    const filter = `ass=${escapeFilter(this.assPath)}:fontsdir=${escapeFilter(this.fontDir)}`;
    const decoder = this.inputDecoderArgs();
    const cmd = `-y -ss ${Math.max(0, timeSeconds).toFixed(3)} ${decoder}-i ${q(this.inputPath)} -vf ${q(filter)} -frames:v 1 ${q(output)}`;
    const logs = await this.execute(cmd, true, 60000);
    const bytes = await this.api.readFile(output);
    if (!bytes) throw new Error('预览帧没有生成');
    return {
      url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
      fontEvents: parseLibassFontEvents(logs)
    };
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

  async encodeFullStream(codecKey, options = {}) {
    this.assertReady();
    const { FFmpegKit, ReturnCode, FFmpegKitStreamOutput } = this.api;
    if (!FFmpegKitStreamOutput) throw new Error('当前 Web core 不支持流式输出');

    const crf = options.crf ?? defaultCrf(codecKey);
    const preset = options.preset ?? defaultPreset(codecKey);
    const encoder = encoderName(codecKey);
    const filter = `ass=${escapeFilter(this.assPath)}:fontsdir=${escapeFilter(this.fontDir)}`;
    const extra = codecExtra(codecKey);
    const decoder = this.inputDecoderArgs();
    const targetVideoBitrate = Number(options.targetVideoBitrate || 0);
    const passlog = `/twopass_${codecKey}_${Date.now()}`;

    if (targetVideoBitrate > 0) {
      options.onPhase?.('pass1');
      const firstPass = `-y ${decoder}-i ${q(this.inputPath)} -map 0:v:0 -sn -vf ${q(filter)} -c:v ${encoder} -preset ${preset} -b:v ${Math.round(targetVideoBitrate)} -pass 1 -passlogfile ${q(passlog)}${extra} -an -f null -`;
      this.onLog(`两遍目标体积编码：第一遍统计，目标视频码率 ${Math.round(targetVideoBitrate / 1000)} kb/s`);
      await this.execute(firstPass);
    }

    options.onPhase?.(targetVideoBitrate > 0 ? 'pass2' : 'encode');
    const stream = await FFmpegKitStreamOutput.create('mkv', 8 * 1024 * 1024);
    const target = stream.getUrl();
    const rateControl = targetVideoBitrate > 0
      ? `-b:v ${Math.round(targetVideoBitrate)} -pass 2 -passlogfile ${q(passlog)}`
      : `-crf ${crf}`;
    const cmd = `-y ${decoder}-i ${q(this.inputPath)} -map 0:v:0 -map 0:a? -sn -vf ${q(filter)} -c:v ${encoder} -preset ${preset} ${rateControl}${extra} -c:a copy -f matroska ${q(target)}`;
    this.onLog(`$ ffmpeg ${cmd}`);

    let resolveDone;
    let completedSession = null;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const session = await FFmpegKit.executeAsync(cmd, completed => {
      completedSession = completed;
      resolveDone(completed);
    });
    const chunks = [];
    let totalBytes = 0;
    let emptyAfterCompletion = 0;

    try {
      while (true) {
        const chunk = await stream.read(4 * 1024 * 1024);
        if (chunk === null) {
          if (completedSession) {
            emptyAfterCompletion++;
            if (emptyAfterCompletion >= 10) break;
          }
          await sleep(20);
          continue;
        }
        emptyAfterCompletion = 0;
        if (chunk.byteLength === 0) break;

        totalBytes += chunk.byteLength;
        chunks.push(chunk.slice());
        options.onBytes?.(totalBytes);
      }

      const completed = completedSession || await done;
      const rc = completed?.getReturnCode?.();
      if (!ReturnCode.isSuccess(rc)) {
        const output = await completed?.getAllLogsAsString?.(1000) || await completed?.getOutput?.() || '';
        throw new Error(output || `FFmpeg 流式编码失败：${rc}`);
      }

      return {
        blob: new Blob(chunks, { type: 'video/x-matroska' }),
        byteLength: totalBytes
      };
    } finally {
      try { await stream.close(); } catch {}
    }
  }

  async resetRuntime(reason = '释放工作内存') {
    if (!this.api) return;
    const video = this.sourceVideoFile;
    const ass = this.sourceAssFile;
    const fonts = [...this.sourceFontFiles];
    const mediaInfo = this.mediaInfo;

    this.onLog(`重启 FFmpeg WASM runtime：${reason}`);
    try { await this.api.FFmpegKit?.cancel(); } catch {}
    try { await this.api.FFmpegKitConfig?.uninit(); } catch {}
    this.ready = false;

    const status = await this.init();
    if (!status.ready) throw new Error('FFmpeg WASM runtime 重启失败');
    if (video && ass) await this.stageFiles(video, ass, fonts);
    this.mediaInfo = mediaInfo;
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
    } catch (error) {
      if (timedOut) {
        try { await this.resetRuntime('超时后清理损坏/残留会话'); }
        catch (recoveryError) { this.onLog(`runtime 恢复失败：${recoveryError.message}`); }
      }
      throw error;
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
  const raw = typeof info.toJSON === 'function'
    ? info.toJSON()
    : typeof info.getAllProperties === 'function'
      ? info.getAllProperties()
      : info;
  const rawStreams = raw.streams || info.getStreams?.() || [];
  const streams = rawStreams.map?.(s => typeof s.getAllProperties === 'function' ? s.getAllProperties() : s) || [];
  const format = raw.format || raw.format_properties || raw;
  const video = streams.find?.(s => (s.codec_type || s.type) === 'video') || {};
  const audioStreams = streams.filter?.(s => (s.codec_type || s.type) === 'audio') || [];
  const audio = audioStreams[0] || {};
  const pixelFormat = video.pix_fmt || video.pixel_format || '';
  const bitDepth = inferBitDepth(video, pixelFormat);
  const colorTransfer = video.color_transfer || '';
  const colorPrimaries = video.color_primaries || '';
  const colorSpace = video.color_space || '';
  const hdr = /smpte2084|arib-std-b67/i.test(colorTransfer)
    || (/bt2020/i.test(colorPrimaries) && bitDepth > 8);
  const highBitDepth = bitDepth > 8;

  return {
    duration: Number(format.duration || raw.duration || 0),
    size: Number(format.size || raw.size || 0),
    bitRate: Number(format.bit_rate || raw.bitrate || 0),
    videoCodec: video.codec_name || video.codec || 'unknown',
    videoBitRate: Number(video.bit_rate || video.bitrate || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: parseFps(video.avg_frame_rate || video.r_frame_rate),
    pixelFormat,
    bitDepth,
    colorTransfer,
    colorPrimaries,
    colorSpace,
    hdr,
    highBitDepth,
    unsafeColorPipeline: hdr || highBitDepth,
    audioCodec: audio.codec_name || audio.codec || '',
    audioTracks: audioStreams.length,
    audioBitRate: audioStreams.reduce((sum, s) => sum + Number(s.bit_rate || s.bitrate || 0), 0)
  };
}

function inferBitDepth(video, pixelFormat = '') {
  const explicit = Number(video.bits_per_raw_sample || video.bits_per_component || 0);
  if (explicit) return explicit;
  const m = String(pixelFormat).match(/(?:p|yuv\d*p?)(10|12|14|16)(?:le|be)?/i) || String(pixelFormat).match(/(10|12|14|16)(?:le|be)/i);
  return m ? Number(m[1]) : 8;
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
function parseLibassFontEvents(logs = '') {
  return String(logs)
    .split(/\r?\n/)
    .filter(line => /fontselect:|Glyph .* not found|failed to find.*fallback|font provider/i.test(line))
    .map(line => line.replace(/^.*?(?=(?:fontselect:|Glyph |failed to find|font provider))/i, '').trim())
    .filter(Boolean);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
