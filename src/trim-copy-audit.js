// Post-output packet observation only. Full-source copied bytes remain the
// conservative input-side budget for trimmed streams; a remux can choose
// additional boundary packets and a sample observation is never a certificate.
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const validPayload=values=>Array.isArray(values)&&values.every(integer);

export function auditTrimCopyPayload(task, outputEvidence) {
  if(!task?.hasTrimRange || !task.sizePlan?.copiedTrimReserveBytes ||
     task.budgetEvidence?.version!==1 ||
     task.budgetEvidence?.scope!=='full-source' ||
     outputEvidence?.version!==1 ||
     outputEvidence?.scope!=='completed-artifact')return null;
  const source=task.budgetEvidence;
  const selected=[];
  const push=(kind,sourceOrdinal,outputOrdinal)=>{
    const key=kind==='audio'?'audioPacketBytes':'subtitlePacketBytes';
    const before=source[key]?.[sourceOrdinal];
    const after=outputEvidence[key]?.[outputOrdinal];
    if(!integer(before)||!integer(after))throw Error('逐流裁切成品包字节尚未完成独立计量');
    selected.push({kind,sourceOrdinal,outputOrdinal,sourcePacketBytes:before,outputPacketBytes:after});
  };
  try {
    if(Array.isArray(task.audioPlan)){
      let outputOrdinal=0;
      for(const track of task.audioPlan){
        if(track.action==='drop')continue;
        if(track.action==='copy'&&track.range==='trim')push('audio',track.sourceOrdinal,outputOrdinal);
        outputOrdinal++;
      }
    }else if(task.audio==='copy'&&task.audioRange==='trim'&&task.expectedAudioTracks>0){
      const ordinals=task.audioTrack==='all'?
        Array.from({length:task.expectedAudioTracks},(_,i)=>i):
        [Number(task.audioTrack)];
      ordinals.forEach((ordinal,index)=>push('audio',ordinal,index));
    }
    if(task.keepSubtitles&&task.subtitleRange==='trim'){
      const ordinals=Array.isArray(task.subtitleSelection)?task.subtitleSelection:
        (validPayload(source.subtitlePacketBytes)?
          source.subtitlePacketBytes.map((_,i)=>i):[]);
      ordinals.forEach((ordinal,index)=>push('subtitle',ordinal,index));
    }
  }catch{return null;}
  if(!selected.length)return null;
  const sourcePacketBytes=selected.reduce((sum,entry)=>sum+entry.sourcePacketBytes,0);
  const outputPacketBytes=selected.reduce((sum,entry)=>sum+entry.outputPacketBytes,0);
  if(!integer(sourcePacketBytes)||!integer(outputPacketBytes)||
     sourcePacketBytes!==task.sizePlan.copiedTrimReserveBytes)return null;
  return {
    version:1,scope:'completed-artifact',
    status:outputPacketBytes<=sourcePacketBytes?'observed':'output-exceeds-source-cost',
    sourcePacketBytes,outputPacketBytes,
    reservedBytes:sourcePacketBytes,
    overreserveBytes:sourcePacketBytes-outputPacketBytes,
    selected,canReplacePreflightBudget:false,
    note:'实际裁切成品包字节仅用于审计；正式任务的复制流预算仍保留完整源流上界。'
  };
}
