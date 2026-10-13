// QHE B04/B12: an executable CPU handoff goes through the same authoritative
// compileTask as the Manual workbench. This is not proof that Native NVENC,
// the web codec, or any ASS renderer is byte-for-byte equivalent.
import {guidedTaskSettings} from './guided-task-handoff.js';
import {compileTask} from './media-task.js';

const integer=n=>Number.isSafeInteger(n)&&n>0;
const encoderFor=Object.freeze({h264:'libx264',h265:'libx265',av1:'libsvtav1'});
const fail=(reason,detail='')=>({ok:false,reason,detail});
const settingsFields=[
  'operation','codec','encoder','preset','rateMode','quality','bitrate',
  'width','height','scaleAlgorithm','subtitleRenderOrder','targetSize','sizeUnit','sizeReserve',
  'budgetPolicy','twoPass','audio','audioTrack','audioPlan','audioRange',
  'audioBitrate','audioChannels','audioSampleRate','videoStreams','videoRange',
  'keepSubtitles','keepAttachments','outputContainer'
];
function executableProjection(task){
 return {
  codec:task.codec,encoder:task.encoder,preset:task.preset,
  rateMode:task.rateMode,bitrate:task.bitrate,
  outputContainer:task.outputContainer,outputFormat:task.outputFormat,
  outputExtension:task.outputExtension,
  subtitleRenderOrder:task.subtitleRenderOrder||'after-scale',
  width:task.expectedWidth||0,height:task.expectedHeight||0,
  audio:task.audio,expectedAudioTracks:task.expectedAudioTracks,
  audioRange:task.audioRange,videoRange:task.videoRange,
  strict:task.budgetPolicy==='strict-ceiling',
  twoPass:task.twoPass===true,
  targetBytes:task.sizePlan?.targetBytes||null,
  containerReserveBytes:task.sizePlan?.containerReserveBytes||null,
  fixedPayloadBytes:task.sizePlan?.fixedPayloadBytes||null,
  encodedAudioBytes:task.sizePlan?.encodedAudioBytes||null,
  reservePercent:task.sizePlan?.reservePercent||null,
  outputArgs:[...(task.outputArgs||[])]
 };
}
// Apply only after a complete source-scoped CPU compile. Verify what the
// DOM actually accepted, then reverse the form transaction on any drift.
export function commitGuidedCpuHandoff({
 contract,read,apply,media,evidence=null,
 sourceIdentity,expectedSourceIdentity
}={}){
 if(!contract?.ok||typeof read!=='function'||typeof apply!=='function'||
    typeof sourceIdentity!=='function'||!expectedSourceIdentity||
    sourceIdentity()!==expectedSourceIdentity||!media)
  return fail('invalid-or-stale-guided-cpu-handoff');
 const prior=read();
 let changed=false;
 try{
  if(sourceIdentity()!==expectedSourceIdentity)
    throw Error('source-changed-before-handoff');
  changed=true;
  apply(contract.settings);
  if(sourceIdentity()!==expectedSourceIdentity)
    throw Error('source-changed-during-handoff');
  const current=compileTask(read(),{...media,budgetEvidence:evidence||undefined});
  const projection=executableProjection(current);
  if(JSON.stringify(projection)!==JSON.stringify(contract.execution))
    throw Error('applied-formal-task-diverged');
  return {ok:true,kind:'guided-to-manual-cpu-handoff-v1',
    task:current,requiresFreshExecutionValidation:true};
 }catch(error){
  if(changed){
    try{apply(prior);}catch(e){
      return fail('guided-cpu-handoff-rollback-failed',String(e?.message||e));
    }
  }
  return fail('guided-cpu-handoff-rejected',String(error?.message||error));
 }
}
export function compileGuidedCpuHandoff({
 snapshot,defaults={},media,evidence=null,sourceKey='',evidenceSourceKey=''
}={}){
 const plan=snapshot?.plan,audio=snapshot?.audio;
 if(!plan||!media||!(Number(media.duration)>0)||
    typeof sourceKey!=='string'||!sourceKey)
  return fail('missing-guided-source-or-plan');
 if(plan.mode==='budget-rate'&&
   (!integer(plan.sizeCeiling)||!integer(plan.targetVideoBitrate)||
    !['best-effort','two-pass','strict-ceiling'].includes(plan.sizeBudgetPolicy||'best-effort')))
  return fail('invalid-guided-size-plan');
 if(sourceKey&&evidence&&sourceKey!==evidenceSourceKey)
  return fail('stale-source-budget-evidence');
 if(plan.mode==='budget-rate'&&audio?.audio==='copy'&&
   Number(media.audioTracks)>0&&(!evidence||evidence.scope!=='full-source'))
  return fail('missing-copied-audio-cost-evidence');
 let settings,task;
 try{
  settings=guidedTaskSettings(snapshot,defaults);
  task=compileTask(settings,{...media,budgetEvidence:evidence||undefined});
 }catch(error){
  return fail('shared-compiler-rejected-guided-intent',String(error?.message||error));
 }
 if(task.operation!=='hardsub'||task.codec!==plan.codec||
    task.encoder!==encoderFor[plan.codec]||task.preset!==plan.preset||
    task.outputContainer!==snapshot.container||
    task.expectedVideoTracks!==1||task.videoRange!=='full'||
    task.keepSubtitles!==false||task.keepAttachments!==false||
    task.audio!==audio?.audio||task.expectedAudioTracks!==
      (audio.audio==='none'?0:Number(media.audioTracks??0)))
  return fail('compiled-guided-executable-divergence');
 if((task.expectedWidth||0)!==(Number(plan.outputWidth)||0)||
    (task.expectedHeight||0)!==(Number(plan.outputHeight)||0))
  return fail('compiled-guided-geometry-divergence');
 if(task.subtitleRenderOrder!=='before-scale')
  return fail('compiled-guided-ass-render-order-divergence');
 // Reject non-Guided filters inherited from a previous manual configuration.
 // The legacy Native Guided renderer paints ASS at source geometry and then
 // applies bicubic scaling; the exact filter ordering is a reference boundary.
 const vf=task.outputArgs[task.outputArgs.indexOf('-vf')+1]||'';
 const expectedFilter=[
  'ass=__ASS__:fontsdir=__FONTS__',
  ...(plan.outputWidth>0&&plan.outputHeight>0
    ?['scale='+plan.outputWidth+':'+plan.outputHeight+':flags=bicubic']:[]),
  'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0'
 ].join(',');
 if(vf!==expectedFilter)
  return fail('compiled-guided-render-filter-divergence');
 if(task.pixelFormat!=='yuv420p'||task.fpsMode!=='auto'||
    task.hasTrimRange||task.start!==0||task.end!==Number(media.duration)||
    task.outputArgs.some(arg=>['-r','-frames:v','-vf_complex','-x264-params',
      '-x265-params','-svtav1-params','-g','-bf','-refs','-maxrate',
      '-bufsize'].includes(arg)))
  return fail('compiled-guided-production-settings-divergence');
 if(plan.mode==='budget-rate'){
  if(task.rateMode!=='size'||!task.sizePlan||
     task.sizePlan.targetBytes!==plan.sizeCeiling||
     task.sizePlan.videoRate!==plan.targetVideoBitrate||
     task.sizePlan.reservePercent!==4||
     task.twoPass!==(plan.sizeBudgetPolicy!=='best-effort')||
     task.budgetPolicy!==(plan.sizeBudgetPolicy==='strict-ceiling'?'strict-ceiling':'best-effort')||
     task.sizeCeilingBytes!==(plan.sizeBudgetPolicy==='strict-ceiling'?plan.sizeCeiling:0))
    return fail('compiled-guided-whole-file-budget-divergence');
  if(integer(plan.containerReserveBytes)&&
     task.sizePlan.containerReserveBytes!==plan.containerReserveBytes)
    return fail('compiled-guided-container-reserve-divergence');
  if(Number.isFinite(plan.fixedPayloadBytes)&&
     task.sizePlan.fixedPayloadBytes!==plan.fixedPayloadBytes)
    return fail('compiled-guided-fixed-stream-divergence');
  if(Number.isFinite(plan.encodedAudioBytes)&&
     task.sizePlan.encodedAudioBytes!==plan.encodedAudioBytes)
    return fail('compiled-guided-audio-cost-divergence');
 }else if(task.rateMode!=='quality'||task.quality!==plan.crf||
          task.twoPass!==false){
  return fail('compiled-guided-quality-divergence');
 }
 const execution=executableProjection(task);
 return {
  ok:true,kind:'guided-cpu-shared-task-compiler-v1',
  settings,task,execution,
  sourceKey:sourceKey||null,
  // Explicitly a *new* CPU compile, not a transplant of Guided Native proof.
  sourceReferenceTransferAllowed:false,
  nativeVbrCertificateTransferAllowed:false,
  requiresFreshExecutionValidation:true,
  fullMovieBytesVerified:false,
  fullMovieQualityVerified:false,
  inspectedFields:settingsFields
 };
}
