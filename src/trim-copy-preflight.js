// B16: verify an independently FFmpeg-remuxed pre-encode trim copy receipt.
// This is a separate, useful cost observation, never authorization to reduce
// the authoritative whole-source budget. Timestamp/other streams affect muxing.
const nat=n=>Number.isSafeInteger(n)&&n>=0;
const ordinals=a=>Array.isArray(a)&&a.length<=32&&
  a.every(v=>Number.isSafeInteger(v)&&v>=0&&v<64)&&new Set(a).size===a.length;
const same=a=>JSON.stringify(a);
export function assessIsolatedTrimCopyPreflight({
 receipt,request,sourceStat,fullSourceEvidence
}={}){
 if(!request||request.mode!=='isolated-trim-copy'||request.version!==1||
    !sourceStat||!nat(sourceStat.length)||!nat(sourceStat.writeTicks)||
    !(Number.isFinite(request.start)&&request.start>=0)||
    !(Number.isFinite(request.end)&&request.end>request.start)||
    request.end-request.start>3600||
    !['matroska','mp4'].includes(request.outputFormat)||
    !ordinals(request.audioOrdinals)||!ordinals(request.subtitleOrdinals)||
    request.audioOrdinals.length+request.subtitleOrdinals.length===0)
  return {ok:false,reason:'invalid-trim-preflight-request'};
 if(!receipt||receipt.version!==1||
    receipt.scope!=='isolated-trim-copy-observation'||
    receipt.method!=='ffmpeg-isolated-auxiliary-copy-remux-then-independent-ffprobe-v1'||
    receipt.observationOnly!==true||receipt.canReplaceFullSourceBudget!==false||
    receipt.sourceLength!==sourceStat.length||
    String(receipt.sourceWriteTicks)!==String(sourceStat.writeTicks)||
    Math.abs(receipt.start-request.start)>1e-6||
    Math.abs(receipt.end-request.end)>1e-6||
    receipt.outputFormat!==request.outputFormat||
    same(receipt.audioOrdinals)!==same(request.audioOrdinals)||
    same(receipt.subtitleOrdinals)!==same(request.subtitleOrdinals)||
    !Array.isArray(receipt.audioPacketBytes)||
    !Array.isArray(receipt.subtitlePacketBytes)||
    receipt.audioPacketBytes.length!==request.audioOrdinals.length||
    receipt.subtitlePacketBytes.length!==request.subtitleOrdinals.length||
    !receipt.audioPacketBytes.every(nat)||
    !receipt.subtitlePacketBytes.every(nat))
  return {ok:false,reason:'incompatible-isolated-remux-receipt'};
 if(fullSourceEvidence?.version!==1||
    fullSourceEvidence.scope!=='full-source'||
    !Array.isArray(fullSourceEvidence.audioPacketBytes)||
    !Array.isArray(fullSourceEvidence.subtitlePacketBytes))
  return {ok:false,reason:'missing-authoritative-whole-source-packets'};
 const mapped=[],select=(kind,list,values)=>{
   const full=fullSourceEvidence[kind==='audio'?'audioPacketBytes':'subtitlePacketBytes'];
   for(let i=0;i<list.length;i++){
     const size=full[list[i]];
     if(!nat(size))return false;
     mapped.push({kind,sourceOrdinal:list[i],sourceBytes:size,observedRemuxBytes:values[i]});
   }
   return true;
 };
 if(!select('audio',request.audioOrdinals,receipt.audioPacketBytes)||
    !select('subtitle',request.subtitleOrdinals,receipt.subtitlePacketBytes))
  return {ok:false,reason:'source-packet-ledger-incomplete'};
 const reservedBytes=mapped.reduce((s,x)=>s+x.sourceBytes,0);
 const observedBytes=mapped.reduce((s,x)=>s+x.observedRemuxBytes,0);
 if(!nat(reservedBytes)||!nat(observedBytes))
  return {ok:false,reason:'unsafe-packet-cost-overflow'};
 return {
  ok:true,scope:'isolated-trim-copy-observation',
  method:receipt.method,mapped,observedBytes,
  reservedWholeSourceBytes:reservedBytes,
  observedDeltaBytes:reservedBytes-observedBytes,
  observationOnly:true,canReplaceFullSourceBudget:false,
  canCertifyFinalMux:false,
  note:'独立辅助流预演可观察 FFmpeg 裁切复制包字节；最终视频/音频/字幕共同封装的包选择、时间戳和容器行为仍须实测。正式大小预算继续使用完整源流保守上界。'
 };
}
