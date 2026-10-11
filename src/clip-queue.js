import {parseMediaTime, formatMediaTimeInput} from './media-time.js';

/**
 * A queue clip is a requested IN/OUT, not a promise of frame-exact Stream Copy.
 * Actual IN may snap backwards to a keyframe during the native/web task.
 */
export function makeQueuedClip(startValue,endValue,media) {
  if(!Number.isFinite(Number(media?.duration))||Number(media.duration)<=0)
    throw Error('请先读取有效的视频时长');
  if(!String(endValue??'').trim())throw Error('批量片段需要明确填写结束时间 OUT');
  const max=Number(media.duration);
  const start=parseMediaTime(startValue,{empty:0,max,label:'片段 IN'});
  const end=parseMediaTime(endValue,{max,label:'片段 OUT'});
  if(end<=start)throw Error('片段 OUT 必须晚于 IN');
  return {start,end,startText:formatMediaTimeInput(start,3),endText:formatMediaTimeInput(end,3),duration:end-start};
}

export function validateQueuedCopySettings(raw) {
  if(raw.operation!=='copy')throw Error('片段队列仅用于无损剪切');
  if(raw.videoRange!=='trim')throw Error('批量片段要求视频时间轴使用 IN / OUT');
  if(raw.audio!=='none'&&raw.audioRange!=='trim')
    throw Error('批量片段要求音频也按 IN / OUT 剪切，避免生成整段音频');
  if(raw.keepSubtitles&&raw.subtitleRange!=='trim')
    throw Error('批量片段要求软字幕也按 IN / OUT 剪切');
}

export function clipOutputName(filename,index) {
  const raw=String(filename||'output.mkv');
  const dot=raw.lastIndexOf('.');
  const stem=dot>0?raw.slice(0,dot):raw;
  const ext=dot>0?raw.slice(dot):'';
  return stem+'-clip-'+String(index).padStart(2,'0')+ext;
}
