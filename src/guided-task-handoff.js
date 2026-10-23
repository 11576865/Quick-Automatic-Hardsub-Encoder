// Rebuild intent in the shared manual compiler; never transfer calibrated evidence.
export function guidedTaskSettings({plan,audio,container}={},defaults={}) {
 const encoders={h264:'libx264',h265:'libx265',av1:'libsvtav1'};
 if(!plan||!encoders[plan.codec]||!['crf','budget-rate'].includes(plan.mode))throw Error('尚无可交接的引导方案');
 if(!['copy','aac','libopus','none'].includes(audio?.audio))throw Error('引导音频策略无效');
 if(!['mkv','mp4'].includes(container))throw Error('引导容器尚未确定');
 // Only an explicitly approved, source-bound per-stream intent may pass
 // across Guided->Manual. Ordinary Guided snapshots keep their legacy
 // whole-source audio policy; never inherit a previous Manual audioPlan.
 const mixed=audio.intent==='explicit-per-stream-v1';
 if(audio.audioPlan!=null&&!mixed)throw Error('逐音轨计划须由用户显式确认');
 const policy=plan.sizeBudgetPolicy||'best-effort';
 if(!['best-effort','two-pass','strict-ceiling'].includes(policy)||policy!=='best-effort'&&plan.codec!=='h264')throw Error('当前引导预算策略不能交接');
 const s={...defaults,operation:'hardsub',codec:plan.codec,encoder:encoders[plan.codec],preset:plan.preset,
  start:0,end:'',videoStreams:'0',videoRange:'full',audioRange:'full',subtitleRange:'full',audioTrack:'all',audioPlan:mixed?audio.audioPlan.map(x=>({...x})):'',
  mustCopyAudioOrdinals:mixed?[...audio.mustCopyAudioOrdinals]:'',
  audioKeepSourceIdentity:mixed?audio.sourceIdentity:'',
  audio:audio.audio,audioBitrate:audio.audioBitrate||128000,audioChannels:audio.audioChannels||'',audioSampleRate:audio.audioSampleRate||'',
  outputContainer:container,keepSubtitles:false,keepAttachments:false,subtitleStreams:'all',attachmentStreams:'all',
  width:plan.outputWidth||'',height:plan.outputHeight||'',scaleAlgorithm:'bicubic',subtitleRenderOrder:'before-scale',sizeReserve:4,rateMode:plan.mode==='crf'?'quality':'size',quality:plan.crf,
  targetSize:plan.mode==='budget-rate'?Number(plan.sizeCeiling)/1000000:defaults.targetSize,sizeUnit:'MB',
  budgetPolicy:policy==='strict-ceiling'?'strict-ceiling':'best-effort',twoPass:policy!=='best-effort'};
 if(s.rateMode==='size'&&!(s.targetSize>0))throw Error('引导目标体积无效');
 delete s.budgetEvidence;delete s.calibration;
 return s;
}
