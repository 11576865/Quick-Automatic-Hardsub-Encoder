import { sizeBudget } from './media-planning.js';
import { audioCopyPlaybackWarning, resolveOutputContainer } from './media-container.js';
import { parseMediaTime } from './media-time.js';

// Shared, versioned task compiler. Paths are supplied only by the owning backend.
export const TASK_VERSION = 4;
export const SOFTWARE = { h264: 'libx264', h265: 'libx265', av1: 'libsvtav1' };

function streamCount(media, key, fallback = 0) {
  const explicit = Number(media?.[key]);
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;
  const listKey = key === 'videoTracks' ? 'videoStreams' : key === 'audioTracks' ? 'audioStreams' : '';
  if (listKey && Array.isArray(media?.[listKey])) return media[listKey].length;
  return fallback;
}

function parseVideoStreams(raw, media) {
  const count = streamCount(media, 'videoTracks', 1);
  if (count < 1) throw Error('输入容器没有视频流');
  const text = String(raw == null || raw === '' ? '0' : raw).trim().toLowerCase();
  const values = text === 'all'
    ? Array.from({ length: count }, (_, i) => i)
    : text.split(',').map(x => x.trim()).filter(Boolean).map(x => {
        if (!/^\d+$/.test(x)) throw Error('视频流选择格式无效；请使用 0,1 或 all');
        return Number(x);
      });
  const unique = [...new Set(values)].sort((a,b)=>a-b);
  if (!unique.length) throw Error('至少选择一条视频流');
  if (unique.some(index => index < 0 || index >= count)) throw Error('视频流索引不存在');
  return unique;
}

function rangePolicy(value, label) {
  const policy = String(value || 'trim').toLowerCase();
  if (!['trim','full'].includes(policy)) throw Error(label + '时间策略无效');
  return policy;
}

function appendAudioEncodingArgs(args, t, number) {
  if (t.audio === 'none') return;
  args.push('-c:a', t.audio);
  if (['aac','libopus'].includes(t.audio)) {
    args.push('-b:a', String(number('audioBitrate', 128000, 8000, 1024000, true)));
    if (t.audioChannels) args.push('-ac', String(number('audioChannels', 2, 1, 8, true)));
    if (t.audioSampleRate) {
      const rate = number('audioSampleRate', 48000, 8000, 192000, true);
      if (t.audio === 'libopus' && ![8000,12000,16000,24000,48000].includes(rate)) {
        throw Error('Opus 采样率请选择 48000 Hz 或编码器默认');
      }
      args.push('-ar', String(rate));
    }
  }
}

function applyExpectedDurations(t, media, outputFps = null) {
  const sourceDuration = Number(media.duration || t.sourceDuration || 0);
  const trimDuration = Math.max(0, Number(t.end) - Number(t.start));
  t.sourceDuration = sourceDuration;
  t.trimDuration = trimDuration;
  t.expectedVideoDuration = t.videoRange === 'full' ? sourceDuration : trimDuration;
  if (t.frames && outputFps) {
    t.expectedVideoDuration = Math.min(
      t.expectedVideoDuration,
      Number(t.frames) / outputFps
    );
  }
  t.expectedAudioDuration = t.expectedAudioTracks > 0
    ? (t.audioRange === 'full' ? sourceDuration : trimDuration)
    : 0;
  t.expectedSubtitleDuration = t.keepSubtitles
    ? (t.subtitleRange === 'full' ? sourceDuration : trimDuration)
    : 0;
  t.expectedDuration = Math.max(
    t.expectedVideoDuration,
    t.expectedAudioDuration,
    t.expectedSubtitleDuration,
    0
  );
}

export function compileTask(raw, media) {
  const t = { ...raw, version: TASK_VERSION };
  if (!['hardsub', 'transcode', 'copy'].includes(t.operation)) throw Error('未知任务模式');

  const number = (key, fallback, min, max, integer = false) => {
    const value = t[key] === '' || t[key] == null ? fallback : Number(t[key]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw Error(key + ' 超出有效范围');
    }
    return value;
  };

  t.start = parseMediaTime(t.start, { empty: 0, max: media.duration, label: '开始时间' });
  t.end = parseMediaTime(t.end, { empty: media.duration, max: media.duration, label: '结束时间' });
  if (t.end <= t.start) throw Error('结束时间必须晚于开始时间');

  t.videoStreams = parseVideoStreams(t.videoStreams ?? t.videoStream, media);
  t.videoStream = t.videoStreams[0];
  t.expectedVideoTracks = t.videoStreams.length;
  t.videoRange = rangePolicy(t.videoRange, '视频');
  t.audioRange = rangePolicy(t.audioRange, '音频');
  t.subtitleRange = rangePolicy(t.subtitleRange, '软字幕');
  t.hasTrimRange = t.start > 0 || t.end < Number(media.duration || 0) - 1e-6;

  t.audio = t.audio || 'copy';
  if (!['copy', 'aac', 'libopus', 'none'].includes(t.audio)) throw Error('未知音频策略');
  t.audioTrack = t.audioTrack || 'all';
  const audioTracks = streamCount(media, 'audioTracks', 0);
  if (t.audioTrack !== 'all' && !/^\d+$/.test(t.audioTrack)) throw Error('音轨索引无效');
  if (t.audioTrack !== 'all' && Number(t.audioTrack) >= audioTracks) throw Error('音轨索引不存在');
  t.expectedAudioTracks = t.audio === 'none' ? 0 : t.audioTrack === 'all' ? audioTracks : 1;

  t.compatibilityWarnings = Array.isArray(t.compatibilityWarnings) ? t.compatibilityWarnings : [];
  const audioCopyWarning = audioCopyPlaybackWarning(t, media);
  if (audioCopyWarning) t.compatibilityWarnings.push(audioCopyWarning.message);

  const trimNeeded = !!(t.hasTrimRange && (
    t.videoRange === 'trim' ||
    (t.expectedAudioTracks > 0 && t.audioRange === 'trim') ||
    (t.keepSubtitles && t.subtitleRange === 'trim')
  ));
  t.usesTrimInput = trimNeeded;
  const trimInput = trimNeeded ? 1 : 0;
  const inputFor = policy => t.hasTrimRange && policy === 'trim' ? trimInput : 0;

  if (t.operation === 'copy') {
    // Video Stream Copy has no video encoder/two-pass/rate-control stage.
    t.encoder = 'copy';
    t.rateMode = 'copy';
    t.twoPass = false;
  }

  if (t.operation !== 'copy' && t.expectedVideoTracks > 1 && t.twoPass) throw Error('多视频流任务暂不支持整片两遍编码；请关闭两遍编码或只选择一条视频流');
  if (t.operation !== 'copy' && t.expectedVideoTracks > 1 && t.frames) throw Error('多视频流任务暂不支持统一总帧数上限；请只选择一条视频流');
  if (t.operation !== 'copy' && t.expectedVideoTracks > 1 && t.rateMode === 'size') throw Error('目标体积模式当前要求只选择一条视频流；多视频流请使用质量或码率模式');

  if (t.operation !== 'copy' && t.frames && (t.fpsMode !== 'cfr' || !t.fps)) {
    throw Error('限制总帧数时必须指定恒定帧率 CFR 和目标帧率');
  }

  applyExpectedDurations(t, media);
  const durationForBudget = t.expectedVideoDuration;

  if (t.rateMode === 'size') {
    if (t.expectedAudioTracks > 0 && Math.abs(t.expectedAudioDuration - t.expectedVideoDuration) > 1e-6) {
      throw Error('目标体积模式暂不支持视频与音频使用不同时间范围；请改用质量/码率模式或统一时间策略');
    }
    t.sizePlan = sizeBudget(t, durationForBudget, t.expectedAudioTracks);
    t.bitrate = t.sizePlan.videoRate;
  }

  t.estimatedAudioRate = t.audio === 'none' || t.expectedAudioTracks === 0
    ? 0
    : t.audio === 'copy'
      ? null
      : Number(t.audioBitrate || 128000) * t.expectedAudioTracks;

  const args = ['-ss','0'];
  const videoInput = inputFor(t.videoRange);
  for (const ordinal of t.videoStreams) args.push('-map', `${videoInput}:v:${ordinal}`);
  if (t.audio !== 'none') {
    const audioInput = inputFor(t.audioRange);
    args.push('-map', t.audioTrack === 'all' ? `${audioInput}:a?` : `${audioInput}:a:${t.audioTrack}`);
  }
  if (t.keepSubtitles) {
    const subtitleInput = inputFor(t.subtitleRange);
    args.push('-map', `${subtitleInput}:s?`, '-c:s', 'copy');
  } else {
    args.push('-sn');
  }
  if (t.keepAttachments) args.push('-map', '0:t?', '-c:t', 'copy');
  args.push('-map_metadata', t.keepMetadata ? '0' : '-1', '-map_chapters', t.keepChapters ? '0' : '-1');

  const finalizeContainer = () => {
    const resolved = resolveOutputContainer(t.outputContainer || 'auto', t, media);
    t.outputContainerRequest = resolved.requested;
    t.outputContainer = resolved.key;
    t.outputFormat = resolved.format;
    t.outputExtension = resolved.extension;
    t.outputMime = resolved.mime;
    t.sourceContainer = resolved.source;
    t.containerReason = resolved.reason;
  };

  if (t.operation === 'copy') {
    args.push('-c:v', 'copy');
    appendAudioEncodingArgs(args, t, number);
    t.outputArgs = args;
    // Stream Copy output size depends on source packets; keep this unknown so
    // backends reserve from observed source size instead of underestimating.
    t.estimatedBytes = null;
    finalizeContainer();
    return t;
  }

  const selectedVideoFacts = Array.isArray(media.videoStreams)
    ? t.videoStreams.map(index => media.videoStreams[index]).filter(Boolean)
    : [];
  const unsafeSelected = selectedVideoFacts.some(v => v.unsafeColorPipeline || v.hdr || Number(v.bitDepth || 8) > 8);
  if (unsafeSelected || (!selectedVideoFacts.length && media.unsafeColorPipeline)) {
    throw Error('所选视频流包含 HDR/高位深输入；当前色彩保持链路尚未验证，可使用视频流复制');
  }

  if (!SOFTWARE[t.codec]) throw Error('未知编码格式');
  t.encoder = t.encoder || SOFTWARE[t.codec];
  if (![SOFTWARE[t.codec], {h264:'h264_nvenc',h265:'hevc_nvenc',av1:'av1_nvenc'}[t.codec]].includes(t.encoder)) {
    throw Error('编码器与格式不匹配');
  }

  const nvenc = t.encoder.endsWith('_nvenc');
  const presets = ['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'];
  if (!(nvenc ? /^p[1-7]$/.test(t.preset) : t.codec === 'av1' ? /^(?:[0-9]|1[0-3])$/.test(t.preset) : presets.includes(t.preset))) {
    throw Error('preset 与编码器不兼容');
  }

  const quality = t.rateMode === 'quality'
    ? number('quality', t.codec === 'av1' ? 32 : 23, 0, (nvenc || t.codec !== 'av1') ? 51 : 63)
    : 23;
  t.quality = quality;
  args.push('-c:v', t.encoder, '-preset', t.preset);

  if (!['quality','bitrate','size'].includes(t.rateMode)) throw Error('未知码率控制');
  if (nvenc) args.push('-rc', 'vbr');
  if (t.rateMode !== 'quality') {
    t.bitrate = number('bitrate', 4000000, 1, 2000000000, true);
    args.push('-b:v', String(t.bitrate));
  } else {
    args.push(nvenc ? '-cq' : '-crf', String(quality));
    if (nvenc) args.push('-b:v','0');
  }

  for (const [key, flag, limit] of [
    ['maxrate','-maxrate',2000000000],
    ['bufsize','-bufsize',4000000000],
    ['gop','-g',100000],
    ['bf','-bf',16],
    ['refs','-refs',16],
    ['threads','-threads',256]
  ]) {
    if (t[key] !== '' && t[key] != null) args.push(flag, String(number(key, 0, 0, limit, true)));
  }

  if (!['auto','passthrough','cfr','vfr'].includes(t.fpsMode)) throw Error('帧率策略无效');
  let outputFps = media.fps || 30;
  if (t.fps !== '' && t.fps != null) {
    if (t.fpsMode !== 'cfr') throw Error('指定目标帧率时请选择恒定帧率 CFR');
    const text = String(t.fps);
    if (!/^\d+(?:\.\d+)?(?:\/\d+)?$/.test(text)) throw Error('目标帧率支持数值或分数，例如 24000/1001');
    const [numerator, denominator='1'] = text.split('/');
    outputFps = Number(numerator) / Number(denominator);
    if (!Number.isFinite(outputFps) || outputFps < 0.001 || outputFps > 1000) throw Error('目标帧率无效');
    args.push('-r', text);
  }

  t.legacyFps = t.legacyFps || media.fpsModeSupported === false;
  if (t.fpsMode !== 'auto') {
    args.push(t.legacyFps ? '-vsync' : '-fps_mode', t.fpsMode === 'passthrough' && t.legacyFps ? '0' : t.fpsMode);
  }
  t.expectedFps = t.fps ? outputFps : null;

  if (!['yuv420p','yuv420p10le','yuv444p','yuv444p10le','p010le'].includes(t.pixelFormat)) throw Error('像素格式无效');
  if (nvenc && t.pixelFormat === 'yuv420p10le') t.pixelFormat = 'p010le';
  args.push('-pix_fmt', t.pixelFormat);
  t.expectedBitDepth = /10|p010/.test(t.pixelFormat) ? 10 : 8;

  if (t.spatialAq && t.temporalAq && nvenc) throw Error('NVENC 空间 AQ 与时间 AQ 请选择一种');
  for (const [key, flag] of [['profile','-profile:v'],['level','-level:v'],['tune','-tune']]) {
    if (t[key]) {
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(t[key])) throw Error(key + ' 格式无效');
      args.push(flag, t[key]);
    }
  }

  if (nvenc) {
    if (!['disabled','qres','fullres'].includes(t.multipass)) throw Error('NVENC multipass 无效');
    const multipassSupported = media.nvencMultipassSupported !== false;
    const fullresSupported = media.nvencMultipassFullresSupported !== false;
    if (!multipassSupported) {
      if (t.multipass !== 'disabled') t.compatibilityWarnings.push('当前 FFmpeg/NVENC 不支持 -multipass；已自动关闭多阶段分析。');
      t.multipass = 'disabled';
    } else if (t.multipass === 'fullres' && !fullresSupported) {
      t.compatibilityWarnings.push('当前 FFmpeg/NVENC 不支持 fullres multipass；已自动关闭多阶段分析。');
      t.multipass = 'disabled';
    }
    if (multipassSupported) args.push('-multipass', t.multipass);
    if (t.lookahead !== '') args.push('-rc-lookahead', String(number('lookahead', 0, 0, 32, true)));
    args.push('-spatial-aq', t.spatialAq ? '1':'0', '-temporal-aq', t.temporalAq ? '1':'0');
    if (t.aqStrength !== '') args.push('-aq-strength', String(number('aqStrength', 8, 1, 15, true)));
  }

  if (t.codecParams) {
    if (nvenc) throw Error('软件编码器专用参数不能用于 NVENC');
    const allowed = new Set(['rc-lookahead','aq-mode','aq-strength','qcomp','psy-rd','psy-rdoq','bframes','ref','keyint','min-keyint','scenecut','pools','frame-threads','lp','tune','film-grain','enable-overlays']);
    const entries = t.codecParams.split(':');
    const seen = new Set();
    for (const entry of entries) {
      const [key,value,...extra] = entry.split('=');
      if (!allowed.has(key) || extra.length || !/^\d+(?:\.\d+)?$/.test(value) || seen.has(key)) {
        throw Error('编码器专用参数格式或参数名无效');
      }
      seen.add(key);
    }
    args.push({h264:'-x264-params',h265:'-x265-params',av1:'-svtav1-params'}[t.codec], t.codecParams);
  }

  const filters = [];
  if (t.crop) {
    if (!/^\d+:\d+:\d+:\d+$/.test(t.crop)) throw Error('裁切格式为 宽:高:x:y');
    filters.push('crop=' + t.crop);
  }
  if (!['none','bwdif','yadif'].includes(t.deinterlace)) throw Error('去隔行选项无效');
  if (t.deinterlace !== 'none') filters.push(t.deinterlace + '=mode=send_frame:parity=auto:deint=interlaced');

  if (t.width || t.height) {
    const w = number('width', -2, -2, 16384, true);
    const h = number('height', -2, -2, 16384, true);
    if ((w <= 0 && w !== -2) || (h <= 0 && h !== -2) || (w === -2 && h === -2)) throw Error('至少指定一个正整数尺寸');
    if (!['bilinear','bicubic','lanczos','spline','neighbor'].includes(t.scaleAlgorithm)) throw Error('缩放算法无效');
    filters.push(`scale=${w}:${h}:flags=${t.scaleAlgorithm}`);
  }

  if (!['none','clock','cclock','flip'].includes(t.rotation)) throw Error('旋转选项无效');
  if (t.rotation === 'flip') filters.push('hflip','vflip');
  else if (t.rotation !== 'none') filters.push('transpose=' + t.rotation);
  if (t.squarePixels) filters.push('setsar=1');
  if (t.denoise) filters.push('hqdn3d');
  if (t.deband) filters.push('deband');
  if (t.sharpen) filters.push('unsharp');

  if (t.operation === 'hardsub') {
    const shifted = t.hasTrimRange && t.videoRange === 'trim' && t.start > 0;
    if (shifted) filters.push(`setpts=PTS+${t.start}/TB`);
    filters.push('ass=__ASS__:fontsdir=__FONTS__');
    if (shifted) filters.push(`setpts=PTS-${t.start}/TB`);
  }

  filters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
  args.push('-vf', filters.join(','));
  appendAudioEncodingArgs(args, t, number);

  if (t.twoPass && (t.encoder !== 'libx264' || t.rateMode === 'quality')) {
    throw Error('整片两遍编码目前支持 x264 的目标码率 / 目标体积模式');
  }

  if (Number(t.width) > 0 && Number(t.height) > 0) {
    const rotated = ['clock','cclock'].includes(t.rotation);
    const w = rotated ? Number(t.height) : Number(t.width);
    const h = rotated ? Number(t.width) : Number(t.height);
    t.expectedWidth = Math.ceil(w/2)*2;
    t.expectedHeight = Math.ceil(h/2)*2;
  }

  if (t.frames) {
    t.frames = number('frames', 0, 1, 100000000, true);
    args.push('-frames:v', String(t.frames));
    if (t.audio !== 'none') throw Error('限制输出帧数时请关闭音频，避免音视频长度歧义');
  }

  applyExpectedDurations(t, media, outputFps);

  if (t.rateMode !== 'quality' && t.estimatedAudioRate != null) {
    const videoBytes = Number(t.bitrate) * t.expectedVideoTracks * t.expectedVideoDuration / 8;
    const audioBytes = Number(t.estimatedAudioRate) * t.expectedAudioDuration / 8;
    t.estimatedBytes = videoBytes + audioBytes;
  } else {
    t.estimatedBytes = null;
  }

  t.outputArgs = args;
  finalizeContainer();
  return t;
}

export function retimeTask(task, actualStart) {
  const next = { ...task, start: Number(actualStart) };
  next.trimDuration = Math.max(0, Number(next.end) - next.start);
  if (next.videoRange === 'trim') next.expectedVideoDuration = next.trimDuration;
  if (next.expectedAudioTracks > 0 && next.audioRange === 'trim') next.expectedAudioDuration = next.trimDuration;
  if (next.keepSubtitles && next.subtitleRange === 'trim') next.expectedSubtitleDuration = next.trimDuration;
  next.expectedDuration = Math.max(
    Number(next.expectedVideoDuration || 0),
    Number(next.expectedAudioDuration || 0),
    Number(next.expectedSubtitleDuration || 0)
  );
  return next;
}

export function taskSourceArgs(t, inputPath) {
  const args = ['-i', inputPath];
  if (t.usesTrimInput) {
    args.push('-ss', String(t.start), '-t', String(Math.max(0, Number(t.end) - Number(t.start))), '-i', inputPath);
  }
  return args;
}

// Legacy helpers retained for older callers; schema v4 uses taskSourceArgs().
export function taskInputArgs(t) {
  if (Number(t.version || 0) >= 4) return [];
  return t.start > 0 ? ['-ss', String(t.start)] : [];
}
export function taskDurationArgs(t) {
  if (Number(t.version || 0) >= 4) return [];
  return ['-t', String(t.end - t.start)];
}

export function parseRate(text) {
  const [n,d='1'] = String(text).split('/');
  return Number(n) / Number(d);
}

export function firstPassArgs(args) {
  const out = [];
  for (let i=0;i<args.length;i++) {
    const flag = args[i];
    if (flag === '-sn') {
      out.push(flag);
      continue;
    }
    const value = args[++i];
    if (['-c:a','-b:a','-ac','-ar','-c:s','-c:t','-map_metadata','-map_chapters'].includes(flag)) continue;
    if (flag === '-map' && !/^\d+:v:/.test(value)) continue;
    out.push(flag, value);
  }
  return [...out.filter(x => x !== '-sn'), '-an', '-sn'];
}

const quoteArg = value => value === 'ffmpeg' ? 'ffmpeg' : '"' + String(value).replaceAll('"','\\"') + '"';

export function commandPreview(t) {
  const base = ['ffmpeg', ...taskSourceArgs(t, '<所选视频>')];
  const output = [...t.outputArgs];
  if (t.twoPass) {
    const first = [...base, ...firstPassArgs(output), '-pass','1','-passlogfile','<任务统计文件>','-f','null','NUL'];
    output.push('-pass','2','-passlogfile','<任务统计文件>');
    return first.map(quoteArg).join(' ') + '\n' +
      [...base, ...output, '-f', t.outputFormat, `<成品.${t.outputExtension}>`].map(quoteArg).join(' ');
  }
  return [...base, ...output, '-f', t.outputFormat, `<成品.${t.outputExtension}>`].map(quoteArg).join(' ') +
    (t.start && t.operation === 'copy' && t.videoRange === 'trim'
      ? '\n视频流复制剪辑：执行时按主选视频流向前定位关键帧'
      : '');
}
