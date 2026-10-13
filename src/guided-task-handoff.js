// Rebuild intent in the shared manual compiler; never transfer calibrated evidence.
export function guidedTaskSettings({plan,audio,container}={},defaults={}) {
 const encoders={h264:'libx264',h265:'libx265',av1:'libsvtav1'};
 if(!plan||!encoders[plan.codec]||!['crf','budget-rate'].includes(plan.mode))throw Error('尚无可交接的引导方案');
 if(!['copy','aac','libopus','none'].includes(audio?.audio))throw Error('引导音频策略无效');
 if(!['mkv','mp4'].includes(container))throw Error('引导容器尚未确定');
 const policy=plan.sizeBudgetPolicy||'best-effort';
 if(!['best-effort','two-pass','strict-ceiling'].includes(policy)||policy!=='best-effort'&&plan.codec!=='h264')throw Error('当前引导预算策略不能交接');
 const s={...defaults,operation:'hardsub',codec:plan.codec,encoder:encoders[plan.codec],preset:plan.preset,
  start:0,end:'',videoStreams:'0',videoRange:'full',audioRange:'full',subtitleRange:'full',audioTrack:'all',audioPlan:'',
  audio:audio.audio,audioBitrate:audio.audioBitrate||128000,audioChannels:audio.audioChannels||'',audioSampleRate:audio.audioSampleRate||'',
  outputContainer:container,keepSubtitles:false,keepAttachments:false,subtitleStreams:'all',attachmentStreams:'all',
  width:plan.outputWidth||'',height:plan.outputHeight||'',scaleAlgorithm:'bicubic',sizeReserve:4,rateMode:plan.mode==='crf'?'quality':'size',quality:plan.crf,
  targetSize:plan.mode==='budget-rate'?Number(plan.sizeCeiling)/1000000:defaults.targetSize,sizeUnit:'MB',
  budgetPolicy:policy==='strict-ceiling'?'strict-ceiling':'best-effort',twoPass:policy!=='best-effort'};
 if(s.rateMode==='size'&&!(s.targetSize>0))throw Error('引导目标体积无效');
 delete s.budgetEvidence;delete s.calibration;
 return s;
}
