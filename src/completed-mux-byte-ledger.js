// Actual completed video/audio/subtitle codec packet payload versus the total
// staged container bytes. All non-packet bytes remain "other and mux":
// headers, attachments, chapters, stream extradata, indexes and padding.
// This is NOT a predictive mux overhead coefficient for a future encode.
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const okArray=(x,n)=>Array.isArray(x)&&x.length===n&&x.every(safe);
const refuse=reason=>({status:'unavailable',reason,verifiedCurrentArtifact:false,
  canPredictFutureBytes:false,canAuthorizeStrictBudget:false});
export function summarizeCompletedMuxBytes({task,result}={}){
 const rec=result?.outputPacketEvidence;
 if(!task||result?.verified!==true||!rec||rec.version!==1||
    rec.scope!=='completed-artifact'||
    !safe(result.outputBytes)||result.outputBytes===0||
    rec.artifactBytes!==result.outputBytes||
    typeof result.jobId!=='string'||!result.jobId||
    rec.artifactJobId!==result.jobId||
    typeof rec.artifactWriteTicks!=='string'||
    !/^[0-9]{1,20}$/.test(rec.artifactWriteTicks))
  return refuse('completed-output-or-audit-identity-missing');
 const plan=task.outputPlan;
 const expectV=Array.isArray(plan?.video)?plan.video.length:
   (Number.isInteger(task.expectedVideoTracks)?task.expectedVideoTracks:null);
 const expectA=Array.isArray(plan?.audio)?plan.audio.length:
   (Number.isInteger(task.expectedAudioTracks)?task.expectedAudioTracks:null);
 const expectS=Array.isArray(plan?.subtitles)?plan.subtitles.length:null;
 if(!Number.isInteger(expectV)||expectV<1||expectV>32||
    !Number.isInteger(expectA)||expectA<0||expectA>32||
    !Number.isInteger(expectS)||expectS<0||expectS>32||
    expectV+expectA+expectS>64||
    !okArray(rec.videoPacketBytes,expectV)||
    !okArray(rec.audioPacketBytes,expectA)||
    !okArray(rec.subtitlePacketBytes,expectS))
  return refuse('incomplete-or-unmapped-video-audio-subtitle-packets');
 const sum=a=>a.reduce((total,x)=>total+x,0);
 const v=sum(rec.videoPacketBytes),a=sum(rec.audioPacketBytes),s=sum(rec.subtitlePacketBytes);
 const subtotal=v+a+s,other=result.outputBytes-subtotal;
 if(!safe(v)||!safe(a)||!safe(s)||!safe(subtotal)||!safe(other))
  return refuse('codec-payload-exceeds-container-or-overflows');
 const goal=task.sizeCeilingBytes||task.sizePlan?.targetBytes||null;
 const goalValid=safe(goal)&&goal>0;
 const boundMargin=goalValid?goal-result.outputBytes:null;
 return {
  version:1,status:'completed-mux-byte-ledger',scope:'single-completed-job',
  verifiedCurrentArtifact:true,artifactJobId:result.jobId,
  artifactBytes:result.outputBytes,artifactWriteTicks:rec.artifactWriteTicks,
  videoPacketBytes:v,audioPacketBytes:a,subtitlePacketBytes:s,
  otherAndMuxBytes:other,measuredCodecPacketBytes:subtotal,
  sourceTrackCounts:{video:expectV,audio:expectA,subtitle:expectS},
  budgetTargetBytes:goalValid?goal:null,observedHeadroomBytes:boundMargin,
  withinObservedBudget:goalValid?boundMargin>=0:null,
  canPredictFutureBytes:false,canAuthorizeStrictBudget:false,
  semantics:'otherAndMuxBytes includes attachments, chapters, codec extradata, indexes, metadata and all container overhead; never treat as pure container overhead or reuse as a future reserve'
 };
}
