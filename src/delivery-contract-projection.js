// WU06 / R19 P1: a read-only domain view of ONE authoritative schema-v4
// compiled task. This is not an alternative task compiler or user-intent owner.
// Input media facts are observations, while intent is inferred from a compiled
// user-selected task; missing real-world evidence must remain explicitly null.
const deepFreeze=value=>{
  if(value && typeof value==='object' && !Object.isFrozen(value)){
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const safeText=(v)=>v==null?'':String(v);
const streamFact=(media,key,ordinal)=> {
  const facts=Array.isArray(media?.[key])?media[key][ordinal]:null;
  return {
    sourceOrdinal:ordinal,
    sourceIndex:Number.isInteger(Number(facts?.index))?Number(facts.index):null,
    codec:safeText(facts?.codec||facts?.codec_name)||'unknown',
    language:safeText(facts?.language||facts?.tags?.language)||'und',
    title:safeText(facts?.title||facts?.tags?.title),
  };
};
const ordinalEntries=(media,key,countKey)=>{
  const n=Number(media?.[countKey]??media?.[key]?.length??0);
  if(!Number.isSafeInteger(n)||n<0||n>64)throw Error('Source stream inventory is incomplete or over bounded limit');
  return Array.from({length:n},(_,index)=>streamFact(media,key,index));
};
const codecFor=(task)=>task.operation==='copy'?'copy':safeText(task.encoder)||'unknown';
const flagValues=(args,flag)=>{
  const result=[];for(let i=0;i<args.length-1;i++)
    if(args[i]===flag)result.push(String(args[i+1]));
  return result;
};
export function projectReadOnlyDeliveryContract({task,media,sourceIdentity='' }={}){
  if(task?.version!==4||!task.outputPlan||!Array.isArray(task.outputArgs))
    throw Error('Domain projection requires authoritative compiled schema-v4 task');
  if(!media||!(Number(media.duration)>0))throw Error('Domain projection needs observed source media');
  const plan=structuredClone(task.outputPlan);
  const args=[...task.outputArgs].map(String);
  const sourceIdentityValue=safeText(sourceIdentity);
  const video=ordinalEntries(media,'videoStreams','videoTracks');
  const audio=ordinalEntries(media,'audioStreams','audioTracks');
  const subtitles=ordinalEntries(media,'subtitleStreams','subtitleTracks');
  const attachments=ordinalEntries(media,'attachmentStreams','attachmentTracks');
  const selectedVideo=new Map((plan.video||[]).map(s=>[s.sourceOrdinal,s]));
  const selectedAudio=new Map((plan.audio||[]).map(s=>[s.sourceOrdinal,s]));
  const selectedSub=new Map((plan.subtitles||[]).map(s=>[s.sourceOrdinal,s]));
  const selectedAttachments=new Map((plan.attachments||[]).map(s=>[s.sourceOrdinal,s]));
  const withAction=(items,lookup,otherwise)=>items.map(row=>{
    const entry=lookup.get(row.sourceOrdinal);
    return {...row,action:entry?.action||otherwise,
      outputOrdinal:entry?.outputOrdinal??null,
      range:entry?.range??null};
  });
  const allStreams={
    video:withAction(video,selectedVideo,'not-selected'),
    audio:withAction(audio,selectedAudio,'drop'),
    subtitles:withAction(subtitles,selectedSub,task.operation==='hardsub'?'not-carried-soft':'drop'),
    attachments:withAction(attachments,selectedAttachments,'drop')
  };
  const maps=flagValues(args,'-map');
  const warnings=[];
  const hasMap=(kind,ordinal)=>maps.some(m=>new RegExp('^[01]:'+kind+':'+ordinal+'$').test(m));
  for(const stream of plan.video||[])
    if(!hasMap('v',stream.sourceOrdinal))
      warnings.push('已选视频 #'+stream.sourceOrdinal+' 未在编译参数中找到显式 -map');
  if(task.operation==='copy'){
    if(!args.includes('-c:v')||args[args.indexOf('-c:v')+1]!=='copy')
      warnings.push('Stream Copy 的实际 -c:v 并非 copy');
  }else if(!args.includes('-c:v')||args[args.indexOf('-c:v')+1]!==task.encoder){
    warnings.push('视频编码器选择与实际 -c:v 不一致');
  }
  if(task.operation==='hardsub'&&!args.some(s=>s.includes('ass=__ASS__')))
    warnings.push('硬字幕的正式滤镜参数不含 ASS 烧录占位符');
  if(sourceIdentityValue==='')warnings.push('本次审阅未包含稳定来源身份；不能据此签收来源不变性');
  return deepFreeze({
    version:1,
    state:'read-only-projection-not-independent-job-authority',
    sourceAsset:{
      identity:sourceIdentityValue||null,
      sourceName:safeText(media.sourceName||media.name)||null,
      container:safeText(media.formatName||media.format)||null,
      duration:Number(media.duration)
    },
    sourceStreams:allStreams,
    userIntent:{
      provenance:'inferred-from-compiled-user-settings-not-a-separate-signed-intent',
      operation:task.operation,
      codecAction:codecFor(task),
      container:task.outputContainer,
      subtitleBurnIn:task.operation==='hardsub',
      keepsOriginalSoftSubtitles:!!task.keepSubtitles,
      keepsOriginalAttachments:!!task.keepAttachments,
      keepsMetadata:!!task.keepMetadata,
      keepsChapters:!!task.keepChapters,
      requestedIn:Number(task.start??0),
      requestedOut:Number(task.end??media.duration)
    },
    outputPlan:plan,
    executablePlanView:{
      status:'observed-from-authoritative-compiled-task',
      schemaVersion:task.version,operation:task.operation,
      outputFormat:task.outputFormat,encoder:codecFor(task),
      mappedSources:maps,rawOutputArgs:args
    },
    artifactRecord:{status:'not-produced-by-this-projection',
      outputBytes:null,streamVerification:null,playbackVerification:null},
    trace:{status:warnings.length?'review-required':'compiled-map-consistent',
      checks:['video-map','selected-video-codec','hardsub-filter-if-applicable'],
      warnings,
      limitation:'此投影不能替代 Native FFmpeg 执行、最终媒体流/哈希核验或用户对保留决策的确认'}
  });
}
