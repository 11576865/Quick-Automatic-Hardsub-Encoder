import { parseEncoderHelp, validateEncoderSupport } from './media-capabilities.js';
import { taskSourceArgs, firstPassArgs, retimeTask } from './media-task.js';
import { hardsubReferenceFilter } from './media-verification.js';
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
    this.lastVerifiedOutput = null;
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
    const previousVideo = this.sourceVideoFile;
    const sameVideo = !!(
      previousVideo &&
      videoFile &&
      (
        previousVideo === videoFile ||
        (
          previousVideo.name === videoFile.name &&
          Number(previousVideo.size || 0) === Number(videoFile.size || 0) &&
          Number(previousVideo.lastModified || 0) === Number(videoFile.lastModified || 0)
        )
      )
    );

    this.sourceVideoFile = videoFile;
    this.sourceAssFile = assFile;
    this.sourceFontFiles = [...fontFiles];
    this.activeAssText = null;
    this.activeFontMappings = {};
    const { mount, writeFile, FFmpegKitConfig } = this.api;

    const stamp = Date.now();
    if (!sameVideo) {
      const inputMount = `/input_${stamp}`;
      await mount(inputMount, { files: [videoFile] });
      this.inputPath = `${inputMount}/${videoFile.name}`;
    }

    if (assFile) {
      this.fontDir = `/fonts_${stamp}`;
      await writeFile(this.assPath, new Uint8Array(await assFile.arrayBuffer()));
      const fallback = await this.getBundledFallbackFont();
      const mountedFonts = fallback ? [...fontFiles, fallback] : [...fontFiles];
      this.hasBundledFallbackFont = !!fallback;
      if (mountedFonts.length) await mount(this.fontDir, { files: mountedFonts });
      await FFmpegKitConfig.setFontDirectoryList?.(mountedFonts.length ? [this.fontDir] : [], {});
    } else {
      this.hasBundledFallbackFont = false;
      await FFmpegKitConfig.setFontDirectoryList?.([], {});
    }
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

  async taskCapabilities(encoder) {
    this.taskHelpCache ||= new Map();
    const read=async key=>{
      if(!this.taskHelpCache.has(key)){
        const session=await this.api.FFmpegKit.execute(key==='global'?'-hide_banner -h full':`-hide_banner -h encoder=${key}`);
        const text=await session.getOutput?.() || await session.getAllLogsAsString?.() || '';
        this.taskHelpCache.set(key,parseEncoderHelp(text));
      }
      return this.taskHelpCache.get(key);
    };
    const global=await read('global');
    return {encoder:encoder==='copy'?{}:await read(encoder),globalOptions:global.options,fpsModeSupported:global.options.includes('-fps_mode')};
  }
  async validateTask(task) {
    const caps=await this.taskCapabilities(task.encoder || 'copy');
    validateEncoderSupport(task,caps.encoder,caps.globalOptions);
    if(['aac','libopus'].includes(task.audio)){const audio=await this.taskCapabilities(task.audio);if(!audio.encoder.available)throw Error('当前核心不支持音频编码器 '+task.audio);}
  }

  async probe() {
    this.assertReady();
    const { FFprobeKit } = this.api;
    const session = await FFprobeKit.getMediaInformation(this.inputPath);
    const info = session.getMediaInformation?.();
    if (!info) throw new Error((await session.getOutput?.()) || 'FFprobe 无法读取视频信息');
    const normalized = normalizeMediaInfo(info);

    // Non-seekable Matroska writers cannot seek back to fill Segment Duration.
    // If that metadata is absent, derive the real video end from packets instead
    // of making the entire planner unusable.
    if (!(normalized.duration > 0)) {
      this.onLog('容器没有可用 duration；正在扫描视频 packet 计算实际末端…');
      const scanned = await this.scanInputPacketDuration().catch(error => {
        this.onLog(`输入 packet 时长扫描失败：${error.message}`);
        return null;
      });
      if (scanned?.videoEnd > 0) {
        normalized.duration = scanned.videoEnd;
        normalized.durationSource = 'packet-scan';
        this.onLog(`输入实际视频末端：${scanned.videoEnd.toFixed(3)} s（${scanned.packetCount} 个 packet）`);
      }
    }

    this.mediaInfo = normalized;
    return normalized;
  }

  async scanInputPacketDuration() {
    const { FFprobeKit, ReturnCode } = this.api;
    const cmd = `-v error -select_streams v:0 -show_packets -show_entries packet=pts_time,dts_time,duration_time -of compact=p=0:nk=0 ${q(this.inputPath)}`;
    const session = await FFprobeKit.execute(cmd);
    const rc = session.getReturnCode?.();
    const output = await session.getOutput?.() || '';
    if (ReturnCode && !ReturnCode.isSuccess(rc)) {
      throw new Error(output || 'FFprobe 输入 packet 扫描失败');
    }

    let packetCount = 0;
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
      const timestamp = Number.isFinite(pts) ? pts : Number.isFinite(dts) ? dts : NaN;
      if (!Number.isFinite(timestamp)) continue;

      packetCount++;
      videoEnd = Math.max(
        videoEnd,
        timestamp + (Number.isFinite(duration) && duration > 0 ? duration : 0)
      );
    }

    if (!packetCount || !Number.isFinite(videoEnd)) {
      throw new Error('没有扫描到有效视频 packet');
    }
    return { packetCount, videoEnd };
  }

  async snapTaskStart(task) {
    if (task.operation !== 'copy' || task.videoRange !== 'trim' || task.start <= 0) return task;
    const primary = Number(task.videoStreams?.[0] ?? task.videoStream ?? 0);
    const session = await this.api.FFprobeKit.execute(`-v error -select_streams v:${primary} -skip_frame nokey -read_intervals 0%${task.start + 1} -show_frames -show_entries frame=best_effort_timestamp_time -of csv=p=0 ${q(this.inputPath)}`);
    if (!this.api.ReturnCode.isSuccess(session.getReturnCode())) throw new Error('关键帧定位失败');
    const text = await session.getOutput();
    const candidates = String(text).split(/\r?\n/).filter(line=>/^\d/.test(line)).map(line=>Number(line.split(',')[0])).filter(n=>Number.isFinite(n)&&n>=0&&n<=task.start);
    if (!candidates.length) throw new Error('未找到可用关键帧');
    const actualStart=Math.max(...candidates);
    return retimeTask({...task,requestedStart:task.start}, actualStart);
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

  async listKeyframes(options = {}) {
    this.assertReady();
    const duration = Number(options.duration || this.mediaInfo?.duration || 0);
    const maxKeyframes = Math.max(256, Math.min(50000, Math.floor(Number(options.maxKeyframes) || 12000)));
    const videoStream = Math.max(0, Math.floor(Number(options.videoStream) || 0));
    const session = await this.api.FFprobeKit.execute(
      `-v error -select_streams v:${videoStream} -skip_frame nokey -show_frames -show_entries frame=best_effort_timestamp_time -of csv=p=0 ${q(this.inputPath)}`
    );
    if (!this.api.ReturnCode.isSuccess(session.getReturnCode())) {
      throw new Error((await session.getOutput?.()) || '关键帧分析失败');
    }
    const raw = String(await session.getOutput?.() || '');
    const parsed = raw
      .split(/\r?\n/)
      .map(line => Number(line.split(',')[0]))
      .filter(Number.isFinite)
      .filter(value => value >= 0 && (!(duration > 0) || value <= duration + .001))
      .sort((a,b) => a - b);
    const deduped = parsed.filter((value,index) => index === 0 || Math.abs(value - parsed[index - 1]) > .000001);
    return {
      keyframes: deduped.slice(0, maxKeyframes),
      keyframesTruncated: deduped.length > maxKeyframes,
      duration
    };
  }

  async renderTimelineFrame(timeSeconds, options = {}) {
    this.assertReady();
    const time = Math.max(0, Number(timeSeconds) || 0);
    const width = Math.max(320, Math.min(1280, Math.floor(Number(options.width) || 720)));
    const videoStream = Math.max(0, Math.floor(Number(options.videoStream) || 0));
    const run = async () => {
      const output = '/timeline_frame.png';
      const decoder = this.inputDecoderArgs();
      const filter = `scale=${width}:-2:force_original_aspect_ratio=decrease`;
      const cmd = `-y -ss ${time.toFixed(3)} ${decoder}-i ${q(this.inputPath)} -map 0:v:${videoStream} -an -sn -frames:v 1 -vf ${q(filter)} ${q(output)}`;
      await this.execute(cmd, false, 60000);
      const bytes = await this.api.readFile(output);
      if (!bytes || !bytes.length) throw new Error('时间轴画面预览没有生成');
      return {
        url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
        time,
        width
      };
    };
    this.timelineFrameQueue = (this.timelineFrameQueue || Promise.resolve())
      .catch(()=>{})
      .then(run);
    return this.timelineFrameQueue;
  }

  async renderHardsubReferenceFrame(timeSeconds, task, options = {}) {
    this.assertReady();
    if (task?.operation !== 'hardsub') throw new Error('当前任务不是硬字幕压制');
    if (!this.sourceAssFile && !this.activeAssText) throw new Error('硬字幕参考帧缺少 ASS');
    const time = Math.max(0, Number(timeSeconds) || 0);
    const width = Math.max(320, Math.min(1600, Math.floor(Number(options.width) || 1200)));
    const videoStream = Math.max(0, Math.floor(Number(options.videoStream ?? task.videoStreams?.[0] ?? task.videoStream ?? 0)));
    const output = '/hardsub_reference_frame.png';
    const decoder = this.inputDecoderArgs();
    const filter = hardsubReferenceFilter(
      task,
      time,
      escapeFilter(this.assPath),
      escapeFilter(this.fontDir),
      width
    );
    const cmd = `-y -ss ${time.toFixed(3)} ${decoder}-i ${q(this.inputPath)} -map 0:v:${videoStream} -an -sn -frames:v 1 -vf ${q(filter)} ${q(output)}`;
    await this.execute(cmd, false, 60000);
    const bytes = await this.api.readFile(output);
    if (!bytes || !bytes.length) throw new Error('硬字幕权威参考帧没有生成');
    return {
      url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
      time,
      width,
      referenceKind: 'hardsub-authoritative'
    };
  }

  async renderVerifiedOutputFrame(blob, timeSeconds, options = {}) {
    this.assertReady();
    if (!blob || !(blob.size > 0)) throw new Error('没有可供画质验证的成品');
    const time = Math.max(0, Number(timeSeconds) || 0);
    const width = Math.max(320, Math.min(1600, Math.floor(Number(options.width) || 960)));
    let verified = this.lastVerifiedOutput;
    if (!verified || verified.blob !== blob || !verified.path) {
      const extension = options.extension || (blob.type === 'video/mp4' ? 'mp4' : 'mkv');
      const stamp = Date.now();
      const mountPoint = `/verify_compare_${stamp}`;
      const fileName = 'encoded_output.' + extension;
      const path = `${mountPoint}/${fileName}`;
      await this.api.mount(mountPoint, { blobs: [{ name: fileName, data: blob }] });
      verified = { blob, path, extension };
      this.lastVerifiedOutput = verified;
    }
    const output = '/verified_output_frame.png';
    const filter = `scale=${width}:-2:force_original_aspect_ratio=decrease`;
    const cmd = `-y -ss ${time.toFixed(3)} -i ${q(verified.path)} -map 0:v:0 -an -sn -frames:v 1 -vf ${q(filter)} ${q(output)}`;
    await this.execute(cmd, false, 60000);
    const bytes = await this.api.readFile(output);
    if (!bytes || !bytes.length) throw new Error('成品画面验证帧没有生成');
    return {
      url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
      time,
      width
    };
  }

  async renderWaveform(options = {}) {
    this.assertReady();
    const audioTrack = Math.max(0, Math.floor(Number(options.audioTrack) || 0));
    const width = Math.max(512, Math.min(4096, Math.floor(Number(options.width) || 2048)));
    const height = Math.max(96, Math.min(320, Math.floor(Number(options.height) || 160)));
    const duration = Number(options.duration || this.mediaInfo?.duration || 0);
    const includeKeyframes = !!options.includeKeyframes;
    const keyframeResult = includeKeyframes
      ? await this.listKeyframes({ duration, maxKeyframes: options.maxKeyframes, videoStream: options.videoStream })
      : { keyframes: [], keyframesTruncated: false, duration };

    if (Number(this.mediaInfo?.audioTracks || 0) < 1) {
      if (!includeKeyframes) throw new Error('当前视频没有可用于波形显示的音轨');
      return {
        url: null,
        waveformError: '当前视频没有音频轨',
        duration,
        width,
        height,
        audioTrack,
        ...keyframeResult
      };
    }

    const output = `/waveform_${Date.now()}_${audioTrack}.png`;
    const filter = `aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:split_channels=0`;
    const cmd = `-y -i ${q(this.inputPath)} -map 0:a:${audioTrack} -vn -sn -filter_complex ${q(filter)} -frames:v 1 ${q(output)}`;
    try {
      await this.execute(cmd, false, 90000);
      const bytes = await this.api.readFile(output);
      if (!bytes || !bytes.length) throw new Error('音频波形没有生成');
      return {
        url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
        duration,
        width,
        height,
        audioTrack,
        ...keyframeResult
      };
    } catch (error) {
      if (!includeKeyframes) throw error;
      return {
        url: null,
        waveformError: error.message || '音频波形生成失败',
        duration,
        width,
        height,
        audioTrack,
        ...keyframeResult
      };
    }
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
    const targetVideoBitrate = Number(options.task?.bitrate || options.targetVideoBitrate || 0);
    const encoder = encoderName(codecKey);
    const out = `/sample_${codecKey}.mkv`;
    const filter = this.buildEncodeFilter(!!options.withSubtitles);
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
    const filter = this.buildEncodeFilter(!options.task || options.task.operation === 'hardsub');
    const extra = codecExtra(codecKey);
    const decoder = this.inputDecoderArgs();
    const gop = normalGop(this.mediaInfo?.fps || 30);
    const targetVideoBitrate = Number(options.task?.bitrate || options.targetVideoBitrate || 0);
    const twoPass = options.task ? !!options.task.twoPass : !!options.twoPass && targetVideoBitrate > 0;
    const passlog = `/twopass_${codecKey}_${Date.now()}`;

    if (twoPass) {
      options.onPhase?.('pass1');
      const firstPass = options.task ? ['-y',...taskSourceArgs(options.task,this.inputPath),...firstPassArgs(options.task.outputArgs).map(value=>value.replace('__ASS__',escapeFilter(this.assPath)).replace('__FONTS__',escapeFilter(this.fontDir))),'-pass','1','-passlogfile',passlog,'-f','null','-'].map(q).join(' ') : `-y ${decoder}-i ${q(this.inputPath)} -map 0:v:0 -sn -vf ${q(filter)} -c:v ${encoder} -preset ${preset} -g ${gop} -b:v ${Math.round(targetVideoBitrate)} -pass 1 -passlogfile ${q(passlog)}${extra} -an -f null -`;
      this.onLog(`整片两遍编码：第一遍统计，目标视频码率 ${Math.round(targetVideoBitrate / 1000)} kb/s`);
      await this.executeWithStatistics(firstPass, options.onStatistics, 'pass1');
    }

    options.onPhase?.(twoPass ? 'pass2' : 'encode');
    const task = options.task;
    const streamExtension = task?.outputExtension || options.outputExtension || 'mkv';
    const outputFormat = task?.outputFormat || options.outputFormat || 'matroska';
    const outputMime = task?.outputMime || options.outputMime || 'video/x-matroska';
    const stream = await FFmpegKitStreamOutput.create(streamExtension, 8 * 1024 * 1024);
    const target = stream.getUrl();
    const rateControl = targetVideoBitrate > 0
      ? twoPass
        ? `-b:v ${Math.round(targetVideoBitrate)} -pass 2 -passlogfile ${q(passlog)}`
        : `-b:v ${Math.round(targetVideoBitrate)}`
      : `-crf ${crf}`;
    const taskArgs = task ? task.outputArgs.map(value => value.replace('__ASS__',escapeFilter(this.assPath)).replace('__FONTS__',escapeFilter(this.fontDir))) : [];
    if(task && twoPass)taskArgs.push('-pass','2','-passlogfile',passlog);
    const streamContainerArgs = outputFormat === 'mp4'
      ? ['-movflags','frag_keyframe+empty_moov+default_base_moof']
      : [];
    const guidedAudio = options.audio || 'copy';
    if (!['copy','aac','libopus','none'].includes(guidedAudio)) throw new Error('未知音频策略');
    const guidedAudioArgs = [];
    if (guidedAudio === 'none') {
      guidedAudioArgs.push('-an');
    } else {
      guidedAudioArgs.push('-map','0:a?','-c:a',guidedAudio);
      if (guidedAudio === 'aac' || guidedAudio === 'libopus') {
        const audioBitrate = Number(options.audioBitrate || 128000);
        if (!Number.isInteger(audioBitrate) || audioBitrate < 8000 || audioBitrate > 1024000) throw new Error('音频码率超出有效范围');
        guidedAudioArgs.push('-b:a',String(audioBitrate));
        if (options.audioChannels !== '' && options.audioChannels != null) {
          const channels = Number(options.audioChannels);
          if (!Number.isInteger(channels) || channels < 1 || channels > 8) throw new Error('音频声道数超出有效范围');
          guidedAudioArgs.push('-ac',String(channels));
        }
        if (options.audioSampleRate !== '' && options.audioSampleRate != null) {
          const sampleRate = Number(options.audioSampleRate);
          if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('音频采样率超出有效范围');
          if (guidedAudio === 'libopus' && ![8000,12000,16000,24000,48000].includes(sampleRate)) throw new Error('Opus 采样率请选择 48000 Hz 或编码器默认');
          guidedAudioArgs.push('-ar',String(sampleRate));
        }
      }
    }
    const cmd = task
      ? ['-y',...taskSourceArgs(task,this.inputPath).map(q),...taskArgs.map(q),...streamContainerArgs.map(q),'-f',q(outputFormat),q(target)].join(' ')
      : ['-y',decoder.trim(),'-i',q(this.inputPath),'-map','0:v:0','-sn','-vf',q(filter),'-c:v',encoder,'-preset',preset,'-g',String(gop),...rateControl.trim().split(/\s+/),...(extra.trim()?extra.trim().split(/\s+/):[]),...guidedAudioArgs,...streamContainerArgs,'-f',outputFormat,q(target)].filter(Boolean).join(' ');
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
        blob: new Blob(chunks, { type: outputMime }),
        byteLength: totalBytes
      };
    } finally {
      try { await stream.close(); } catch {}
    }
  }

  async scanEncodedPackets(blob, expectedDuration = 0, validation = {}) {
    this.assertReady();
    const { mount, FFprobeKit, FFmpegKit, ReturnCode } = this.api;
    if (!blob || !(blob.size > 0)) throw new Error('成品为空，无法执行完整性扫描');

    const stamp = Date.now();
    const mountPoint = `/verify_${stamp}`;
    const extension = validation.task?.outputExtension || (blob.type === 'video/mp4' ? 'mp4' : 'mkv');
    const fileName = 'encoded_output.' + extension;
    const path = `${mountPoint}/${fileName}`;

    // Mount the final Blob read-only through WORKERFS. Do not print every
    // packet with ffprobe: on long 60 fps videos that textual output itself can
    // become very large and duplicate memory after an already memory-heavy
    // browser encode.
    await mount(mountPoint, {
      blobs: [{ name: fileName, data: blob }]
    });

    const layoutSession = await FFprobeKit.execute(
      `-v error -show_streams -show_entries stream=index,codec_type,width,height,avg_frame_rate,pix_fmt -of compact=p=0:nk=0 ${q(path)}`
    );
    const layoutRc = layoutSession.getReturnCode?.();
    const layoutOutput = await layoutSession.getOutput?.() || '';
    if (ReturnCode && !ReturnCode.isSuccess(layoutRc)) {
      throw new Error(layoutOutput || 'FFprobe 无法读取成品流布局');
    }

    const streamTypes = new Map();
    for (const rawLine of String(layoutOutput).split(/\r?\n/)) {
      const fields = {};
      for (const part of rawLine.trim().split('|')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        fields[part.slice(0, eq)] = part.slice(eq + 1);
      }
      const index = Number(fields.index);
      if (Number.isInteger(index) && fields.codec_type) {
        streamTypes.set(index, fields.codec_type);
        if(fields.codec_type==='video' && validation.task){
          const t=validation.task,rate=String(fields.avg_frame_rate||'').split('/').map(Number),fps=rate.length===2?rate[0]/rate[1]:rate[0];
          if(t.expectedWidth && (Number(fields.width)!==t.expectedWidth || Number(fields.height)!==t.expectedHeight))throw Error('成品分辨率与设置不符');
          if(t.expectedFps && Math.abs(fps-t.expectedFps)>0.01)throw Error('成品帧率与设置不符');
          if(t.operation!=='copy' && inferBitDepth({},fields.pix_fmt)!==t.expectedBitDepth)throw Error('成品位深与设置不符');
        }
      }
    }

    const videoIndexes = [...streamTypes.entries()]
      .filter(([, type]) => type === 'video')
      .map(([index]) => index);
    const audioIndexes = [...streamTypes.entries()]
      .filter(([, type]) => type === 'audio')
      .map(([index]) => index);

    const expectedVideoTracks = Number(validation.task?.expectedVideoTracks ?? 1);
    if (videoIndexes.length !== expectedVideoTracks) {
      throw new Error(`成品视频流数量异常：${videoIndexes.length}（预期 ${expectedVideoTracks}）`);
    }

    const scanMapToNull = async mapSpec => {
      let lastTimeMs = 0;
      let maxFrame = 0;
      let maxSize = 0;
      const command =
        `-hide_banner -v error -stats -i ${q(path)} -map ${mapSpec} -c copy -f null -`;

      let resolveDone;
      const done = new Promise(resolve => { resolveDone = resolve; });
      await FFmpegKit.executeAsync(
        command,
        completed => resolveDone(completed),
        undefined,
        statistics => {
          try {
            lastTimeMs = Math.max(lastTimeMs, Number(statistics?.getTime?.() || 0));
            maxFrame = Math.max(maxFrame, Number(statistics?.getVideoFrameNumber?.() || 0));
            maxSize = Math.max(maxSize, Number(statistics?.getSize?.() || 0));
          } catch {}
        }
      );

      const completed = await done;
      const rc = completed?.getReturnCode?.();
      if (!ReturnCode.isSuccess(rc)) {
        const logs = await completed?.getAllLogsAsString?.(1000) ||
          await completed?.getOutput?.() || '';
        throw new Error(logs || `成品 ${mapSpec} 全量解复用扫描失败`);
      }

      return {
        end: lastTimeMs / 1000,
        frameCount: maxFrame,
        processedBytes: maxSize
      };
    };

    const t0 = performance.now();
    const videoScan = await scanMapToNull('0:v');
    const audioScan = audioIndexes.length
      ? await scanMapToNull('0:a')
      : null;

    if (!(videoScan.end > 0)) {
      throw new Error('全量视频 packet 扫描没有取得有效末端时间');
    }

    const expectedVideoDuration = Number(validation.task?.expectedVideoDuration ?? expectedDuration ?? 0);
    const durationDelta = expectedVideoDuration > 0 ? videoScan.end - expectedVideoDuration : null;
    const fps = Number(this.mediaInfo?.fps || 0);
    const tolerance = validation.tolerance ?? Math.max(0.5, fps > 0 ? 2 / fps : 0);
    const durationOk = durationDelta == null || Math.abs(durationDelta) <= tolerance;

    const expectedAudioTracks = validation.expectedAudioTracks ?? Number(this.mediaInfo?.audioTracks || 0);
    const expectedAudioDuration = Number(validation.task?.expectedAudioDuration ?? expectedDuration ?? 0);
    const audioTrackCountOk = audioIndexes.length === expectedAudioTracks;
    const audioTolerance = validation.tolerance ?? 1.0;
    const audioEnd = audioScan?.end ?? null;
    const audioDurationsOk =
      expectedAudioTracks === 0 ||
      (
        audioIndexes.length > 0 &&
        audioEnd != null &&
        audioEnd > 0 &&
        (
          expectedAudioDuration <= 0 ||
          (validation.allowShortAudio
            ? audioEnd <= expectedAudioDuration + audioTolerance
            : Math.abs(audioEnd - expectedAudioDuration) <= audioTolerance)
        )
      );
    const audioOk = audioTrackCountOk && audioDurationsOk;

    this.lastVerifiedOutput = { blob, path, extension };

    return {
      // Kept for UI/backward compatibility. The full scan now intentionally
      // avoids ffprobe -show_packets to prevent huge textual packet dumps.
      packetCount: null,
      keyCount: null,
      corruptCount: null,
      totalVideoBytes: null,
      firstTimestamp: null,
      lastPacketStart: null,
      videoEnd: videoScan.end,
      videoFrameCount: videoScan.frameCount,
      expectedDuration: expectedVideoDuration > 0 ? expectedVideoDuration : null,
      expectedAudioDuration: expectedAudioDuration > 0 ? expectedAudioDuration : null,
      durationDelta,
      tolerance,
      durationOk,
      videoStreamCount: videoIndexes.length,
      expectedVideoTracks,
      audioTrackCount: audioIndexes.length,
      expectedAudioTracks,
      audioTrackCountOk,
      audioEnds: audioEnd == null ? [] : [audioEnd],
      audioTolerance,
      audioDurationsOk,
      audioOk,
      scanMode: 'memory-bounded-demux',
      ok:
        videoIndexes.length === expectedVideoTracks &&
        videoScan.end > 0 &&
        durationOk &&
        audioOk,
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
    this.lastVerifiedOutput = null;

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

  buildEncodeFilter(withSubtitles = true) {
    const filters = [];
    if (withSubtitles) {
      filters.push(`ass=${escapeFilter(this.assPath)}:fontsdir=${escapeFilter(this.fontDir)}`);
    }

    // 4:2:0 encoders commonly reject odd frame dimensions. Preserve the
    // original subtitle coordinate system, then add at most one pixel on the
    // right/bottom after libass rendering.
    const width = Number(this.mediaInfo?.width || 0);
    const height = Number(this.mediaInfo?.height || 0);
    if ((width > 0 && width % 2) || (height > 0 && height % 2)) {
      filters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
    }

    return filters.length ? filters.join(',') : null;
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
  const streams = rawStreams.map?.(stream =>
    typeof stream.getAllProperties === 'function' ? stream.getAllProperties() : stream
  ) || [];
  const format = raw.format || raw.format_properties || raw;

  const videoStreams = streams
    .filter(stream => (stream.codec_type || stream.type) === 'video')
    .map((stream, ordinal) => {
      const pixelFormat = stream.pix_fmt || stream.pixel_format || '';
      const bitDepth = inferBitDepth(stream, pixelFormat);
      const colorTransfer = stream.color_transfer || '';
      const colorPrimaries = stream.color_primaries || '';
      const colorSpace = stream.color_space || '';
      const hdr = /smpte2084|arib-std-b67/i.test(colorTransfer)
        || (/bt2020/i.test(colorPrimaries) && bitDepth > 8);
      return {
        ordinal,
        index: Number.isInteger(Number(stream.index)) ? Number(stream.index) : ordinal,
        codec: stream.codec_name || stream.codec || 'unknown',
        bitRate: Number(stream.bit_rate || stream.bitrate || 0),
        width: Number(stream.width || 0),
        height: Number(stream.height || 0),
        fps: parseFps(stream.avg_frame_rate || stream.r_frame_rate),
        pixelFormat,
        bitDepth,
        colorTransfer,
        colorPrimaries,
        colorSpace,
        hdr,
        highBitDepth: bitDepth > 8,
        unsafeColorPipeline: hdr || bitDepth > 8,
        disposition: stream.disposition || {},
        tags: stream.tags || {}
      };
    });

  const audioStreams = streams
    .filter(stream => (stream.codec_type || stream.type) === 'audio')
    .map((stream, ordinal) => ({
      ordinal,
      index: Number.isInteger(Number(stream.index)) ? Number(stream.index) : ordinal,
      codec: stream.codec_name || stream.codec || '',
      bitRate: Number(stream.bit_rate || stream.bitrate || 0),
      channels: Number(stream.channels || 0),
      sampleRate: Number(stream.sample_rate || 0),
      disposition: stream.disposition || {},
      tags: stream.tags || {}
    }));

  const video = videoStreams[0] || {};
  const audio = audioStreams[0] || {};

  return {
    duration: Number(format.duration || raw.duration || 0),
    durationSource: Number(format.duration || raw.duration || 0) > 0 ? 'container' : 'unknown',
    formatName: String(format.format_name || raw.format_name || ''),
    size: Number(format.size || raw.size || 0),
    bitRate: Number(format.bit_rate || raw.bitrate || 0),
    videoStreams,
    videoTracks: videoStreams.length,
    videoCodec: video.codec || 'unknown',
    videoBitRate: Number(video.bitRate || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: Number(video.fps || 0),
    pixelFormat: video.pixelFormat || '',
    bitDepth: Number(video.bitDepth || 8),
    colorTransfer: video.colorTransfer || '',
    colorPrimaries: video.colorPrimaries || '',
    colorSpace: video.colorSpace || '',
    hdr: !!video.hdr,
    highBitDepth: !!video.highBitDepth,
    unsafeColorPipeline: !!video.unsafeColorPipeline,
    audioStreams,
    audioCodec: audio.codec || '',
    audioCodecs: audioStreams.map(stream => stream.codec).filter(Boolean),
    audioTracks: audioStreams.length,
    audioBitRate: audioStreams.reduce((sum, stream) => sum + Number(stream.bitRate || 0), 0)
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
