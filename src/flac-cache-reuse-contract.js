// B16 experimental FLAC reuse evidence, scoped to one REAL cache and one
// finished mixed mux. A payload equality certificate is not an estimate of
// future mux bytes or authorization to relax a strict size budget.
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const tick=s=>typeof s==='string'&&/^[0-9]{1,20}$/.test(s);
const refuse=reason=>({ok:false,reason,
  cacheAudioPacketReuseVerified:false,canAuthorizeStrictBudget:false,
  canPredictNextJobSize:false,canRebaseWholeSourceLedger:false});
export function verifyFlacCachedPacketReuse({cache,finished,plan,sourceKey}={}){
 if(!cache||cache.version!==1||cache.kind!=='encoded-flac-cache-v1'||
    !finished||finished.version!==1||finished.kind!=='completed-mixed-mux-v1'||
    !plan||plan.version!==1||plan.method!=='cached-flac-packets-copy-v1'||
    !sourceKey||cache.sourceKey!==sourceKey||plan.sourceKey!==sourceKey||
    !cache.measurementId||cache.measurementId!==plan.measurementId||
    !sha(cache.sourceSha256)||!sha(cache.artifactSha256)||
    !sha(finished.artifactSha256)||!tick(cache.artifactWriteTicks)||
    !tick(finished.artifactWriteTicks)||
    !safe(cache.artifactBytes)||!cache.artifactBytes||
    !safe(finished.artifactBytes)||!finished.artifactBytes||
    typeof finished.jobId!=='string'||!finished.jobId||
    finished.jobId!==plan.jobId)
  return refuse('source-cache-or-finished-artifact-identity-invalid');
 if(!Number.isFinite(plan.start)||!Number.isFinite(plan.end)||
    plan.start<0||plan.end<=plan.start||
    cache.start!==plan.start||cache.end!==plan.end||
    !Array.isArray(cache.tracks)||!Array.isArray(finished.tracks)||
    !Array.isArray(plan.maps)||plan.maps.length<1||plan.maps.length>16||
    cache.tracks.length!==plan.maps.length||
    finished.tracks.length!==plan.maps.length||
    plan.audioCodec!=='copy'||plan.container!=='matroska'||
    plan.hasVideo!==true||plan.softSubtitleStreams<1)
  return refuse('mixed-mux-execution-contract-not-established');
 const usedCache=new Set(),usedOut=new Set(),rows=[];
 for(const map of plan.maps){
  if(!map||!safe(map.cacheOrdinal)||!safe(map.outputOrdinal)||
     usedCache.has(map.cacheOrdinal)||usedOut.has(map.outputOrdinal)||
     map.cacheOrdinal>=cache.tracks.length||
     map.outputOrdinal>=finished.tracks.length)
    return refuse('duplicate-or-invalid-flac-stream-map');
  usedCache.add(map.cacheOrdinal);usedOut.add(map.outputOrdinal);
  const a=cache.tracks[map.cacheOrdinal],b=finished.tracks[map.outputOrdinal];
  if(!a||!b||a.codec!=='flac'||b.codec!=='flac'||
     a.cacheOrdinal!==map.cacheOrdinal||b.outputOrdinal!==map.outputOrdinal||
     a.sourceOrdinal!==map.sourceOrdinal||
     !['full','trim'].includes(map.range)||map.range!==a.range||
     (map.channels??null)!==(a.channels??null)||
     (map.sampleRate??null)!==(a.sampleRate??null)||
     !safe(a.packetCount)||a.packetCount===0||a.packetCount!==b.packetCount||
     !safe(a.packetBytes)||a.packetBytes===0||a.packetBytes!==b.packetBytes||
     !sha(a.orderedPacketSha256)||a.orderedPacketSha256!==b.orderedPacketSha256)
    return refuse('encoded-flac-packet-bytes-or-order-differ');
  rows.push({sourceOrdinal:map.sourceOrdinal,
    cacheOrdinal:map.cacheOrdinal,outputOrdinal:map.outputOrdinal,
    packetBytes:a.packetBytes,packetCount:a.packetCount,
    orderedPacketSha256:a.orderedPacketSha256});
 }
 if(usedCache.size!==cache.tracks.length||usedOut.size!==finished.tracks.length)
  return refuse('uncompared-audio-output-stream');
 const audioBytes=rows.reduce((n,r)=>n+r.packetBytes,0);
 if(!safe(audioBytes)||audioBytes>finished.artifactBytes)
  return refuse('encoded-audio-payload-overflow-or-exceeds-mux');
 return {ok:true,version:1,kind:'single-mixed-job-encoded-flac-copy-identity-v1',
   sourceKey,measurementId:cache.measurementId,jobId:finished.jobId,
   cachedArtifactSha256:cache.artifactSha256,
   finishedArtifactSha256:finished.artifactSha256,
   audioPacketBytes:audioBytes,tracks:rows,
   cacheAudioPacketReuseVerified:true,
   canAuthorizeStrictBudget:false,canPredictNextJobSize:false,
   canRebaseWholeSourceLedger:false,wholeMovieSizePredictionVerified:false,
   note:'本次实际 FLAC 缓存包与最终包含视频/软字幕的成品按顺序、字节数、SHA-256 完全一致；没有证明容器其他开销、未来任务输出或严格体积预算可提前放行。'};
}
