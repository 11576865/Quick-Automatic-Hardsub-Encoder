// A real FLAC pre-encode is an independent measurement. A separate
// video+audio final mux may change packet framing/metadata/timestamps.
const bytes=n=>Number.isSafeInteger(n)&&n>=0;
const rate=n=>n==null||(Number.isSafeInteger(n)&&n>=8000&&n<=192000);
const channels=n=>n==null||(Number.isSafeInteger(n)&&n>=1&&n<=8);
const same=a=>JSON.stringify(a);
export function assessFlacEncodeObservation({receipt,request,sourceStat,fullSourceEvidence}={}){
 if(!request||request.version!==1||request.mode!=='isolated-flac-encode'||
    request.outputFormat!=='matroska'||!Array.isArray(request.tracks)||
    request.tracks.length<1||request.tracks.length>16||
    !Number.isFinite(request.start)||request.start<0||
    !Number.isFinite(request.end)||request.end<=request.start||
    request.end-request.start>14400||
    !sourceStat||!bytes(sourceStat.length)||
    typeof sourceStat.writeTicks!=='string'||!/^[0-9]{1,20}$/.test(sourceStat.writeTicks)||
    request.tracks.some(t=>!t||t.action!=='flac'||t.range!=='full'&&t.range!=='trim'||
      !Number.isSafeInteger(t.sourceOrdinal)||t.sourceOrdinal<0||t.sourceOrdinal>63||
      !channels(t.channels)||!rate(t.sampleRate))||
    new Set(request.tracks.map(t=>t.sourceOrdinal)).size!==request.tracks.length)
  return {ok:false,reason:'invalid-flac-preflight-request'};
 if(!receipt||receipt.version!==1||receipt.scope!=='isolated-flac-encode-observation'||
    receipt.method!=='ffmpeg-flac-full-input-trim-input-independent-ffprobe-v1'||
    receipt.observationOnly!==true||receipt.canReplaceFormalBudget!==false||
    receipt.canCertifyFinalMux!==false||
    receipt.sourceLength!==sourceStat.length||
    String(receipt.sourceWriteTicks)!==sourceStat.writeTicks||
    receipt.start!==request.start||receipt.end!==request.end||
    receipt.outputFormat!==request.outputFormat||
    !Array.isArray(receipt.tracks)||receipt.tracks.length!==request.tracks.length)
  return {ok:false,reason:'incompatible-flac-receipt'};
 if(!fullSourceEvidence||fullSourceEvidence.version!==1||
    fullSourceEvidence.scope!=='full-source'||
    !Array.isArray(fullSourceEvidence.audioPacketBytes))
  return {ok:false,reason:'missing-source-audio-ledger'};
 const entries=[];
 for(let i=0;i<request.tracks.length;i++){
  const input=request.tracks[i],encoded=receipt.tracks[i];
  if(!encoded||encoded.sourceOrdinal!==input.sourceOrdinal||
     encoded.range!==input.range||
     (encoded.channels??null)!==(input.channels??null)||
     (encoded.sampleRate??null)!==(input.sampleRate??null)||
     !bytes(encoded.packetBytes))
   return {ok:false,reason:'incompatible-flac-track'};
  if(!bytes(fullSourceEvidence.audioPacketBytes[input.sourceOrdinal]))
   return {ok:false,reason:'missing-source-track-packets'};
  entries.push({sourceOrdinal:input.sourceOrdinal,range:input.range,
    packetBytes:encoded.packetBytes,
    sourceAudioPacketBytes:fullSourceEvidence.audioPacketBytes[input.sourceOrdinal]});
 }
 const observedBytes=entries.reduce((x,t)=>x+t.packetBytes,0);
 if(!bytes(observedBytes))return {ok:false,reason:'flac-packet-total-overflow'};
 return {ok:true,kind:'source-owned-flac-encode-observation-v1',
   sourceLength:sourceStat.length,sourceWriteTicks:sourceStat.writeTicks,
   observedBytes,tracks:entries,observationOnly:true,
   canReplaceFormalBudget:false,canCertifyFinalMux:false,
   requiresFinalMuxValidation:true,
   note:'实际 FLAC 音频重编码已观测，但与最终视频/音轨/字幕混合输出的包大小和时间戳尚未证明等价。正式严格体积预算仍拒绝未经认证的 FLAC 成本。'};
}
