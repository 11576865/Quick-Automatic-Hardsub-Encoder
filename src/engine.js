const VENDOR_ENTRY = './vendor/ffmpeg-kit-next-web/dist/index.js';
const FALLBACK_FONT_URL = './vendor/fallback-fonts/NotoSansSC-Regular.otf';
const FALLBACK_FONT_FAMILY = 'Noto Sans SC';

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
    this.activeAssText = null;
    this.activeFontMappings = {};
    this.bundledFallbackFont = null;
    this.hasBundledFallbackFont = false;
    this.fallbackFontFamily = FALLBACK_FONT_FAMILY;
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
    this.activeAssText = null;
    this.activeFontMappings = {};
    const { mount, writeFile, FFmpegKitConfig } = this.api;

    const stamp = Date.now();
    const inputMount = `/input_${stamp}`;
    this.fontDir = `/fonts_${stamp}`;

    await mount(inputMount, { files: [videoFile] });
    this.inputPath = `${inputMount}/${videoFile.name}`;
    await writeFile(this.assPath, new Uint8Array(await assFile.arrayBuffer()));

    const fallback = await this.getBundledFallbackFont();
    const mountedFonts = fallback ? [...fontFiles, fallback] : [...fontFiles];
    this.hasBundledFallbackFont = !!fallback;

    if (mountedFonts.length) await mount(this.fontDir, { files: mountedFonts });
    await FFmpegKitConfig.setFontDirectoryList?.(mountedFonts.length ? [this.fontDir] : [], {});
  }

  async getBundledFallbackFont() {
    if (this.bundledFallbackFont) return this.bundledFallbackFont;
    try {
      const url = new URL(FALLBACK_FONT_URL, document.baseURI).href;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      this.bundledFallbackFont = new File(
        [blob],
        'NotoSansSC-Regular.otf',
        { type: 'font/otf' }
      );
      this.onLog(`已加载内置回退字体：${FALLBACK_FONT_FAMILY}`);
      return this.bundledFallbackFont;
    } catch (error) {
      this.onLog(`内置回退字体加载失败：${error.message}`);
      return null;
    }
  }

  async setFontMappings(mappings = {}) {
    this.assertReady();
    this.activeFontMappings = { ...mappings };
    const { FFmpegKitConfig } = this.api;
    await FFmpegKitConfig.setFontDirectoryList?.(
      this.sourceFontFiles.length ? [this.fontDir] : [],
      this.activeFontMappings
    );
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

  async setAssText(text) {
    this.assertReady();
    this.activeAssText = text;
    await this.api.writeFile(this.assPath, new TextEncoder().encode(text));
  }

  async renderPreview(timeSeconds, index = 0, previewAssText = null) {
    this.assertReady();
    const baseOutput = `/preview_base_${index}.png`;
    const output = `/preview_${index}.png`;
    const previewAssPath = previewAssText == null ? this.assPath : `/preview_${index}.ass`;
    const decoder = this.inputDecoderArgs();

    if (previewAssText != null) {
      await this.api.writeFile(previewAssPath, new TextEncoder().encode(previewAssText));
    }

    // 1) Extract the exact source frame without subtitles.
    const extractCmd = `-y -ss ${Math.max(0, timeSeconds).toFixed(3)} ${decoder}-i ${q(this.inputPath)} -an -sn -frames:v 1 ${q(baseOutput)}`;
    await this.execute(extractCmd, false, 60000);

    // 2) Loop that still image for one second. The preview ASS is shifted so
    // the requested subtitle is active around t=0.5s. Rendering away from t=0
    // avoids seek/PTS boundary behaviour that previously produced blank frames.
    const filter = `ass=${escapeFilter(previewAssPath)}:fontsdir=${escapeFilter(this.fontDir)}`;
    const renderCmd = `-y -loop 1 -framerate 10 -i ${q(baseOutput)} -vf ${q(filter)} -ss 0.500 -frames:v 1 ${q(output)}`;
    const logs = await this.execute(renderCmd, true, 60000);

    const [baseBytes, bytes] = await Promise.all([
      this.api.readFile(baseOutput),
      this.api.readFile(output)
    ]);
    if (!baseBytes || !bytes) throw new Error('预览帧没有生成');

    const visualChange = await detectImageDifference(baseBytes, bytes).catch(() => null);
    return {
      url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
      baseUrl: URL.createObjectURL(new Blob([baseBytes], { type: 'image/png' })),
      visualChange,
      fontEvents: parseLibassFontEvents(logs)
    };
  }

  async benchmarkCodec(codecKey, options = {}) {
    this.assertReady();
    const duration = options.duration ?? 6;
    const start = options.start ?? 0;
    const crf = options.crf ?? defaultCrf(codecKey);
    const preset = options.preset ?? defaultPreset(codecKey);
    const targetVideoBitrate = Number(options.targetVideoBitrate || 0);
    const encoder = encoderName(codecKey);
    const out = `/sample_${codecKey}.mkv`;
    const filter = options.withSubtitles
      ? `ass=${escapeFilter(this.assPath)}:fontsdir=${escapeFilter(this.fontDir)}`
      : null;
    const vf = filter ? ` -vf ${q(filter)}` : '';
    const extra = codecExtra(codecKey);
    const decoder = this.inputDecoderArgs();
    const gop = normalGop(this.mediaInfo?.fps || 30);
    const rateControl = targetVideoBitrate > 0
      ? `-b:v ${Math.round(targetVideoBitrate)}`
      : `-crf ${crf}`;
    const cmd = `-y -ss ${start.toFixed(3)} -t ${duration.toFixed(3)} ${decoder}-i ${q(this.inputPath)} -an -sn${vf} -c:v ${encoder} -preset ${preset} -g ${gop} ${rateControl}${extra} ${q(out)}`;
    const t0 = performance.now();
    const logs = await this.execute(cmd, true, options.timeoutMs ?? 120000);
    const elapsedSeconds = (performance.now() - t0) / 1000;
    const bytes = await this.api.readFile(out);
    if (!bytes) throw new Error(`${codecKey} 样本没有生成`);

    const ssim = options.measureSsim === false
      ? null
      : await this.measureSsim(out, start, duration).catch(() => null);
    const packetStats = await this.getVideoPacketStats(out).catch(() => null);
    const averageSpeed = duration / elapsedSeconds;
    const steadySpeed = estimateSteadyStateSpeed(logs);
    return {
      codecKey,
      encoder,
      crf,
      preset,
      elapsedSeconds,
      sampleBytes: bytes.byteLength,
      packetStats,
      gop,
      targetVideoBitrate,
      sampleUrl: URL.createObjectURL(new Blob([bytes], { type: 'video/x-matroska' })),
      ssim,
      averageSpeed,
      encodeSpeed: steadySpeed || averageSpeed,
      speedEstimate: steadySpeed ? 'steady-state' : 'whole-sample'
    };
  }

  async getVideoPacketStats(path) {
    const { FFprobeKit, ReturnCode } = this.api;
    const cmd = `-v error -select_streams v:0 -show_packets -show_entries packet=size,flags -of csv=p=0 ${q(path)}`;
    const session = await FFprobeKit.execute(cmd);
    const rc = session.getReturnCode?.();
    const output = await session.getOutput?.() || '';
    if (ReturnCode && !ReturnCode.isSuccess(rc)) throw new Error(output || 'FFprobe packet 统计失败');

    const packets = String(output).split(/\r?\n/).map(line => {
      const m = line.trim().match(/^(\d+),([^,]*)/);
      if (!m) return null;
      return { size: Number(m[1]), key: /K/.test(m[2]) };
    }).filter(Boolean).filter(p => Number.isFinite(p.size) && p.size > 0);

    if (!packets.length) return null;
    const keyPackets = packets.filter(p => p.key);
    const interPackets = packets.filter(p => !p.key);
    return {
      packetCount: packets.length,
      keyCount: keyPackets.length,
      keyBytes: keyPackets.reduce((n,p) => n + p.size, 0),
      interCount: interPackets.length,
      interBytes: interPackets.reduce((n,p) => n + p.size, 0),
      totalVideoBytes: packets.reduce((n,p) => n + p.size, 0)
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
    const gop = normalGop(this.mediaInfo?.fps || 30);
    const targetVideoBitrate = Number(options.targetVideoBitrate || 0);
    const twoPass = !!options.twoPass && targetVideoBitrate > 0;
    const passlog = `/twopass_${codecKey}_${Date.now()}`;

    if (twoPass) {
      options.onPhase?.('pass1');
      const firstPass = `-y ${decoder}-i ${q(this.inputPath)} -map 0:v:0 -sn -vf ${q(filter)} -c:v ${encoder} -preset ${preset} -g ${gop} -b:v ${Math.round(targetVideoBitrate)} -pass 1 -passlogfile ${q(passlog)}${extra} -an -f null -`;
      this.onLog(`严格目标体积：第一遍统计，目标视频码率 ${Math.round(targetVideoBitrate / 1000)} kb/s`);
      await this.executeWithStatistics(firstPass, options.onStatistics, 'pass1');
    }

    options.onPhase?.(twoPass ? 'pass2' : 'encode');
    const stream = await FFmpegKitStreamOutput.create('mkv', 8 * 1024 * 1024);
    const target = stream.getUrl();
    const rateControl = targetVideoBitrate > 0
      ? twoPass
        ? `-b:v ${Math.round(targetVideoBitrate)} -pass 2 -passlogfile ${q(passlog)}`
        : `-b:v ${Math.round(targetVideoBitrate)}`
      : `-crf ${crf}`;
    const cmd = `-y ${decoder}-i ${q(this.inputPath)} -map 0:v:0 -map 0:a? -sn -vf ${q(filter)} -c:v ${encoder} -preset ${preset} -g ${gop} ${rateControl}${extra} -c:a copy -f matroska ${q(target)}`;
    this.onLog(`$ ffmpeg ${cmd}`);

    let resolveDone;
    let completedSession = null;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const session = await FFmpegKit.executeAsync(
      cmd,
      completed => {
        completedSession = completed;
        resolveDone(completed);
      },
      undefined,
      statistics => {
        try {
          options.onStatistics?.({
            timeMs: Number(statistics?.getTime?.() || 0),
            fps: Number(statistics?.getVideoFps?.() || 0),
            bitrateKbps: Number(statistics?.getBitrate?.() || 0),
            speed: Number(statistics?.getSpeed?.() || 0),
            sizeBytes: Number(statistics?.getSize?.() || 0),
            frame: Number(statistics?.getVideoFrameNumber?.() || 0),
            phase: twoPass ? 'pass2' : 'encode'
          });
        } catch {}
      }
    );
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

  async scanEncodedPackets(blob, expectedDuration = 0) {
    this.assertReady();
    const { mount, FFprobeKit, ReturnCode } = this.api;
    if (!blob || !(blob.size > 0)) throw new Error('成品为空，无法执行 packet 扫描');

    const stamp = Date.now();
    const mountPoint = `/verify_${stamp}`;
    const fileName = 'encoded_output.mkv';
    const path = `${mountPoint}/${fileName}`;

    // WORKERFS mounts the Blob read-only without copying the complete file into
    // the wasm heap. ffprobe then demuxes packets only; it does not decode video.
    await mount(mountPoint, {
      blobs: [{ name: fileName, data: blob }]
    });

    const cmd = `-v error -select_streams v:0 -show_packets -show_entries packet=pts_time,dts_time,duration_time,size,flags -of compact=p=0:nk=0 ${q(path)}`;
    const t0 = performance.now();
    const session = await FFprobeKit.execute(cmd);
    const rc = session.getReturnCode?.();
    const output = await session.getOutput?.() || '';

    if (ReturnCode && !ReturnCode.isSuccess(rc)) {
      throw new Error(output || 'FFprobe packet 扫描失败');
    }

    let packetCount = 0;
    let keyCount = 0;
    let corruptCount = 0;
    let totalVideoBytes = 0;
    let firstTimestamp = Infinity;
    let lastPacketStart = -Infinity;
    let videoEnd = -Infinity;

    for (const rawLine of String(output).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const fields = {};
      for (const part of line.split('|')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        fields[part.slice(0, eq)] = part.slice(eq + 1);
      }

      const pts = Number(fields.pts_time);
      const dts = Number(fields.dts_time);
      const duration = Number(fields.duration_time);
      const size = Number(fields.size);
      const flags = fields.flags || '';
      const timestamp = Number.isFinite(pts) ? pts : Number.isFinite(dts) ? dts : NaN;
      if (!Number.isFinite(timestamp)) continue;

      packetCount++;
      if (/K/.test(flags)) keyCount++;
      if (/C/.test(flags)) corruptCount++;
      if (Number.isFinite(size) && size > 0) totalVideoBytes += size;

      firstTimestamp = Math.min(firstTimestamp, timestamp);
      lastPacketStart = Math.max(lastPacketStart, timestamp);
      const packetEnd = timestamp + (Number.isFinite(duration) && duration > 0 ? duration : 0);
      videoEnd = Math.max(videoEnd, packetEnd);
    }

    if (!packetCount || !Number.isFinite(videoEnd)) {
      throw new Error('FFprobe 未扫描到有效视频 packet');
    }

    const expected = Number(expectedDuration || 0);
    const durationDelta = expected > 0 ? videoEnd - expected : null;
    const fps = Number(this.mediaInfo?.fps || 0);
    const tolerance = Math.max(0.5, fps > 0 ? 2 / fps : 0);
    const durationOk = durationDelta == null || Math.abs(durationDelta) <= tolerance;

    return {
      packetCount,
      keyCount,
      corruptCount,
      totalVideoBytes,
      firstTimestamp: Number.isFinite(firstTimestamp) ? firstTimestamp : null,
      lastPacketStart,
      videoEnd,
      expectedDuration: expected > 0 ? expected : null,
      durationDelta,
      tolerance,
      durationOk,
      ok: packetCount > 0 && corruptCount === 0 && durationOk,
      scanSeconds: (performance.now() - t0) / 1000
    };
  }

  async resetRuntime(reason = '释放工作内存') {
    if (!this.api) return;
    const video = this.sourceVideoFile;
    const ass = this.sourceAssFile;
    const fonts = [...this.sourceFontFiles];
    const mediaInfo = this.mediaInfo;
    const activeAssText = this.activeAssText;
    const activeFontMappings = { ...this.activeFontMappings };

    this.onLog(`重启 FFmpeg WASM runtime：${reason}`);
    try { await this.api.FFmpegKit?.cancel(); } catch {}
    try { await this.api.FFmpegKitConfig?.uninit(); } catch {}
    this.ready = false;

    const status = await this.init();
    if (!status.ready) throw new Error('FFmpeg WASM runtime 重启失败');
    if (video && ass) {
      await this.stageFiles(video, ass, fonts);
      if (activeFontMappings && Object.keys(activeFontMappings).length) {
        await this.setFontMappings(activeFontMappings);
      }
      if (activeAssText) await this.setAssText(activeAssText);
    }
    this.mediaInfo = mediaInfo;
  }

  inputDecoderArgs() {
    return this.mediaInfo?.videoCodec === 'av1' ? '-c:v libdav1d ' : '';
  }

  async executeWithStatistics(command, onStatistics, phase = 'encode') {
    const { FFmpegKit, ReturnCode } = this.api;
    this.onLog(`$ ffmpeg ${command}`);

    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    await FFmpegKit.executeAsync(
      command,
      completed => resolveDone(completed),
      undefined,
      statistics => {
        try {
          onStatistics?.({
            timeMs: Number(statistics?.getTime?.() || 0),
            fps: Number(statistics?.getVideoFps?.() || 0),
            bitrateKbps: Number(statistics?.getBitrate?.() || 0),
            speed: Number(statistics?.getSpeed?.() || 0),
            sizeBytes: Number(statistics?.getSize?.() || 0),
            frame: Number(statistics?.getVideoFrameNumber?.() || 0),
            phase
          });
        } catch {}
      }
    );
    const completed = await done;
    const rc = completed?.getReturnCode?.();
    const output = await completed?.getAllLogsAsString?.(1000) || await completed?.getOutput?.() || '';
    if (!ReturnCode.isSuccess(rc)) throw new Error(output || `FFmpeg 执行失败：${rc}`);
    return completed;
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
function normalGop(fps) {
  const n = Math.round((Number(fps) || 30) * 5);
  return Math.max(48, Math.min(300, n));
}
async function detectImageDifference(aBytes, bBytes) {
  if (typeof createImageBitmap !== 'function') return null;
  const [a, b] = await Promise.all([
    createImageBitmap(new Blob([aBytes], { type: 'image/png' })),
    createImageBitmap(new Blob([bBytes], { type: 'image/png' }))
  ]);
  try {
    if (a.width !== b.width || a.height !== b.height) return true;
    const canvas = document.createElement('canvas');
    canvas.width = a.width;
    canvas.height = a.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(a, 0, 0);
    const p1 = ctx.getImageData(0, 0, a.width, a.height).data;
    ctx.clearRect(0, 0, a.width, a.height);
    ctx.drawImage(b, 0, 0);
    const p2 = ctx.getImageData(0, 0, b.width, b.height).data;

    // Sample at most about 250k pixels. Any visible ASS glyph should alter many
    // samples, while this avoids a full per-pixel scan on 4K frames.
    const pixels = a.width * a.height;
    const step = Math.max(1, Math.floor(pixels / 250000));
    let changed = 0;
    let checked = 0;
    for (let px = 0; px < pixels; px += step) {
      const i = px * 4;
      checked++;
      if (
        Math.abs(p1[i] - p2[i]) > 2 ||
        Math.abs(p1[i + 1] - p2[i + 1]) > 2 ||
        Math.abs(p1[i + 2] - p2[i + 2]) > 2 ||
        Math.abs(p1[i + 3] - p2[i + 3]) > 2
      ) {
        changed++;
        if (changed >= 8) return true;
      }
    }
    return checked > 0 ? false : null;
  } finally {
    a.close();
    b.close();
  }
}

function estimateSteadyStateSpeed(logs = '') {
  const points = [];
  for (const line of String(logs).split(/\r?\n/)) {
    const tm = line.match(/time=(\d+):(\d+):([0-9.]+)/);
    const em = line.match(/elapsed=(\d+):(\d+):([0-9.]+)/);
    if (!tm || !em) continue;
    const media = Number(tm[1]) * 3600 + Number(tm[2]) * 60 + Number(tm[3]);
    const elapsed = Number(em[1]) * 3600 + Number(em[2]) * 60 + Number(em[3]);
    if (Number.isFinite(media) && Number.isFinite(elapsed)) points.push({ media, elapsed });
  }

  if (points.length < 3) return null;

  // Use the latter half of the progress samples so encoder/WASM startup cost does
  // not get extrapolated across the entire movie.
  const startIndex = Math.max(0, Math.floor(points.length / 2) - 1);
  const a = points[startIndex];
  const b = points[points.length - 1];
  const mediaDelta = b.media - a.media;
  const elapsedDelta = b.elapsed - a.elapsed;
  if (mediaDelta <= 0.12 || elapsedDelta <= 0.15) return null;

  const speed = mediaDelta / elapsedDelta;
  return Number.isFinite(speed) && speed > 0 ? speed : null;
}

function parseLibassFontEvents(logs = '') {
  return String(logs)
    .split(/\r?\n/)
    .filter(line => /fontselect:|Glyph .* not found|failed to find.*fallback|font provider/i.test(line))
    .map(line => line.replace(/^.*?(?=(?:fontselect:|Glyph |failed to find|font provider))/i, '').trim())
    .filter(Boolean);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
