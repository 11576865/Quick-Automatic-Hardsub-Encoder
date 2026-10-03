const SPECS = Object.freeze({
  mkv: Object.freeze({ key:'mkv', format:'matroska', extension:'mkv', mime:'video/x-matroska', label:'MKV' }),
  mp4: Object.freeze({ key:'mp4', format:'mp4', extension:'mp4', mime:'video/mp4', label:'MP4' }),
});

const MP4_VIDEO = new Set(['h264','hevc','h265','av1','mpeg4']);
const MP4_AUDIO = new Set(['aac','mp3','ac3','eac3','alac']);
const MKV_FORMAT_NAMES = new Set(['matroska','matroska,webm']);
const MP4_FORMAT_NAMES = new Set(['mov,mp4,m4a,3gp,3g2,mj2','mp4','mov']);

function cleanCodec(value='') {
  const v=String(value).trim().toLowerCase();
  if(v==='h265')return 'hevc';
  return v;
}

export function sourceContainer(media={}) {
  const format=String(media.formatName || media.format || '').trim().toLowerCase();
  const name=String(media.sourceName || '').trim().toLowerCase();
  if(MKV_FORMAT_NAMES.has(format) || format.includes('matroska') || /\.mkv$/.test(name))return 'mkv';
  if(MP4_FORMAT_NAMES.has(format) || /(^|,)mp4(,|$)/.test(format) || /\.(mp4|m4v)$/.test(name))return 'mp4';
  return '';
}

function copiedAudioCodecs(media={}) {
  if(Array.isArray(media.audioCodecs) && media.audioCodecs.length)return media.audioCodecs.map(cleanCodec).filter(Boolean);
  const one=cleanCodec(media.audioCodec);
  return one?[one]:[];
}

const BROAD_PLAYBACK_AUDIO = new Set(['aac','mp3']);
const AUDIO_CODEC_LABELS = Object.freeze({
  aac:'AAC',
  mp3:'MP3',
  ac3:'AC-3',
  eac3:'E-AC-3',
  dts:'DTS',
  truehd:'TrueHD',
  flac:'FLAC',
  opus:'Opus',
  vorbis:'Vorbis',
  alac:'ALAC',
  pcm_s16le:'PCM S16LE',
  pcm_s24le:'PCM S24LE',
  pcm_s32le:'PCM S32LE',
  pcm_f32le:'PCM F32LE',
});

function audioCodecLabel(codec='') {
  const key=cleanCodec(codec);
  return AUDIO_CODEC_LABELS[key] || key.toUpperCase();
}

export function audioCopyPlaybackWarning(task={}, media={}) {
  if(task.audio!=='copy' || Number(media.audioTracks||0)<=0)return null;
  const codecs=[...new Set(copiedAudioCodecs(media))];
  const tracks=Math.max(1,Number(media.audioTracks||0));
  const detected=codecs.length ? codecs.map(audioCodecLabel).join(' / ') : '未能确认';
  const broad=codecs.length>0 && codecs.every(codec=>BROAD_PLAYBACK_AUDIO.has(codec));
  const bitrate=Number(media.audioBitRate||0);
  const facts=`${detected} · ${tracks} 轨${bitrate>0 ? ' · '+Math.round(bitrate/1000)+' kb/s' : ''}`;

  if(broad){
    return {
      code:'audio-copy-playback-common',
      severity:'info',
      confidence:'common-playback',
      codecs,
      tracks,
      message:`检测到源音频：${facts}。复制原音频会保留现有码流，不重新编码。AAC / MP3 在常见播放环境中通常具有较广支持，但当前项目无法验证你实际使用的外部播放器；程序内部验证通过也不等于目标播放器一定有声。`
    };
  }

  return {
    code:codecs.length ? 'audio-copy-playback-unverified' : 'audio-copy-playback-codec-unknown',
    severity:'warning',
    confidence:codecs.length ? 'player-dependent' : 'unknown-codec',
    codecs,
    tracks,
    message:`检测到源音频：${facts}。复制原音频会原样保留这些码流，不会提升播放器兼容性。程序内部最多只能证明音轨存在或当前后端能够解码，不能证明你实际使用的外部播放器支持；如果成品无声，请改为“转为 AAC”。`
  };
}

export function checkContainerCompatibility(key, task={}, media={}) {
  if(!SPECS[key])return {ok:false,reason:'未知成品容器'};
  if(key==='mkv')return {ok:true};

  if(task.keepAttachments)return {ok:false,reason:'当前 MP4 输出不复制附件；请关闭附件保留或改用 MKV'};
  if(task.keepSubtitles)return {ok:false,reason:'当前 MP4 输出不复制任意软字幕轨；请关闭软字幕保留或改用 MKV'};

  const video=task.operation==='copy' ? cleanCodec(media.videoCodec) : cleanCodec(task.codec);
  if(video && !MP4_VIDEO.has(video))return {ok:false,reason:`当前视频编码 ${video} 未列入 MP4 安全组合`};

  if(task.audio==='libopus')return {ok:false,reason:'当前策略不把 Opus 作为 MP4 安全默认；请改用 AAC、关闭音频或选择 MKV'};
  if(task.audio==='copy'){
    const codecs=copiedAudioCodecs(media);
    if(Number(media.audioTracks||0)>0 && !codecs.length)return {ok:false,reason:'无法确认复制音轨是否适合 MP4；请选择 MKV 或显式转为 AAC'};
    const bad=codecs.find(codec=>!MP4_AUDIO.has(codec));
    if(bad)return {ok:false,reason:`复制的音频编码 ${bad} 未列入 MP4 安全组合；请选择 MKV 或显式转为 AAC`};
  }
  return {ok:true};
}

export function resolveOutputContainer(requested='auto', task={}, media={}) {
  const request=String(requested || 'auto').toLowerCase();
  if(!['auto','keep','mkv','mp4'].includes(request))throw Error('未知成品容器策略');

  const source=sourceContainer(media);
  let key=request;
  let reason='';

  if(request==='keep'){
    if(!source)throw Error('当前源容器不能安全映射到“保持源容器”；请选择 Auto、MKV 或 MP4');
    key=source;
    reason='保持源容器';
  }else if(request==='auto'){
    if(task.operation==='copy' && source){
      const keep=checkContainerCompatibility(source,task,media);
      if(keep.ok){
        key=source;
        reason='无损剪切优先保持源容器';
      }
    }
    if(key==='auto'){
      const mp4=checkContainerCompatibility('mp4',task,media);
      const encodedVideo=task.operation!=='copy';
      const conservativeMp4=encodedVideo && ['h264','h265','hevc'].includes(cleanCodec(task.codec)) && mp4.ok;
      if(conservativeMp4){
        key='mp4';
        reason='当前视频/音频组合适合 MP4';
      }else{
        key='mkv';
        reason='使用兼容性更宽的 MKV 作为安全回退';
      }
    }
  }

  const compatibility=checkContainerCompatibility(key,task,media);
  if(!compatibility.ok)throw Error(compatibility.reason);
  return {...SPECS[key],requested:request,source,reason:reason||'用户指定'};
}

export function containerSpec(key) {
  return SPECS[key] || null;
}

export function outputFileName(base, task) {
  const safe=String(base || 'output').replace(/[. ]+$/,'') || 'output';
  const suffix=task.operation==='copy' ? task.operation : task.operation+'_'+task.codec;
  return `${safe}_${suffix}.${task.outputExtension || 'mkv'}`;
}
