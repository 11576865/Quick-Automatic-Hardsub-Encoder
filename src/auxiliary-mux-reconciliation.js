// B16: actual auxiliary-only preflight versus the *completed* mixed-media
// artifact. An observation cannot be a predictive budget or reusable proof.
const bytes=x=>Number.isSafeInteger(x)&&x>=0;
const order=x=>Number.isInteger(x)&&x>=0;
const fail=(reason)=>({status:'unavailable',reason,comparable:false,
  canReplaceFormalBudget:false,canCertifyFutureMux:false});
export function reconcileAuxiliaryMuxObservation({
 task,completed,preflight,currentSourceKey
}={}){
 if(!task||!preflight?.receipt||!preflight?.request||
    !preflight.sourceKey||preflight.sourceKey!==currentSourceKey)
  return fail('missing-or-stale-source-observation');
 if(!completed?.verified||completed.outputPacketEvidence?.version!==1||
    completed.outputPacketEvidence.scope!=='completed-artifact')
  return fail('final-mixed-mux-packet-audit-unavailable');
 const final=completed.outputPacketEvidence;
 // These three Native-owned fields bind a packet scan to the SAME staged
 // output/job reported as verified, not a numerically similar earlier file.
 if(!bytes(completed.outputBytes)||completed.outputBytes===0||
    final.artifactBytes!==completed.outputBytes||
    typeof completed.jobId!=='string'||!completed.jobId||
    final.artifactJobId!==completed.jobId||
    typeof final.artifactWriteTicks!=='string'||
    !/^[0-9]{1,20}$/.test(final.artifactWriteTicks))
  return fail('finished-artifact-job-or-stat-mismatch');
 if(task.budgetEvidence?.version!==1||task.budgetEvidence.scope!=='full-source'||
    task.budgetEvidence.measurementId!==preflight.measurementId||
    preflight.receipt.measurementId!==preflight.measurementId||
    task.outputFormat!=='matroska')
  return fail('source-ledger-or-output-format-changed');
 if(!Number.isFinite(task.start)||!Number.isFinite(task.end)||
    task.start!==preflight.request.start||task.end!==preflight.request.end||
    (completed.actualStart!=null&&completed.actualStart!==task.start))
  return fail('task-timeline-differs-from-preflight');
 if(!preflight.sourceStat||preflight.receipt.sourceLength!==preflight.sourceStat.length||
    preflight.receipt.sourceWriteTicks!==preflight.sourceStat.writeTicks||
    preflight.receipt.start!==preflight.request.start||
    preflight.receipt.end!==preflight.request.end||
    preflight.receipt.outputFormat!=='matroska')
  return fail('preflight-source-or-range-mismatch');
 const output=completed.outputPacketEvidence;
 const audio=Array.isArray(task.outputPlan?.audio)?task.outputPlan.audio:null;
 if(!audio||!Array.isArray(output.audioPacketBytes)||
    !audio.every((track,i)=>track?.outputOrdinal===i)||
    output.audioPacketBytes.length!==audio.length)
  return fail('final-audio-stream-map-missing');
 const request=preflight.request,receipt=preflight.receipt,rows=[];
 if(request.mode==='isolated-flac-encode'){
  if(receipt.scope!=='isolated-flac-encode-observation'||
     receipt.method!=='ffmpeg-flac-full-input-trim-input-independent-ffprobe-v1'||
     receipt.canReplaceFormalBudget!==false||receipt.canCertifyFinalMux!==false||
     !Array.isArray(request.tracks)||!Array.isArray(receipt.tracks)||
     request.tracks.length!==receipt.tracks.length)
    return fail('flac-preflight-contract-invalid');
  for(let i=0;i<request.tracks.length;i++){
   const x=request.tracks[i],r=receipt.tracks[i];
   const matches=audio.filter(a=>a.sourceOrdinal===x.sourceOrdinal&&
     a.action==='flac'&&a.range===x.range&&
     (a.channels??null)===(x.channels??null)&&
     (a.sampleRate??null)===(x.sampleRate??null));
   if(matches.length!==1||!r||r.sourceOrdinal!==x.sourceOrdinal||
      r.range!==x.range||(r.channels??null)!==(x.channels??null)||
      (r.sampleRate??null)!==(x.sampleRate??null))
    return fail('flac-track-options-mismatch');
   const outOrd=matches[0].outputOrdinal,actual=output.audioPacketBytes[outOrd];
   if(!order(outOrd)||!bytes(actual)||!bytes(r.packetBytes))
    return fail('flac-output-track-bytes-unknown');
   rows.push({kind:'audio',sourceOrdinal:x.sourceOrdinal,outputOrdinal:outOrd,
     action:'flac',preflightBytes:r.packetBytes,finalMuxBytes:actual,
     deltaBytes:actual-r.packetBytes});
  }
 }else if(request.mode==='isolated-trim-copy'){
  if(receipt.scope!=='isolated-trim-copy-observation'||
    receipt.method!=='ffmpeg-isolated-auxiliary-copy-remux-then-independent-ffprobe-v1'||
    receipt.canReplaceFullSourceBudget!==false||
    !Array.isArray(request.audioOrdinals)||!Array.isArray(receipt.audioPacketBytes)||
    request.audioOrdinals.length!==receipt.audioPacketBytes.length||
    !Array.isArray(request.subtitleOrdinals)||!Array.isArray(receipt.subtitlePacketBytes)||
    request.subtitleOrdinals.length!==receipt.subtitlePacketBytes.length)
   return fail('copy-preflight-contract-invalid');
  for(let i=0;i<request.audioOrdinals.length;i++){
   const src=request.audioOrdinals[i];
   const matches=audio.filter(a=>a.sourceOrdinal===src&&a.action==='copy'&&a.range==='trim');
   if(matches.length!==1)return fail('copy-audio-map-mismatch');
   const ord=matches[0].outputOrdinal,actual=output.audioPacketBytes[ord];
   const measured=receipt.audioPacketBytes[i];
   if(!order(ord)||!bytes(actual)||!bytes(measured))
    return fail('copy-audio-packets-unavailable');
   rows.push({kind:'audio',sourceOrdinal:src,outputOrdinal:ord,action:'copy',
     preflightBytes:measured,finalMuxBytes:actual,deltaBytes:actual-measured});
  }
  if(!Array.isArray(output.subtitlePacketBytes))return fail('copy-subtitle-audit-unavailable');
  // compileTask emits subtitle output-plan *objects*, not numeric IDs.
  // Reject symbolic ['all'] mappings because there is no authoritative
  // per-source output ordinal in that projection.
  const subtitles=task.outputPlan?.subtitles;
  if(!Array.isArray(subtitles)||subtitles.some(x=>!x||
     !order(x.sourceOrdinal)||x.action!=='copy')||
     output.subtitlePacketBytes.length!==subtitles.length||
     new Set(subtitles.map(x=>x.sourceOrdinal)).size!==subtitles.length)
   return fail('copy-subtitle-output-map-unavailable');
  for(let i=0;i<request.subtitleOrdinals.length;i++){
   const src=request.subtitleOrdinals[i];
   const ord=subtitles.findIndex(x=>x.sourceOrdinal===src);
   const actual=output.subtitlePacketBytes[ord],measured=receipt.subtitlePacketBytes[i];
   if(ord<0||!bytes(actual)||!bytes(measured)||task.subtitleRange!=='trim')
    return fail('copy-subtitle-packets-unavailable');
   rows.push({kind:'subtitle',sourceOrdinal:src,outputOrdinal:ord,action:'copy',
     preflightBytes:measured,finalMuxBytes:actual,deltaBytes:actual-measured});
  }
 }else return fail('unsupported-preflight-method');
 if(!rows.length||rows.length>32)return fail('no-comparable-auxiliary-stream');
 if(new Set(rows.map(x=>x.kind+':'+x.outputOrdinal)).size!==rows.length)
  return fail('duplicate-final-stream-map');
 const estimated=rows.reduce((s,x)=>s+x.preflightBytes,0);
 const actual=rows.reduce((s,x)=>s+x.finalMuxBytes,0);
 if(!bytes(estimated)||!bytes(actual))return fail('unsafe-packet-total');
 return {status:rows.every(r=>r.deltaBytes===0)?'exact-observed-payload-match':'observed-packet-delta',
  comparable:true,scope:'single-completed-job',sourceMeasurementId:preflight.measurementId,
  observedPreflightBytes:estimated,observedFinalMuxBytes:actual,deltaBytes:actual-estimated,
  rows,comparedStreamCount:rows.length,
  canReplaceFormalBudget:false,canCertifyFutureMux:false,
  note:'本次已完成混合成品逐流包字节与预演可直接比较；单次相等不证明另一任务、另一时间戳、来源或正式封装固定开销等价，不向未来预算转移。'};
}
