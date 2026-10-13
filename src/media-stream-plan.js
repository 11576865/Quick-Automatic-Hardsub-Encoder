const integer=(value,min,max,label)=>{
  const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+' 超出有效范围');return n;
};
export function normalizeAudioPlan(value,media,defaultRange='trim'){
  if(value==null||value==='')return null;
  const entries=typeof value==='string'?JSON.parse(value):value;
  const count=Number(media.audioTracks??media.audioStreams?.length??0);
  if(!Array.isArray(entries)||entries.length>32)throw Error('逐音轨计划最多 32 项');
  const seen=new Set();
  return entries.map(entry=>{
    if(!entry||typeof entry!=='object')throw Error('音轨计划无效');
    const sourceOrdinal=integer(entry.sourceOrdinal,0,Math.min(count-1,99),'源音轨索引');
    if(seen.has(sourceOrdinal))throw Error('源音轨重复');seen.add(sourceOrdinal);
    const action=entry.action;
    if(!['copy','aac','libopus','flac','drop'].includes(action))throw Error('音轨动作无效');
    const range=entry.range||defaultRange;
    if(!['trim','full'].includes(range))throw Error('音轨时间策略无效');
    const result={sourceOrdinal,action,range};
    if(['aac','libopus'].includes(action))result.bitrate=integer(entry.bitrate??128000,8000,1024000,'音频码率');
    if(entry.channels!==''&&entry.channels!=null){
      if(['copy','drop'].includes(action))throw Error('复制/删除音轨不能改变声道');
      result.channels=integer(entry.channels,1,8,'音频声道');
    }
    if(entry.sampleRate!==''&&entry.sampleRate!=null){
      if(['copy','drop'].includes(action))throw Error('复制/删除音轨不能改变采样率');
      result.sampleRate=integer(entry.sampleRate,8000,192000,'音频采样率');
      if(action==='libopus'&&![8000,12000,16000,24000,48000].includes(result.sampleRate))throw Error('Opus 采样率无效');
    }
    return Object.freeze(result);
  });
}
export function auxiliarySelection(value,count,label){
  if(value==null||value===''||String(value).trim()==='all')return null;
  if(!Number.isInteger(Number(count))||Number(count)<0)throw Error('尚未读取'+label+'数量');
  const values=Array.isArray(value)?value:String(value).split(',').map(x=>x.trim());
  if(values.length>32||values.length===0)throw Error(label+'选择无效');
  const result=values.map(x=>{if(!/^\d+$/.test(String(x)))throw Error(label+'索引无效');return integer(x,0,Number(count)-1,label+'索引');});
  if(new Set(result).size!==result.length)throw Error(label+'索引重复');
  return result;
}
export function appendPlannedAudioArgs(args,plan){
  let index=0;
  for(const track of plan){
    if(track.action==='drop')continue;
    args.push('-c:a:'+index,track.action);
    if(track.bitrate!=null)args.push('-b:a:'+index,String(track.bitrate));
    if(track.channels!=null)args.push('-ac:a:'+index,String(track.channels));
    if(track.sampleRate!=null)args.push('-ar:a:'+index,String(track.sampleRate));
    index++;
  }
}
export function validatePlannedAudioOutput(task,output,source){
  if(!task.audioPlan)return;
  const kept=task.audioPlan.filter(a=>a.action!=='drop');
  if(output.length!==kept.length)throw Error('逐轨成品音轨数量不符');
  kept.forEach((track,index)=>{
    const expected=track.action==='copy'?(source[track.sourceOrdinal]?.codec||source[track.sourceOrdinal]?.codec_name):track.action==='libopus'?'opus':track.action;
    const actual=output[index];
    if(!expected||(actual.codec||actual.codec_name)!==expected)throw Error('逐轨成品音频编码不符');
    if(track.channels&&Number(actual.channels)!==track.channels)throw Error('逐轨成品声道不符');
    if(track.sampleRate&&Number(actual.sampleRate||actual.sample_rate)!==track.sampleRate)throw Error('逐轨成品采样率不符');
  });
}
export function createOutputPlan(task,media){
  const facts=media.audioStreams||[];
  const audio=task.audioPlan??(task.audio==='none'?[]:(task.audioTrack==='all'
    ?Array.from({length:task.expectedAudioTracks},(_,sourceOrdinal)=>({sourceOrdinal,action:task.audio,range:task.audioRange}))
    :[{sourceOrdinal:Number(task.audioTrack),action:task.audio,range:task.audioRange}]));
  const kept=audio.filter(t=>t.action!=='drop');
  const describe=(track,outputOrdinal)=>({...track,outputOrdinal,sourceIndex:facts[track.sourceOrdinal]?.index??null,
    sourceCodec:facts[track.sourceOrdinal]?.codec||facts[track.sourceOrdinal]?.codec_name||null});
  return Object.freeze({version:1,video:task.videoStreams.map(sourceOrdinal=>({sourceOrdinal,action:task.operation==='copy'?'copy':'encode'})),
    audio:kept.map(describe),droppedAudio:Array.from({length:Number(media.audioTracks||0)},(_,sourceOrdinal)=>sourceOrdinal)
      .filter(n=>!kept.some(t=>t.sourceOrdinal===n)).map(sourceOrdinal=>({sourceOrdinal,action:'drop'})),
    subtitles:task.keepSubtitles?(task.subtitleSelection??['all']).map(sourceOrdinal=>({sourceOrdinal,action:'copy'})):[],
    attachments:task.keepAttachments?(task.attachmentSelection??['all']).map(sourceOrdinal=>({sourceOrdinal,action:'copy'})):[],
    metadata:!!task.keepMetadata,chapters:!!task.keepChapters});
}
